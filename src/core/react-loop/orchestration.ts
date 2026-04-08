import { AnthropicAdapter } from '@/adapters/llm/anthropic';
import type { LLMAdapter } from '@/adapters/llm/types';
import {
  type TaskFieldsState,
  type TaskFields,
  FIELD_LABELS,
  getNextField,
} from '@/adapters/pmtool/types';
import type { IntentType } from '@/core/react-loop/intent-types';
import {
  buildSessionState,
  buildInteractionAnchor,
  buildLocaleContext,
  buildOperationalContract,
  normalModeIntentHint,
} from '@/core/react-loop/prompt-store';

// ── LLM adapter registry ──────────────────────────────────────────────────────

const llmAdapters: Record<string, LLMAdapter> = {
  anthropic: new AnthropicAdapter(),
  // openai:  new OpenAIAdapter(),
  // gemini:  new GeminiAdapter(),
};

function getLLMAdapter(provider: string): LLMAdapter {
  const adapter = llmAdapters[provider];
  if (!adapter) throw new Error(`Unsupported LLM provider: ${provider}`);
  return adapter;
}

const HISTORY_WINDOW = 10;

// ── Normal-mode LLM (intent classification) ──────────────────────────────────

export interface LLMResult {
  reply: string;
  classification: string;
  confidence: number;
  task?: TaskFields;
  issueKey?: string;       // populated for pm.task_query and pm.task_assign
  assigneeEmail?: string;  // populated for pm.task_assign
}

