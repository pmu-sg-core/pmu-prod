import { NextResponse } from 'next/server';
import { getAgentGovernance } from '@/lib/agent-config';
import { isBlacklisted, logIntake, logCommunication, logAuditTrail, getConversationState, updateConversationState, rotateConversationState, getSubscriberEmail } from '@/lib/messaging-ops';
import { writeAuditVault } from '@/lib/security/hash-chain';
import { checkCanAssign } from '@/adapters/router';
import { TeamsAdapter } from '@/adapters/messenger/teams';
import { runAgentLoop } from '@/core/react-loop';

const messenger = new TeamsAdapter();

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
    const activity = await req.json();

    if (activity.type !== 'message') {
      return new NextResponse('OK', { status: 200 });
    }

    const incomingMsg: string = activity.text || '';
    const teamsUserId: string = activity.from?.id || '';
    const activityId: string = activity.id || '';
    const conversationId: string = activity.conversation?.id || '';
    const serviceUrl: string = activity.serviceUrl || '';

    // Stage 0: Log intake
    const intakeLogId = await logIntake({
      platformMessageId: activityId,
      senderId: teamsUserId,
      messageBody: incomingMsg,
      rawPayload: activity,
    });

    // Stage 1: Blacklist check
    const blocked = await isBlacklisted(teamsUserId);
    if (blocked) {
      return new NextResponse('OK', { status: 200 });
    }

    // Stage 2: Identity & Policy Retrieval
    const config = await getAgentGovernance(teamsUserId, 'teams');

    // Stage 3: Hard Governance — input limit
    const limit = config?.max_input_chars ?? 500;
    if (incomingMsg.length > limit) {
      await messenger.send(teamsUserId,
        `Message too long. Your current tier limit is ${limit} characters.`,
        { serviceUrl, conversationId, activityId });
      return new NextResponse('OK', { status: 200 });
    }

    // Stage 4: Load conversation state + check Jira assign permission
    const [{ history, gatheringTask, taskFields, pendingIntents, activeIntentIdx, lastPmIssueKey }, subscriberEmail] = await Promise.all([
      getConversationState(teamsUserId, 'teams'),
      getSubscriberEmail(teamsUserId, 'teams'),
    ]);

    const canAssignTickets = subscriberEmail
      ? await checkCanAssign('pm.task_request', subscriberEmail)
      : false;

    const maxOutput = config?.max_output_tokens ?? 300;
    const baseSystemPrompt = `${config?.system_prompt ?? 'You are Miyu, a helpful AI assistant.'}
The user is on the ${config?.plan_type ?? 'pilot'} plan. They may send up to ${limit} characters per message. Your replies are capped at ${maxOutput} tokens.
Always respond in plain text only — no markdown, no bullet points, no asterisks, no headers. This is Microsoft Teams.`;

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
      platform: 'Microsoft Teams',
      sourceMessageId: activityId,
      actorId: teamsUserId,
    });

    const { reply, classification, confidence, pmIssueKey, shouldRotate,
      updatedPendingIntents, updatedActiveIntentIdx } = loopResult;

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
      rotateConversationState(teamsUserId, 'teams', currentTurn).catch(console.error);
      await messenger.send(teamsUserId, truncateAtSentence(reply, 1500), { serviceUrl, conversationId, activityId });
      logPost({ intakeLogId, senderId: teamsUserId, activityId, incomingMsg, reply, classification, confidence, config, processingTimeMs });
      return new NextResponse('OK', { status: 200 });
    }

    await messenger.send(teamsUserId, finalReply, { serviceUrl, conversationId, activityId });

    // Stage 6: Persist state
    const updatedHistory = [
      ...history,
      { role: 'user' as const, content: incomingMsg },
      { role: 'assistant' as const, content: reply },
    ];
    updateConversationState(teamsUserId, 'teams', updatedHistory, updatedPendingIntents, updatedActiveIntentIdx, pmIssueKey).catch(console.error);

    // Audit (non-blocking)
    logPost({ intakeLogId, senderId: teamsUserId, activityId, incomingMsg, reply: finalReply, classification, confidence, config, processingTimeMs, pmIssueKey });

    return new NextResponse('OK', { status: 200 });
  } catch (error) {
    console.error('Miyu Teams Error:', error);
    return new NextResponse('Error', { status: 500 });
  }
}

function logPost(params: {
  intakeLogId: string | null;
  senderId: string;
  activityId: string;
  incomingMsg: string;
  reply: string;
  classification: string;
  confidence: number;
  config: any;
  processingTimeMs: number;
  pmIssueKey?: string;
}) {
  const { intakeLogId, senderId, activityId, incomingMsg, reply, classification, confidence, config, processingTimeMs, pmIssueKey } = params;
  logCommunication({
    intakeLogId: intakeLogId!,
    platform: 'teams',
    platformMessageId: `${activityId}_reply`,
    senderId,
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
    actorBsuid: senderId,
    reasoningTrace: {
      input: incomingMsg,
      output: reply,
      classification,
      confidence,
      processing_time_ms: processingTimeMs,
      plan_type: config?.plan_type ?? 'pilot',
      platform: 'teams',
      pm_issue_key: pmIssueKey ?? null,
    },
    actionTaken: pmIssueKey
      ? `Teams reply sent to ${senderId} — WorkItem ${pmIssueKey} created`
      : `Teams reply sent to ${senderId}`,
    modelVersion: config?.model_name ?? 'claude-sonnet-4-6',
    promptId: config?.prompt_id ?? 'v1.0',
  }).catch(console.error);
}
