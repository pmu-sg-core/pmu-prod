// Trade code resolver — maps site voice/text to BCA ePSS trade codes.
// Uses bca_trade_codes + bca_resolution_rules from Supabase as the
// authoritative ontology. No hardcoded trade lists — all from DB.

import { supabase } from '@/lib/supabase';

export interface TradeCodeMatch {
  bca_code: string;
  description: string;
  productivity_unit: string;
  confidence: number;
  ambiguous: boolean;
  requery_template: string | null;   // set when ambiguous = true
}

interface TradeCodeRow {
  bca_code: string;
  description: string;
  singlish_aliases: string[];
  malay_aliases: string[];
  ambiguity_note: string | null;
  resolution_logic: string | null;
  productivity_unit: string;
  moat_score: number;
}

interface ResolutionRule {
  code_a: string;
  code_b: string;
  trigger_keywords: string[];
  resolution_rule: string;
  requery_template: string;
  answer_map: Record<string, string>;
  confidence_threshold: number;
}

// ── Load trade codes from DB (cached per request) ─────────────────────────────

let _tradeCodesCache: TradeCodeRow[] | null = null;
let _rulesCache: ResolutionRule[] | null = null;

async function loadTradeCodes(): Promise<TradeCodeRow[]> {
  if (_tradeCodesCache) return _tradeCodesCache;
  const { data, error } = await supabase
    .from('bca_trade_codes')
    .select('bca_code, description, singlish_aliases, malay_aliases, ambiguity_note, resolution_logic, productivity_unit, moat_score')
    .eq('is_active', true)
    .order('bca_code');
  if (error || !data) throw new Error(`Failed to load trade codes: ${error?.message}`);
  _tradeCodesCache = data as TradeCodeRow[];
  return _tradeCodesCache;
}

async function loadResolutionRules(): Promise<ResolutionRule[]> {
  if (_rulesCache) return _rulesCache;
  const { data, error } = await supabase
    .from('bca_resolution_rules')
    .select('code_a, code_b, trigger_keywords, resolution_rule, requery_template, answer_map, confidence_threshold')
    .eq('is_active', true);
  if (error || !data) return [];
  _rulesCache = data as ResolutionRule[];
  return _rulesCache;
}

// ── Core resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve a trade description / site keyword to a BCA trade code.
 * Returns the best match with confidence score and ambiguity flag.
 */
export async function resolveTradeCode(
  input: string,
): Promise<TradeCodeMatch | null> {
  const normalised = input.toLowerCase().trim();
  const codes = await loadTradeCodes();
  const rules = await loadResolutionRules();

  // Score each trade code against the input
  const scored = codes.map(tc => {
    let score = 0;

    // Exact alias match (highest confidence)
    const allAliases = [...tc.singlish_aliases, ...tc.malay_aliases].map(a => a.toLowerCase());
    if (allAliases.some(a => normalised.includes(a))) score += 0.7;

    // Partial keyword match
    const keywords = [...allAliases, tc.bca_code.toLowerCase(), ...tc.description.toLowerCase().split(' ')];
    const matchCount = keywords.filter(k => k.length > 3 && normalised.includes(k)).length;
    score += Math.min(matchCount * 0.1, 0.3);

    // Boost high-moat codes (more distinctive → more likely correct)
    score += (tc.moat_score - 3) * 0.02;

    return { tc, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];

  if (!best || best.score < 0.1) return null;

  // Check for ambiguity: if top two are close, look for a resolution rule
  const gap = best.score - (second?.score ?? 0);
  const isAmbiguous = gap < 0.15 && second !== undefined;

  if (isAmbiguous) {
    const rule = rules.find(r =>
      (r.code_a === best.tc.bca_code && r.code_b === second.tc.bca_code) ||
      (r.code_b === best.tc.bca_code && r.code_a === second.tc.bca_code)
    );

    if (rule) {
      const triggered = rule.trigger_keywords.some(k => normalised.includes(k.toLowerCase()));
      if (triggered) {
        return {
          bca_code: best.tc.bca_code,
          description: best.tc.description,
          productivity_unit: best.tc.productivity_unit,
          confidence: best.score,
          ambiguous: true,
          requery_template: rule.requery_template,
        };
      }
    }
  }

  return {
    bca_code: best.tc.bca_code,
    description: best.tc.description,
    productivity_unit: best.tc.productivity_unit,
    confidence: Math.min(best.score, 1.0),
    ambiguous: false,
    requery_template: null,
  };
}

/**
 * Resolve an ambiguous trade code using the foreman's clarification answer.
 * Returns the resolved BCA code or null if still unclear.
 */
export async function resolveAmbiguityFromAnswer(
  codeA: string,
  codeB: string,
  answer: string,
): Promise<string | null> {
  const rules = await loadResolutionRules();
  const rule = rules.find(r =>
    (r.code_a === codeA && r.code_b === codeB) ||
    (r.code_b === codeA && r.code_a === codeB)
  );
  if (!rule?.answer_map) return null;

  const normalised = answer.toLowerCase().trim();
  for (const [keyword, code] of Object.entries(rule.answer_map)) {
    if (normalised.includes(keyword.toLowerCase())) return code;
  }
  return null;
}

/**
 * Look up full trade code details by BCA code.
 */
export async function getTradeCode(bcaCode: string): Promise<TradeCodeRow | null> {
  const codes = await loadTradeCodes();
  return codes.find(tc => tc.bca_code === bcaCode) ?? null;
}

/** Invalidate the in-process cache (call after DB updates). */
export function invalidateTradeCodeCache(): void {
  _tradeCodesCache = null;
  _rulesCache = null;
}