export async function callLLM({
  provider,
  model,
  text,
  maxTokens,
  temperature,
  systemPrompt,
  conversationHistory = [],
  canAssignTickets = false,
  localeHints,
}: {
  provider: string;
  model: string;
  text: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  canAssignTickets?: boolean;
  localeHints?: string | null;
}): Promise<LLMResult> {
  const recentHistory = conversationHistory.filter(t => t.content?.trim()).slice(-HISTORY_WINDOW);
  const lastOutbound = recentHistory.filter(t => t.role === 'assistant').at(-1)?.content ?? null;

  const structuredSystem = `${systemPrompt}

${buildLocaleContext(localeHints)}

${buildInteractionAnchor(lastOutbound, text, normalModeIntentHint(lastOutbound))}

${buildOperationalContract(
    [
      `Create new tasks by collecting: title, description, priority${canAssignTickets ? ', assignee email' : ''}.`,
      `Check the status of an existing task by issue key (e.g. "what's the status of KAN-3?").`,
      ...(canAssignTickets ? [`Reassign an existing task to a team member by issue key and email.`] : []),
      `Answer general questions about pmu.sg and its features.`,
    ],
    [
      `Cannot set due dates, delete tickets, look up rosters, or list available assignees.`,
      `Cannot collect fields outside the defined set.`,
      ...(!canAssignTickets ? [`Cannot reassign tasks — this requires a higher plan tier.`] : []),
    ],
    `Politely decline and explain what Miyu can do: "I can help create tasks, check task status${canAssignTickets ? ', reassign tasks,' : ''} and answer general questions about pmu.sg. I'm not able to [action requested]."`
  )}

<classification_rules>
  <rule intent="pm.task_incomplete">User signals task creation intent but has not provided all required fields. Ask only for the title first — nothing else.</rule>
  <rule intent="pm.task_request">User has provided ALL required fields in a single message. Populate the task object fully. Only use this when title, description, and priority are all present.</rule>
  <rule intent="pm.task_query">User wants to check the status or details of an existing task. Extract the issue key into issueKey if mentioned; leave blank if not stated.</rule>
  <rule intent="pm.task_assign">User wants to reassign an existing task. Extract the issue key into issueKey and the assignee email into assigneeEmail. Only classify this when can_assign_tickets is true.</rule>
  <rule intent="out_of_scope">Request matches any item in operational_contract constraints. Apply the on_out_of_scope protocol immediately.</rule>
  <rule intent="general_inquiry|status_update|complaint">Everything else that is not task creation, query, assign, or out of scope.</rule>
  <answer_handling>
    <on_answer_to_question>If last_outbound ended with a question and user_inbound is any reply, accept it verbatim. Do NOT rephrase, reformat, or ask for confirmation. Move to the next question.</on_answer_to_question>
    <on_confirmation>If last_outbound proposed an action and user replied "yes", "ok", "sure", "can", or similar, treat it as confirmed. Do not ask again.</on_confirmation>
  </answer_handling>
</classification_rules>`;

  const taskProperties: Record<string, unknown> = {
    title:       { type: 'string' },
    description: { type: 'string' },
    priority:    { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
    ...(canAssignTickets ? { assigneeEmail: { type: ['string', 'null'] } } : {}),
  };

  try {
    const input = await getLLMAdapter(provider).call({
      model,
      systemPrompt: structuredSystem,
      messages: [...recentHistory, { role: 'user', content: text }],
      tools: [{
        name: 'route_intent',
        description: 'Classify user intent and extract task fields if applicable.',
        input_schema: {
          type: 'object' as const,
          properties: {
            reply:          { type: 'string', description: 'Plain text response to the user, no markdown.' },
            classification: { type: 'string', enum: ['general_inquiry', 'pm.task_request', 'pm.task_incomplete', 'pm.task_query', 'pm.task_assign', 'status_update', 'complaint', 'out_of_scope'] },
            confidence:     { type: 'number', description: 'Confidence score 0.0–1.0' },
            task: {
              type: 'object',
              description: 'Required when classification is pm.task_request.',
              properties: taskProperties,
              required: ['title', 'description', 'priority'],
            },
            issueKey:      { type: 'string', description: 'Issue key extracted from user message for pm.task_query or pm.task_assign (e.g. "KAN-3").' },
            assigneeEmail: { type: 'string', description: 'Assignee email extracted from user message for pm.task_assign.' },
          },
          required: ['reply', 'classification', 'confidence'],
        },
      }],
      toolName: 'route_intent',
      maxTokens,
      temperature,
    });
    return {
      reply:          (input.reply as string)          ?? "I'm sorry, I couldn't process that.",
      classification: (input.classification as string) ?? 'general_inquiry',
      confidence:     (input.confidence as number)     ?? 0.5,
      task:           input.task as TaskFields | undefined,
      issueKey:       input.issueKey as string | undefined,
      assigneeEmail:  input.assigneeEmail as string | undefined,
    };
  } catch (e) {
    console.error('[callLLM] API error:', e);
    // Return pm.task_incomplete so the route handler keeps gathering state intact.
    // The user's last message is preserved in conversationHistory — they can retry without restarting.
    return { reply: "Sorry, I hit a snag. Your conversation is saved — just send your message again.", classification: 'pm.task_incomplete', confidence: 0 };
  }
}

// ── Gathering-mode LLM (focused field extraction) ────────────────────────────

export interface GatheringResult {
  reply: string;
  classification: 'continuing' | 'ambiguous' | 'off_topic';
  extracted?: Partial<TaskFieldsState>;
}

export async function callLLMGathering({
  provider,
  model,
  text,
  maxTokens,
  temperature,
  systemPrompt,
  conversationHistory = [],
  taskFields,
  nextField,
  canAssignTickets,
  platform,
  localeHints,
}: {
  provider: string;
  model: string;
  text: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  taskFields: TaskFieldsState;
  nextField: keyof TaskFieldsState;
  canAssignTickets: boolean;
  platform: 'WhatsApp' | 'Microsoft Teams';
  localeHints?: string | null;
}): Promise<GatheringResult> {
  const recentHistory = conversationHistory.filter(t => t.content?.trim()).slice(-HISTORY_WINDOW);
  const lastOutbound = recentHistory.filter(t => t.role === 'assistant').at(-1)?.content ?? '(none)';

  const hypothetical = { ...taskFields, [nextField]: 'filled' };
  const nextNextField = getNextField(hypothetical, canAssignTickets);
  const afterExtraction = nextNextField
    ? `Then ask for the next missing field: ${FIELD_LABELS[nextNextField as keyof typeof FIELD_LABELS] ?? nextNextField}.`
    : `All required fields will then be complete — reply with a brief confirmation that you have everything and will create the ticket now. Do not mention a ticket number yet.`;

  const gatheringSystem = `${systemPrompt}

${buildLocaleContext(localeHints)}

${buildSessionState(taskFields, nextField, canAssignTickets)}

${buildInteractionAnchor(lastOutbound, text, `Direct answer to field request: ${nextField}`)}

${buildOperationalContract(
    [
      `Collect task fields in order: title, description, priority${canAssignTickets ? ', assignee email' : ''}.`,
    ],
    [
      `Cannot set due dates, update tickets, look up rosters, or collect fields outside the defined set.`,
    ],
    `Classify as "off_topic". Acknowledge briefly that the request is outside current scope and that the task is set aside.`
  )}

<classification_rules>
  <rule classification="continuing">user_inbound is a plausible answer to last_outbound — even if short, terse, or in colloquial form (e.g. "Critical", "High", "yes", a name, a sentence). Prefer this classification whenever the reply could reasonably be an answer.</rule>
  <rule classification="ambiguous">user_inbound is equally plausible as an answer or as a new unrelated request; genuinely cannot tell even after applying locale_context.</rule>
  <rule classification="off_topic">user_inbound is clearly unrelated to the ongoing task or last_outbound, or matches any item in operational_contract constraints. Apply on_out_of_scope.</rule>
  <tiebreak>When in doubt between "continuing" and "ambiguous", choose "continuing".</tiebreak>
</classification_rules>

<response_rules>
  <on_continuing>
    <extraction>Extract the value for "${nextField}" VERBATIM from user_inbound into the extracted object. Do not clean, rephrase, or normalise — except strip trailing filler particles if locale_context instructs it.</extraction>
    <reply_template>Got it. ${afterExtraction}</reply_template>
    <forbidden>Do NOT ask again for "${nextField}". Do NOT rephrase, confirm, or request a shorter version of the value just provided. Do NOT add commentary before or after the reply_template.</forbidden>
  </on_continuing>
  <on_ambiguous>
    <reply_template>Just to confirm — are you still working on the task we were discussing, or is this something new?</reply_template>
  </on_ambiguous>
  <on_off_topic>
    <action>Follow the on_out_of_scope protocol defined in operational_contract.</action>
  </on_off_topic>
  <global_constraints>Plain text only — no markdown, no bullet points. This is ${platform}.</global_constraints>
</response_rules>`;

  try {
    const input = await getLLMAdapter(provider).call({
      model,
      systemPrompt: gatheringSystem,
      messages: [{ role: 'user', content: text }],
      tools: [{
        name: 'extract_field',
        description: 'Classify the user reply and extract the field value if the reply is continuing.',
        input_schema: {
          type: 'object' as const,
          properties: {
            reply:          { type: 'string', description: 'Plain text response to the user, no markdown.' },
            classification: { type: 'string', enum: ['continuing', 'ambiguous', 'off_topic'] },
            extracted: {
              type: 'object',
              description: `Include only when classification is "continuing". Provide the extracted value for field: ${nextField}.`,
              properties: {
                title:         { type: 'string' },
                description:   { type: 'string' },
                priority:      { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
                assigneeEmail: { type: ['string', 'null'] },
              },
            },
          },
          required: ['reply', 'classification'],
        },
      }],
      toolName: 'extract_field',
      maxTokens,
      temperature,
    });
    return {
      reply:          (input.reply as string) ?? 'Got it.',
      classification: (input.classification as GatheringResult['classification']) ?? 'continuing',
      extracted:      input.extracted as Partial<TaskFieldsState> | undefined,
    };
  } catch (e) {
    console.error('[callLLMGathering] API error:', e);
    return { reply: 'Got it.', classification: 'continuing', extracted: { [nextField]: text } as Partial<TaskFieldsState> };
  }
}

// ── Decompose-mode LLM (multi-intent extraction) ─────────────────────────────

export interface DecomposedIntent {
  type: IntentType;
  issueKey?: string;       // for pm.task_query / pm.task_assign
  assigneeEmail?: string;  // for pm.task_assign
  task?: Partial<TaskFields>; // for pm.task_create when all fields provided upfront
}

export interface DecomposeResult {
  reply: string;
  confidence: number;
  intents: DecomposedIntent[];
}

export async function callLLMDecompose({
  provider,
  model,
  text,
  maxTokens,
  temperature,
  systemPrompt,
  conversationHistory = [],
  canAssignTickets = false,
  canAccessBca = false,
  localeHints,
}: {
  provider: string;
  model: string;
  text: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  canAssignTickets?: boolean;
  canAccessBca?: boolean;
  localeHints?: string | null;
}): Promise<DecomposeResult> {
  const recentHistory = conversationHistory.filter(t => t.content?.trim()).slice(-HISTORY_WINDOW);
  const lastOutbound = recentHistory.filter(t => t.role === 'assistant').at(-1)?.content ?? null;

  const decomposeSystem = `${systemPrompt}

${buildLocaleContext(localeHints)}

${buildInteractionAnchor(lastOutbound, text, normalModeIntentHint(lastOutbound))}

${buildOperationalContract(
    [
      `Create new tasks by collecting: title, description, priority${canAssignTickets ? ', assignee email' : ''}.`,
      `Check the status of an existing task by issue key.`,
      ...(canAssignTickets ? [`Reassign an existing task to a team member by issue key and email.`] : []),
      ...(canAccessBca ? [`Log today's site activities as a BCA-compliant site diary entry (Reg 22).`] : []),
      ...(canAccessBca ? [`Retrieve a previously logged site diary entry by date.`] : []),
      `Answer general questions about pmu.sg and its features.`,
    ],
    [
      `Cannot set due dates, delete tickets, look up rosters, or list available assignees.`,
      ...(!canAssignTickets ? [`Cannot reassign tasks — this requires a higher plan tier.`] : []),
      ...(!canAccessBca ? [`Cannot log or retrieve site diaries — BCA module not active on this account.`] : []),
    ],
    `Include an intent of type "out_of_scope" for any unsupported request. Politely decline in the reply.`
  )}

