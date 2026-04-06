// ReAct loop engine — orchestrates multi-intent conversations.
// Route handlers call runAgentLoop() instead of managing intent routing themselves.

import { callLLMGathering, callLLMDecompose, type DecomposedIntent } from './orchestration';
import { getNextField, type TaskFieldsState, type TaskFields } from '@/adapters/pmtool/types';
import { routeWorkItem, getWorkItemByKey, reassignWorkItem } from '@/adapters/router';
import { extractDiaryFromTranscript } from '@/adapters/bca/extract-diary';
import { saveDiary } from '@/adapters/bca/save-diary';
import { supabase } from '@/lib/supabase';
import {
  type PendingIntent,
  createIntent,
  getActiveIntent,
  deriveGatheringState,
} from './intent-types';
import type { ConversationTurn } from '@/lib/messaging-ops';

// ── Result type returned to route handlers ────────────────────────────────────

export interface AgentLoopResult {
  reply: string;
  classification: string;
  confidence: number;
  pmIssueKey?: string;
  updatedPendingIntents: PendingIntent[];
  updatedActiveIntentIdx: number;
  updatedTaskFields: TaskFieldsState;
  stillGathering: boolean;
  shouldRotate: boolean; // true = off_topic; caller must rotateConversationState
}

// ── Intent execution (non-gathering intents) ──────────────────────────────────

