import { NextResponse } from 'next/server';
import { getAgentGovernance } from '@/lib/agent-config';
import { isBlacklisted, logIntake, logCommunication, logAuditTrail, getConversationState, updateConversationState, rotateConversationState, getSubscriberEmail, type PendingRequery } from '@/lib/messaging-ops';
import { supabase } from '@/lib/supabase';
import { writeAuditVault } from '@/lib/security/hash-chain';
import { checkCanAssign } from '@/adapters/router';
import { WhatsAppAdapter } from '@/adapters/messenger/whatsapp';
import { runAgentLoop } from '@/core/react-loop';

const messenger = new WhatsAppAdapter();

// ── Voice note transcription ──────────────────────────────────────────────────

async function transcribeAudio(mediaUrl: string): Promise<string> {
  // Download audio from Twilio (requires Basic auth with account SID + auth token)
  const sid   = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const audioRes = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
  });
  if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`);
  const audioBuffer = await audioRes.arrayBuffer();

  // Build multipart form for Whisper API
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
  formData.append('model', 'whisper-large-v3'); // overridden below for Groq

  formData.set('model', 'whisper-large-v3'); // Groq uses whisper-large-v3
  const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY!}` },
    body: formData,
  });
  if (!whisperRes.ok) throw new Error(`Whisper error: ${whisperRes.status}`);
  const json = await whisperRes.json() as { text: string };
  return json.text.trim();
}