<decomposition_rules>
  <rule>
    <description>Identify every distinct intent in the user message. A single message may contain multiple intents.</description>
    <action>For each intent, set the type and extract any available fields (issueKey, assigneeEmail, task fields, site_project_id).</action>
  </rule>
  <rule intent="pm.task_create">
    <description>User wants to create a new project management task.</description>
    <action>Populate the task object only if title, description, and priority are ALL present. Otherwise leave task empty — fields will be gathered conversationally.</action>
  </rule>
  <rule intent="pm.task_query">
    <description>User wants to check the status or details of an existing task.</description>
    <action>Extract the issue key into issueKey if mentioned; leave blank if not stated.</action>
  </rule>
  <rule intent="pm.task_assign">
    <description>User wants to reassign an existing task to a team member.</description>
    <action>Extract issue key and assignee email. Only classify this when can_assign_tickets is true.</action>
  </rule>${canAccessBca ? `
  <rule intent="bca.site_diary_create">
    <description>User is reporting today's site activities — workers present, tasks completed, materials delivered, or instructions received from RE, RTO, or QP.</description>
    <signals>
      <signal>Trade or labour references: rebar, concrete, formwork, steel, electrical, plumbing, scaffolding</signal>
      <signal>Location references: block, level, grid line, zone, storey</signal>
      <signal>Personnel references: RE, RTO, QP, foreman, supervisor</signal>
      <signal>Material or delivery references: DO number, Grade 40, m3, tonnes, supplier delivery</signal>
      <signal>Inspection references: slump test, cube test, pre-pour check, inspection pass or fail</signal>
      <signal>Time references tied to site work: "poured at 3pm", "workers clocked in at 8", "finished by noon"</signal>
    </signals>
    <action>Classify as bca.site_diary_create. Do not ask for clarification on minor details — the AI extraction layer will handle structured parsing.</action>
  </rule>
  <rule intent="bca.site_diary_query">
    <description>User wants to retrieve or review a previously logged site diary entry.</description>
    <signals>
      <signal>References to a past date or shift: "yesterday", "this morning", "last Tuesday"</signal>
      <signal>Requests to check what was logged, submitted, or recorded</signal>
    </signals>
    <action>Extract the date reference if present. Reply with a summary of what was logged for that date.</action>
  </rule>` : ''}
  <rule intent="out_of_scope">
    <description>Request does not match any supported capability.</description>
    <action>Include an intent of type out_of_scope. Politely decline in the reply.</action>
  </rule>
  <rule intent="general_inquiry|status_update|complaint">
    <description>Everything else — general questions, status updates, complaints not related to task creation or site diary.</description>
    <action>Classify appropriately and respond conversationally.</action>
  </rule>
  <ordering>Order intents as they appear in the message. The first intent drives the opening reply.</ordering>