async function executeIntent(
  intent: PendingIntent,
  params: { lastPmIssueKey: string | null; sourceMessageId?: string; actorId?: string; canAssignTickets: boolean; languages?: string[] },
): Promise<{ reply: string; pmIssueKey?: string; updatedIntent: PendingIntent }> {

  if (intent.type === 'pm.task_create') {
    const f = intent.fields as TaskFields;
    try {
      const workItem = await routeWorkItem({
        title: f.title,
        description: f.description,
        priority: f.priority,
        assigneeEmail: f.assigneeEmail ?? undefined,
        category: 'pm.task_request',
        sourceMessageId: params.sourceMessageId,
        actorPhone: params.actorId,
      });
      return {
        reply: `Task created.`,
        pmIssueKey: workItem?.externalKey,
        updatedIntent: { ...intent, status: 'complete', result: { issueKey: workItem?.externalKey }, completedAt: new Date().toISOString() },
      };
    } catch {
      return { reply: `I couldn't create that task. Please try again.`, updatedIntent: { ...intent, status: 'failed', completedAt: new Date().toISOString() } };
    }
  }

  if (intent.type === 'pm.task_query') {
    const key = intent.fields.title ?? params.lastPmIssueKey; // issueKey stored in fields.title for query intents
    if (!key) return { reply: `Which ticket would you like me to check? Please share the issue key (e.g. KAN-3).`, updatedIntent: intent };
    try {
      const item = await getWorkItemByKey(key);
      const reply = item
        ? `${item.externalKey}: ${item.title}\nStatus: ${item.status ?? 'Unknown'}\nPriority: ${item.priority}`
        : `I couldn't find ticket ${key}.`;
      return { reply, updatedIntent: { ...intent, status: 'complete', result: { issueKey: key, message: reply }, completedAt: new Date().toISOString() } };
    } catch {
      return { reply: `Something went wrong fetching that ticket.`, updatedIntent: { ...intent, status: 'failed', completedAt: new Date().toISOString() } };
    }
  }

  if (intent.type === 'pm.task_assign' && params.canAssignTickets) {
    const key = intent.fields.title ?? params.lastPmIssueKey;
    const email = intent.fields.assigneeEmail;
    if (!key || !email) {
      const reply = !key ? `Which ticket should I reassign?` : `Who should I assign it to? Please share their email.`;
      return { reply, updatedIntent: intent };
    }
    try {
      const item = await reassignWorkItem(key, email);
      const reply = item ? `Done. ${item.externalKey} has been assigned to ${email}.` : `I couldn't reassign ${key}.`;
      return { reply, pmIssueKey: item?.externalKey, updatedIntent: { ...intent, status: 'complete', result: { issueKey: key, message: reply }, completedAt: new Date().toISOString() } };
    } catch {
      return { reply: `Something went wrong with the reassignment.`, updatedIntent: { ...intent, status: 'failed', completedAt: new Date().toISOString() } };
    }
  }

  if (intent.type === 'bca.site_diary_create') {
    const siteProjectId = intent.fields.siteProjectId;
    const reportDate = intent.fields.reportDate ?? new Date().toISOString().slice(0, 10);
    const transcript = intent.fields.transcript ?? '';
    if (!siteProjectId) {
      return { reply: `Which site project is this diary for? Please share the project reference.`, updatedIntent: intent };
    }

    // Resolve project UUID from project_ref if a ref string was provided
    let resolvedProjectId = siteProjectId;
    let resolvedProjectRef = siteProjectId;
    if (!/^[0-9a-f-]{36}$/.test(siteProjectId)) {
      const { data: proj } = await supabase
        .from('site_projects')
        .select('id, project_ref')
        .eq('project_ref', siteProjectId)
        .single();
      if (!proj) return { reply: `I couldn't find project "${siteProjectId}". Please check the project reference.`, updatedIntent: { ...intent, status: 'failed', completedAt: new Date().toISOString() } };
      resolvedProjectId = proj.id;
      resolvedProjectRef = proj.project_ref;
    }

    try {
      const platform = params.sourceMessageId ? 'WhatsApp' : 'Microsoft Teams';
      const { diary, confidence, flags } = await extractDiaryFromTranscript({
        transcript,
        projectId: resolvedProjectRef,
        reportDate,
        lat: null,
        long: null,
        geolocationVerified: false,
        platform,
        languages: params.languages ?? ['en'],
      });

      const { diaryEntryId } = await saveDiary({
        siteProjectId: resolvedProjectId,
        reportDate,
        diary,
        confidence,
        transcript,
      });

      const lowConf = flags?.some(f => f.includes('low_confidence'));
      const pdfUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://pmu.sg'}/api/bca/pdf?diary_id=${diaryEntryId}`;
      const reply = `Site diary for ${reportDate} saved.${lowConf ? ' Some fields had low confidence — please review before signing off.' : ''} Download PDF: ${pdfUrl}`;

      return {
        reply,
        updatedIntent: { ...intent, status: 'complete', result: { data: { diaryEntryId, pdfUrl } }, completedAt: new Date().toISOString() },
      };
    } catch {
      return { reply: `Something went wrong extracting the site diary. Please try again.`, updatedIntent: { ...intent, status: 'failed', completedAt: new Date().toISOString() } };
    }
  }

  if (intent.type === 'bca.site_diary_query') {
    const siteProjectId = intent.fields.siteProjectId;
    const reportDate = intent.fields.reportDate ?? new Date().toISOString().slice(0, 10);
    if (!siteProjectId) {
      return { reply: `Which site project should I look up?`, updatedIntent: intent };
    }

    const { data: entry } = await supabase
      .from('site_diary_entries')
      .select('id, report_date, confidence_score')
      .eq('site_project_id', siteProjectId)
      .eq('report_date', reportDate)
      .single();

    if (!entry) {
      return {
        reply: `No diary entry found for ${reportDate}. Send me today's site update and I'll log it.`,
        updatedIntent: { ...intent, status: 'complete', completedAt: new Date().toISOString() },
      };
    }

    const pdfUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://pmu.sg'}/api/bca/pdf?diary_id=${entry.id}`;
    return {
      reply: `Site diary for ${reportDate} (confidence: ${Math.round((entry.confidence_score ?? 0) * 100)}%). Download PDF: ${pdfUrl}`,
      updatedIntent: { ...intent, status: 'complete', result: { data: { diaryEntryId: entry.id, pdfUrl } }, completedAt: new Date().toISOString() },
    };
  }

  // general_inquiry / status_update / complaint / out_of_scope — LLM already wrote the reply
  return { reply: '', updatedIntent: { ...intent, status: 'complete', completedAt: new Date().toISOString() } };
}

// ── Process all consecutive immediately-executable intents from idx ───────────

async function processReadyIntents(
  intents: PendingIntent[],
  startIdx: number,
  params: { lastPmIssueKey: string | null; sourceMessageId?: string; actorId?: string; canAssignTickets: boolean },
): Promise<{ replies: string[]; pmIssueKey?: string; updatedIntents: PendingIntent[]; nextIdx: number }> {
  const updated = [...intents];
  const replies: string[] = [];
  let pmIssueKey: string | undefined;
  let idx = startIdx;

  while (idx < updated.length) {
    const intent = updated[idx];
    if (!intent || intent.status === 'gathering') break; // needs field collection — stop here

    const result = await executeIntent(intent, params);
    updated[idx] = result.updatedIntent;
    if (result.reply) replies.push(result.reply);
    if (result.pmIssueKey) pmIssueKey = result.pmIssueKey;
    idx++;
  }

  return { replies, pmIssueKey, updatedIntents: updated, nextIdx: idx };
}