function truncateAtSentence(body: string, limit: number): string {
  if (body.length <= limit) return body;
  const truncated = body.slice(0, limit);
  const lastEnd = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?')
  );
  return lastEnd > 0 ? truncated.slice(0, lastEnd + 1) : truncated;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    let incomingMsg = (formData.get('Body') as string) || '';
    const sender = formData.get('From') as string;
    const messageSid = (formData.get('MessageSid') as string) || '';

    // Transcribe voice notes via Whisper when Body is empty and audio media is present
    const numMedia = parseInt((formData.get('NumMedia') as string) || '0', 10);
    if (!incomingMsg && numMedia > 0) {
      const contentType = (formData.get('MediaContentType0') as string) || '';
      const mediaUrl    = (formData.get('MediaUrl0') as string) || '';
      if (contentType.startsWith('audio/') && mediaUrl) {
        try {
          incomingMsg = await transcribeAudio(mediaUrl);
        } catch (err) {
          console.error('Voice transcription failed:', err);
          const senderPhone = sender.replace('whatsapp:', '');
          await messenger.send(sender, `Sorry, I couldn't transcribe your voice note. Please send a text message instead.`);
          await logIntake({ platformMessageId: messageSid, senderId: senderPhone, messageBody: '[voice note — transcription failed]', rawPayload: Object.fromEntries(formData) });
          return xmlOk();
        }
      }
    }

    const senderPhone = sender.replace('whatsapp:', '');

    // Stage 0: Log intake
    const rawPayload: Record<string, unknown> = {};
    formData.forEach((value, key) => { rawPayload[key] = value; });
    if (numMedia > 0 && incomingMsg) rawPayload['_transcribed'] = true;
    const intakeLogId = await logIntake({
      platformMessageId: messageSid,
      senderId: senderPhone,
      messageBody: incomingMsg,
      rawPayload,
    });

    // Stage 1: Blacklist check
    const blocked = await isBlacklisted(senderPhone);
    if (blocked) {
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Stage 2: Identity & Policy Retrieval
    const config = await getAgentGovernance(senderPhone);

    // Stage 3: Hard Governance — input limit
    const limit = config?.max_input_chars ?? 500;
    if (incomingMsg.length > limit) {
      await messenger.send(sender, `Message too long. Your current tier limit is ${limit} characters.`);
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Stage 4: Load conversation state + check Jira assign permission
    const [{ history, gatheringTask, taskFields, pendingIntents, activeIntentIdx, lastPmIssueKey, pendingRequery }, subscriberEmail] = await Promise.all([
      getConversationState(senderPhone, 'whatsapp'),
      getSubscriberEmail(senderPhone, 'whatsapp'),
    ]);

    const canAssignTickets = subscriberEmail
      ? await checkCanAssign('pm.task_request', subscriberEmail)
      : false;

    // Stage 4b: Requery intercept — if a local/foreign worker count is pending, handle before LLM
    if (pendingRequery && pendingRequery.records.length > 0) {
      const reqResult = await handleRequeryResponse(incomingMsg, pendingRequery, senderPhone);
      if (reqResult.handled) {
        await messenger.send(sender, reqResult.reply);
        const updatedHistory = [...history, { role: 'user' as const, content: incomingMsg }, { role: 'assistant' as const, content: reqResult.reply }];
        updateConversationState(senderPhone, 'whatsapp', updatedHistory, pendingIntents, activeIntentIdx, undefined, reqResult.nextRequery).catch(console.error);
        logPost({ intakeLogId, senderPhone, messageSid, incomingMsg, reply: reqResult.reply, classification: 'bca.requery_response', confidence: 1, config, processingTimeMs: 0 });
        return xmlOk();
      }
    }

    const maxOutput = config?.max_output_tokens ?? 300;
    const baseSystemPrompt = `${config?.system_prompt ?? 'You are Miyu, a helpful AI assistant.'}
The user is on the ${config?.plan_type ?? 'pilot'} plan. They may send up to ${limit} characters per message. Your replies are capped at ${maxOutput} tokens.
Always respond in plain text only — no markdown, no bullet points, no asterisks, no headers. This is WhatsApp.`;

    const llmStart = Date.now();

    const loopResult = await runAgentLoop({
      userMessage: incomingMsg,
      history,
      pendingIntents,
      activeIntentIdx,
      gatheringTask,
      taskFields,
      lastPmIssueKey,
      provider: config?.model_provider ?? 'anthropic',
      model: config?.model_name ?? 'claude-sonnet-4-6',
      maxTokens: maxOutput,
      temperature: config?.temperature ?? 0.7,
      systemPrompt: baseSystemPrompt,
      localeHints: config?.locale_hints,
      canAssignTickets,
      canAccessBca: config?.can_access_bca ?? false,
      siteProjectId: config?.site_project_id ?? null,
      languages: config?.languages ?? ['en'],
      platform: 'WhatsApp',
      sourceMessageId: messageSid,
      actorId: senderPhone,
    });

    const { reply, classification, confidence, pmIssueKey, shouldRotate,
      updatedPendingIntents, updatedActiveIntentIdx,
      pendingRequeryRecords, pendingRequeryDiaryId } = loopResult;

    const processingTimeMs = Date.now() - llmStart;

    // Stage 5: Delivery
    const baseReply = truncateAtSentence(reply, 1500);
    const finalReply = pmIssueKey
      ? `${baseReply}\n\nTicket ${pmIssueKey} has been raised. The team will pick it up shortly.`
      : baseReply;

    if (shouldRotate) {
      const currentTurn = [
        { role: 'user' as const, content: incomingMsg },
        { role: 'assistant' as const, content: reply },
      ];
      rotateConversationState(senderPhone, 'whatsapp', currentTurn).catch(console.error);
      await messenger.send(sender, truncateAtSentence(reply, 1500));
      logPost({ intakeLogId, senderPhone, messageSid, incomingMsg, reply, classification, confidence, config, processingTimeMs });
      return xmlOk();
    }

    await messenger.send(sender, finalReply);

    // Stage 6: Persist state
    const updatedHistory = [
      ...history,
      { role: 'user' as const, content: incomingMsg },
      { role: 'assistant' as const, content: reply },
    ];
    const newRequery: PendingRequery | null | undefined = pendingRequeryRecords
      ? { diaryEntryId: pendingRequeryDiaryId!, records: pendingRequeryRecords }
      : undefined; // undefined = don't overwrite existing requery state
    updateConversationState(senderPhone, 'whatsapp', updatedHistory, updatedPendingIntents, updatedActiveIntentIdx, pmIssueKey, newRequery).catch(console.error);

    // Audit (non-blocking)
    logPost({ intakeLogId, senderPhone, messageSid, incomingMsg, reply: finalReply, classification, confidence, config, processingTimeMs, pmIssueKey });

    return xmlOk();
  } catch (error) {
    console.error('Miyu Error:', error);
    return new NextResponse('Error', { status: 500 });
  }
}

function xmlOk() {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { headers: { 'Content-Type': 'text/xml' } }
  );
}

// ── Requery handler ───────────────────────────────────────────────────────────
// Tries to interpret the incoming message as the answer to a local-worker-count question.
// Returns { handled: true, reply, nextRequery } when it successfully updates the DB record.
// Returns { handled: false } when the message can't be parsed (hand off to LLM).