</decomposition_rules>`;

  const taskProperties: Record<string, unknown> = {
    title:       { type: 'string' },
    description: { type: 'string' },
    priority:    { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
    ...(canAssignTickets ? { assigneeEmail: { type: ['string', 'null'] } } : {}),
  };

  try {
    const input = await getLLMAdapter(provider).call({
      model,
      systemPrompt: decomposeSystem,
      messages: [...recentHistory, { role: 'user', content: text }],
      tools: [{
        name: 'decompose_intents',
        description: 'Identify all intents in the user message and extract available fields for each.',
        input_schema: {
          type: 'object' as const,
          properties: {
            reply:      { type: 'string', description: 'Plain text opening reply acknowledging all intents.' },
            confidence: { type: 'number', description: 'Confidence score 0.0–1.0' },
            intents: {
              type: 'array',
              description: 'All intents found in the message, in order.',
              items: {
                type: 'object',
                properties: {
                  type:          { type: 'string', enum: [
                    'pm.task_create', 'pm.task_query', 'pm.task_assign',
                    ...(canAccessBca ? ['bca.site_diary_create', 'bca.site_diary_query'] : []),
                    'general_inquiry', 'status_update', 'complaint', 'out_of_scope',
                  ] },
                  issueKey:      { type: 'string' },
                  assigneeEmail: { type: 'string' },
                  task: {
                    type: 'object',
                    description: 'Populate only when ALL required task fields are present in the message.',
                    properties: taskProperties,
                    required: ['title', 'description', 'priority'],
                  },
                },
                required: ['type'],
              },
            },
          },
          required: ['reply', 'confidence', 'intents'],
        },
      }],
      toolName: 'decompose_intents',
      maxTokens,
      temperature,
    });

    const rawIntents = (input.intents as DecomposedIntent[]) ?? [];
    return {
      reply:      (input.reply as string)      ?? "I'm on it.",
      confidence: (input.confidence as number) ?? 0.5,
      intents:    rawIntents.length > 0 ? rawIntents : [{ type: 'general_inquiry' }],
    };
  } catch (e) {
    console.error('[callLLMDecompose] API error:', e);
    return { reply: "I'm sorry, something went wrong. Please try again.", confidence: 0, intents: [{ type: 'general_inquiry' }] };
  }
}
