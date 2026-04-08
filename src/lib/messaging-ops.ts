import { supabase } from './supabase';
import type { TaskFieldsState } from '@/adapters/pmtool/types';
import type { RequeryRecord } from '@/adapters/bca/save-diary';
import {
  type PendingIntent,
  deriveGatheringState,
  createIntent,
  getActiveIntent,
} from '@/core/react-loop/intent-types';

// Check if sender is blacklisted
export async function isBlacklisted(phoneNumber: string): Promise<boolean> {
  const { data } = await supabase
    .from('governance_blacklist')
    .select('id')
    .eq('identity', phoneNumber)
    .single();
  return !!data;
}

// Log incoming message to intake_logs
export async function logIntake(params: {
  platformMessageId: string;
  senderId: string;
  messageBody: string;
  rawPayload: Record<string, unknown>;
}): Promise<string | null> {
  const { data } = await supabase
    .from('intake_logs')
    .insert({
      platform_message_id: params.platformMessageId,
      sender_id: params.senderId,
      message_body: params.messageBody,
      raw_payload: params.rawPayload,
    })
    .select('id')
    .single();
  return data?.id ?? null;
}

// Log outgoing reply to communication_logs
export async function logCommunication(params: {
  intakeLogId: string;
  platform: string;
  platformMessageId: string;
  senderId: string;
  messageBody: string;
  rawPayload: Record<string, unknown>;
}): Promise<string | null> {
  const { data } = await supabase
    .from('communication_logs')
    .insert({
      intake_log_id: params.intakeLogId,
      platform: params.platform,
      platform_message_id: params.platformMessageId,
      sender_id: params.senderId,
      message_body: params.messageBody,
      raw_payload: params.rawPayload,
    })
    .select('id')
    .single();
  return data?.id ?? null;
}

