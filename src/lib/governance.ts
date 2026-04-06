import { supabase } from './supabase';

// ── Supabase return shape ─────────────────────────────────────────────────────

interface ConfigSettings {
  max_input_chars: number;
  max_output_tokens: number;
  model_provider: string;
  model_name: string;
  temperature: number;
  system_prompt: string;
  prompt_id: string;
  can_access_kb: boolean;
  enable_history: boolean;
  locale_hints: string | null;
}

interface SubscriptionRow {
  plan_type: string;
  plan_tiers: { config_settings: ConfigSettings | ConfigSettings[] }
            | { config_settings: ConfigSettings | ConfigSettings[] }[];
}

export interface AgentGovernance extends ConfigSettings {
  plan_type: string;
  can_assign_tickets: boolean;
  can_access_bca: boolean;
  site_project_id: string | null;   // active site project for BCA subscribers
  locale_hints: string | null;
  languages: string[];              // active input languages e.g. ['en','zh','ta']
}

export async function getAgentGovernance(
  identity: string,
  channel: 'whatsapp' | 'teams' = 'whatsapp',
): Promise<AgentGovernance | null> {
  const column = channel === 'teams' ? 'teams_user_id' : 'whatsapp_number';

  // ── Query 1: subscription + plan config ───────────────────────────────────
  const { data, error } = await supabase
    .from('subscriptions')
    .select(`
      id,
      plan_type,
      subscriber_id,
      plan_tiers!inner (
        config_settings (
          max_input_chars,
          max_output_tokens,
          model_provider,
          model_name,
          temperature,
          system_prompt,
          prompt_id,
          can_access_kb,
          enable_history,
          locale_hints
        )
      )
    `)
    .eq(column, identity)
    .single();

  if (error || !data) return null;

  const row = data as unknown as SubscriptionRow & { id: string; subscriber_id: string | null };
  const tier = Array.isArray(row.plan_tiers) ? row.plan_tiers[0] : row.plan_tiers;
  const rawConfig = tier?.config_settings;
  const config: ConfigSettings | null = rawConfig
    ? (Array.isArray(rawConfig) ? rawConfig[0] : rawConfig) ?? null
    : null;

  if (!config) return null;

  // ── Query 2: subscriber sector_tags (BCA gate) ────────────────────────────
  let sectorTags: string[] = [];
  if (row.subscriber_id) {
    const { data: sub } = await supabase
      .from('subscriber')
      .select('sector_tags')
      .eq('id', row.subscriber_id)
      .single();
    sectorTags = sub?.sector_tags ?? [];
  }

  // ── Query 3: first site project for this subscription ─────────────────────
  let siteProjectId: string | null = null;
  const { data: projects } = await supabase
    .from('site_projects')
    .select('id')
    .eq('subscription_id', row.id)
    .limit(1)
    .single();
  siteProjectId = projects?.id ?? null;

  const canAccessBca = sectorTags.includes('bca');

  return {
    ...config,
    plan_type: row.plan_type,
    can_assign_tickets: false,
    can_access_bca: canAccessBca,
    site_project_id: siteProjectId,
    // BCA construction sites default to the four common SG worker languages.
    // Override per-subscriber by adding a languages[] column to subscriber in future.
    languages: canAccessBca ? ['en', 'zh', 'ta', 'ms'] : ['en'],
  };
}