async function handleRequeryResponse(
  msg: string,
  pendingRequery: PendingRequery,
  _senderPhone: string,
): Promise<{ handled: boolean; reply: string; nextRequery: PendingRequery | null }> {
  const localCount = parseInt(msg.trim(), 10);
  if (isNaN(localCount) || localCount < 0) {
    // Not a valid answer — re-ask the first pending question
    return { handled: true, reply: pendingRequery.records[0].requery_template, nextRequery: pendingRequery };
  }

  const [current, ...remaining] = pendingRequery.records;
  const workerCount = current.worker_count;
  const clampedLocal = Math.min(localCount, workerCount);
  const foreignCount = workerCount - clampedLocal;

  const { error } = await supabase
    .from('epss_productivity_records')
    .update({ local_worker_count: clampedLocal, foreign_worker_count: foreignCount, requires_requery: false })
    .eq('id', current.id);

  if (error) {
    console.error('Requery update failed:', error);
    return { handled: true, reply: `Something went wrong saving the worker count. Please try again: ${current.requery_template}`, nextRequery: pendingRequery };
  }

  // Patch structured_json in site_diary_entries to reflect confirmed local/foreign split
  const { data: diaryEntry } = await supabase
    .from('site_diary_entries')
    .select('structured_json')
    .eq('id', pendingRequery.diaryEntryId)
    .single();

  if (diaryEntry?.structured_json) {
    const json = diaryEntry.structured_json as import('@/adapters/bca/extract-diary').BcaDiaryJSON;
    const summary = json.epss_trade_summary ?? [];
    const idx = summary.findIndex(s => s.trade_code === current.trade_code);
    const confirmed = { trade_code: current.trade_code, trade_description: current.trade_description, worker_count: workerCount, local_worker_count: clampedLocal, foreign_worker_count: foreignCount };
    if (idx >= 0) summary[idx] = confirmed; else summary.push(confirmed);
    await supabase.from('site_diary_entries').update({ structured_json: { ...json, epss_trade_summary: summary } }).eq('id', pendingRequery.diaryEntryId);
  }

  if (remaining.length > 0) {
    return {
      handled: true,
      reply: `Got it — ${clampedLocal} local, ${foreignCount} foreign for ${current.trade_description}.\n\n${remaining[0].requery_template}`,
      nextRequery: { ...pendingRequery, records: remaining },
    };
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://pmu.sg';
  const pdfUrl  = `${base}/api/bca/pdf?diary_id=${pendingRequery.diaryEntryId}`;
  const docxUrl = `${base}/api/bca/docx?diary_id=${pendingRequery.diaryEntryId}`;
  return {
    handled: true,
    reply: `Got it — ${clampedLocal} local, ${foreignCount} foreign for ${current.trade_description}. All worker counts confirmed.\nPDF: ${pdfUrl}\nWord: ${docxUrl}`,
    nextRequery: null,
  };
}

function logPost(params: {
  intakeLogId: string | null;
  senderPhone: string;
  messageSid: string;
  incomingMsg: string;
  reply: string;
  classification: string;
  confidence: number;
  config: any;
  processingTimeMs: number;
  pmIssueKey?: string;
}) {
  const { intakeLogId, senderPhone, messageSid, incomingMsg, reply, classification, confidence, config, processingTimeMs, pmIssueKey } = params;
  logCommunication({
    intakeLogId: intakeLogId!,
    platform: 'whatsapp',
    platformMessageId: `${messageSid}_reply`,
    senderId: senderPhone,
    messageBody: reply,
    rawPayload: { direction: 'outbound', model: config?.model_name },
  }).then((commLogId: string | null) =>
    logAuditTrail({
      commLogId,
      inputText: incomingMsg,
      aiSummaryTitle: reply.slice(0, 100),
      aiClassification: classification,
      confidenceScore: confidence,
      processingTimeMs,
    })
  ).catch(console.error);

  writeAuditVault({
    actorBsuid: senderPhone,
    reasoningTrace: {
      input: incomingMsg,
      output: reply,
      classification,
      confidence,
      processing_time_ms: processingTimeMs,
      plan_type: config?.plan_type ?? 'pilot',
      pm_issue_key: pmIssueKey ?? null,
    },
    actionTaken: pmIssueKey
      ? `WhatsApp reply sent to ${senderPhone} — WorkItem ${pmIssueKey} created`
      : `WhatsApp reply sent to ${senderPhone}`,
    modelVersion: config?.model_name ?? 'claude-sonnet-4-6',
    promptId: config?.prompt_id ?? 'v1.0',
  }).catch(console.error);
}