// Get subscriber email linked to a subscription (for Jira permission checks)
export async function getSubscriberEmail(senderId: string, channel: 'whatsapp' | 'teams'): Promise<string | null> {
  const column = channel === 'teams' ? 'teams_user_id' : 'whatsapp_number';
  const { data } = await supabase
    .from('subscriptions')
    .select('subscriber:subscriber_id (email)')
    .eq(column, senderId)
    .single();
  return (data?.subscriber as { email?: string } | null)?.email ?? null;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

// ── Conversation state ────────────────────────────────────────────────────────

export interface PendingRequery {
  diaryEntryId: string;
  records: RequeryRecord[];
}

/** Full conversation state including the intent queue. */
export interface ConversationState {
  history: ConversationTurn[];
  pendingIntents: PendingIntent[];
  activeIntentIdx: number;
  lastPmIssueKey: string | null;
  pendingRequery: PendingRequery | null;
  // Legacy shim — derived from queue; keeps existing route handlers unchanged
  gatheringTask: boolean;
  taskFields: TaskFieldsState;
}

/** Fetch conversation state for the active record. */
export async function getConversationState(
  senderId: string,
  channel: string,
): Promise<ConversationState> {
  const { data } = await supabase
    .from('active_conversations')
    .select('conversation_history, pending_intents, active_intent_idx, last_pm_issue_key, pending_requery')
    .eq('sender_id', senderId)
    .eq('channel', channel)
    .eq('is_active', true)
    .single();

  const pendingIntents = (data?.pending_intents as PendingIntent[]) ?? [];
  const activeIntentIdx = (data?.active_intent_idx as number) ?? 0;

  return {
    history: (data?.conversation_history as ConversationTurn[]) ?? [],
    pendingIntents,
    activeIntentIdx,
    lastPmIssueKey: (data?.last_pm_issue_key as string | null) ?? null,
    pendingRequery: (data?.pending_requery as PendingRequery | null) ?? null,
    ...deriveGatheringState(pendingIntents, activeIntentIdx),
  };
}

/** Update conversation history and intent queue on the active record.
 *  Falls back to INSERT for first-time senders (partial index prevents plain upsert). */
export async function updateConversationState(
  senderId: string,
  channel: string,
  history: ConversationTurn[],
  pendingIntents: PendingIntent[],
  activeIntentIdx: number,
  pmIssueKey?: string,
  pendingRequery?: PendingRequery | null,
): Promise<void> {
  const MAX_HISTORY = 20;
  const payload = {
    conversation_history: history.slice(-MAX_HISTORY),
    pending_intents: pendingIntents,
    active_intent_idx: activeIntentIdx,
    last_interaction_at: new Date().toISOString(),
    ...(pmIssueKey ? { last_pm_issue_key: pmIssueKey } : {}),
    // Explicitly pass null to clear requery when resolved; undefined = don't touch
    ...(pendingRequery !== undefined ? { pending_requery: pendingRequery } : {}),
  };

  const { count } = await supabase
    .from('active_conversations')
    .update(payload, { count: 'exact' })
    .eq('sender_id', senderId)
    .eq('channel', channel)
    .eq('is_active', true);

  if (!count) {
    await supabase
      .from('active_conversations')
      .insert({ sender_id: senderId, channel, is_active: true, ...payload });
  }
}

/** Retire the active conversation and open a fresh one.
 *  Old record → is_active=false; retention rules handle cleanup. */
export async function rotateConversationState(
  senderId: string,
  channel: string,
  firstTurns: ConversationTurn[],
): Promise<void> {
  await supabase
    .from('active_conversations')
    .update({ is_active: false, last_interaction_at: new Date().toISOString() })
    .eq('sender_id', senderId)
    .eq('channel', channel)
    .eq('is_active', true);

  await supabase
    .from('active_conversations')
    .insert({
      sender_id: senderId,
      channel,
      is_active: true,
      conversation_history: firstTurns,
      pending_intents: [],
      active_intent_idx: 0,
      last_interaction_at: new Date().toISOString(),
    });
}

/** Bridge for existing route handlers: translates legacy (stillGathering, taskFields) into
 *  intent queue mutations, then calls updateConversationState.
 *  Route handlers pass the pendingIntents/activeIntentIdx they already loaded from DB. */
export async function updateConversationStateFromGathering(
  senderId: string,
  channel: string,
  history: ConversationTurn[],
  pendingIntents: PendingIntent[],
  activeIntentIdx: number,
  stillGathering: boolean,
  updatedTaskFields: TaskFieldsState,
  pmIssueKey?: string,
): Promise<void> {
  const updatedIntents = [...pendingIntents];
  const active = getActiveIntent(updatedIntents, activeIntentIdx);

  if (active) {
    updatedIntents[activeIntentIdx] = {
      ...active,
      status: stillGathering ? 'gathering' : 'complete',
      fields: updatedTaskFields,
      ...(pmIssueKey ? { result: { issueKey: pmIssueKey }, completedAt: new Date().toISOString() } : {}),
    };
  } else if (stillGathering) {
    // First turn: no intent exists yet — create one
    const newIntent = createIntent('pm.task_create');
    newIntent.fields = updatedTaskFields;
    updatedIntents.push(newIntent);
  }

  const nextIdx = !stillGathering && active ? activeIntentIdx + 1 : activeIntentIdx;
  await updateConversationState(senderId, channel, history, updatedIntents, nextIdx, pmIssueKey);
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export async function logAuditTrail(params: {
  commLogId: string | null;
  inputText: string;
  aiSummaryTitle: string;
  aiClassification: string;
  confidenceScore: number;
  processingTimeMs: number;
}): Promise<void> {
  await supabase.from('ai_audit_trail').insert({
    comm_log_id: params.commLogId,
    input_text: params.inputText,
    ai_summary_title: params.aiSummaryTitle,
    ai_classification: params.aiClassification,
    confidence_score: params.confidenceScore,
    processing_time_ms: params.processingTimeMs,
  });
}