// ── Build intent queue from decomposition result ──────────────────────────────

function buildIntentsFromDecomposition(
  decomposed: DecomposedIntent[],
  canAssignTickets: boolean,
  siteProjectId: string | null,
  userMessage: string,
): PendingIntent[] {
  return decomposed.map(d => {
    const intent = createIntent(d.type);

    if (d.type === 'pm.task_create' && d.task?.title && d.task?.description && d.task?.priority) {
      // All fields provided — mark ready for immediate execution
      return { ...intent, status: 'ready' as const, fields: d.task as TaskFields };
    }

    if (d.type === 'pm.task_query') {
      // Store issueKey in fields for executeIntent to pick up
      return { ...intent, status: 'ready' as const, fields: { title: d.issueKey ?? '' } };
    }

    if (d.type === 'pm.task_assign' && canAssignTickets) {
      return { ...intent, status: 'ready' as const, fields: { title: d.issueKey ?? '', assigneeEmail: d.assigneeEmail } };
    }

    if (d.type === 'pm.task_create') {
      // Needs gathering — stays as 'gathering'
      return intent;
    }

    if (d.type === 'bca.site_diary_create') {
      return {
        ...intent,
        status: 'ready' as const,
        fields: {
          siteProjectId: siteProjectId ?? '',
          reportDate: new Date().toISOString().slice(0, 10),
          transcript: userMessage,
        },
      };
    }

    if (d.type === 'bca.site_diary_query') {
      return {
        ...intent,
        status: 'ready' as const,
        fields: {
          siteProjectId: siteProjectId ?? '',
          reportDate: new Date().toISOString().slice(0, 10),
        },
      };
    }

    // general_inquiry / out_of_scope / etc — no execution needed, mark complete immediately
    return { ...intent, status: 'complete' as const, completedAt: new Date().toISOString() };
  });
}

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function runAgentLoop(params: {
  userMessage: string;
  history: ConversationTurn[];
  pendingIntents: PendingIntent[];
  activeIntentIdx: number;
  gatheringTask: boolean;
  taskFields: TaskFieldsState;
  lastPmIssueKey: string | null;
  provider: string;
  model: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  localeHints?: string | null;
  canAssignTickets: boolean;
  canAccessBca: boolean;
  siteProjectId: string | null;
  languages?: string[];
  platform: 'WhatsApp' | 'Microsoft Teams';
  sourceMessageId?: string;
  actorId?: string;
}): Promise<AgentLoopResult> {
  const {
    userMessage, history, pendingIntents, activeIntentIdx,
    gatheringTask, taskFields, lastPmIssueKey,
    provider, model, maxTokens, temperature, systemPrompt, localeHints,
    canAssignTickets, canAccessBca, siteProjectId, languages, platform, sourceMessageId, actorId,
  } = params;

  const execParams = { lastPmIssueKey, sourceMessageId, actorId, canAssignTickets, languages };
  const nextField = getNextField(taskFields, canAssignTickets);

  // ── Case 1: Active gathering intent ────────────────────────────────────────

  if (gatheringTask && nextField) {
    const gatherResult = await callLLMGathering({
      provider, model, text: userMessage, maxTokens, temperature, systemPrompt,
      conversationHistory: history, taskFields, nextField, canAssignTickets, platform, localeHints,
    });

    if (gatherResult.classification === 'off_topic') {
      return {
        reply: gatherResult.reply, classification: 'off_topic', confidence: 1,
        updatedPendingIntents: pendingIntents, updatedActiveIntentIdx: activeIntentIdx,
        updatedTaskFields: taskFields, stillGathering: false, shouldRotate: true,
      };
    }

    if (gatherResult.classification === 'ambiguous') {
      return {
        reply: gatherResult.reply, classification: 'ambiguous', confidence: 0.5,
        updatedPendingIntents: pendingIntents, updatedActiveIntentIdx: activeIntentIdx,
        updatedTaskFields: taskFields, stillGathering: true, shouldRotate: false,
      };
    }

    // continuing — merge extracted fields
    const updatedFields: TaskFieldsState = { ...taskFields, ...gatherResult.extracted };
    const newNextField = getNextField(updatedFields, canAssignTickets);

    if (newNextField) {
      // More fields needed — update intent in queue and keep gathering
      const updatedIntents = [...pendingIntents];
      const active = getActiveIntent(updatedIntents, activeIntentIdx);
      if (active) updatedIntents[activeIntentIdx] = { ...active, fields: updatedFields };
      return {
        reply: gatherResult.reply, classification: 'continuing', confidence: 1,
        updatedPendingIntents: updatedIntents, updatedActiveIntentIdx: activeIntentIdx,
        updatedTaskFields: updatedFields, stillGathering: true, shouldRotate: false,
      };
    }

    // All fields collected — execute the gathering intent
    const updatedIntents = [...pendingIntents];
    const active = getActiveIntent(updatedIntents, activeIntentIdx);
    if (active) updatedIntents[activeIntentIdx] = { ...active, status: 'ready', fields: updatedFields };

    const execResult = await executeIntent(updatedIntents[activeIntentIdx], execParams);
    updatedIntents[activeIntentIdx] = execResult.updatedIntent;

    // Process any further queued intents immediately
    const { replies, pmIssueKey, updatedIntents: finalIntents, nextIdx } =
      await processReadyIntents(updatedIntents, activeIntentIdx + 1, execParams);

    const allReplies = [gatherResult.reply, execResult.reply, ...replies].filter(Boolean);

    return {
      reply: allReplies.join('\n\n'), classification: 'pm.task_request', confidence: 1,
      pmIssueKey: execResult.pmIssueKey ?? pmIssueKey,
      updatedPendingIntents: finalIntents, updatedActiveIntentIdx: nextIdx,
      updatedTaskFields: {}, stillGathering: false, shouldRotate: false,
    };
  }

  // ── Case 2: New message — decompose into intents ───────────────────────────

  const decomposeResult = await callLLMDecompose({
    provider, model, text: userMessage, maxTokens, temperature, systemPrompt,
    conversationHistory: history, canAssignTickets, canAccessBca, localeHints,
  });

  const newIntents = buildIntentsFromDecomposition(decomposeResult.intents, canAssignTickets, siteProjectId, userMessage);

  // Append new intents after any still-pending ones
  const existingPending = pendingIntents.filter(i => i.status !== 'complete' && i.status !== 'failed');
  const allIntents = [...existingPending, ...newIntents];
  const startIdx = existingPending.length;

  // Check if first new intent needs gathering
  const firstNew = allIntents[startIdx];
  if (firstNew?.status === 'gathering') {
    // Start gathering — execute any subsequent ready intents after gathering completes
    const { gatheringTask: _, taskFields: __ } = deriveGatheringState(allIntents, startIdx);
    return {
      reply: decomposeResult.reply, classification: firstNew.type, confidence: decomposeResult.confidence,
      updatedPendingIntents: allIntents, updatedActiveIntentIdx: startIdx,
      updatedTaskFields: firstNew.fields, stillGathering: true, shouldRotate: false,
    };
  }

  // All new intents are immediately executable
  const { replies, pmIssueKey, updatedIntents, nextIdx } =
    await processReadyIntents(allIntents, startIdx, execParams);

  const llmReply = decomposeResult.reply;
  const execReplies = replies.filter(Boolean);
  const primaryType = newIntents[0]?.type ?? 'general_inquiry';
  // For domain-executor intents (BCA etc.), use executor reply only — LLM reply may hallucinate constraints
  const useExecOnly = execReplies.length > 0 && primaryType.startsWith('bca.');
  const finalReply = useExecOnly
    ? execReplies.join('\n\n')
    : execReplies.length > 0
      ? (llmReply && !execReplies.some(r => llmReply.includes(r)) ? `${llmReply}\n\n${execReplies.join('\n\n')}` : execReplies.join('\n\n'))
      : llmReply;

  return {
    reply: finalReply, classification: primaryType, confidence: decomposeResult.confidence,
    pmIssueKey,
    updatedPendingIntents: updatedIntents, updatedActiveIntentIdx: nextIdx,
    updatedTaskFields: {}, stillGathering: false, shouldRotate: false,
  };
}
