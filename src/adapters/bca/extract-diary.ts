// BCA Site Diary — Voice-to-JSON extraction adapter.
// Takes a raw voice note transcript and project context, returns a fully
// structured BCA diary JSON aligned with Regulation 22 and SGBuildex schema.

import { AnthropicAdapter } from '@/adapters/llm/anthropic';

const llm = new AnthropicAdapter();

// ── BCA Trade Code Reference ──────────────────────────────────────────────────
// Used in the prompt so the AI can map informal descriptions to EPSS codes.

const TRADE_CODE_REFERENCE = `
SS01 = Structural Steel Work
RC01 = Reinforced Concrete Work
EL01 = Electrical Installation
PL01 = Plumbing & Sanitary
CR01 = Carpentry Work
PT01 = Painting Work
TL01 = Tiling Work
AL01 = Aluminium & Glazing Work
ME01 = Mechanical & ACMV (Air-conditioning, Mechanical Ventilation)
WP01 = Waterproofing Work
SC01 = Scaffolding
GE01 = General Works / Labour
`.trim();

// ── Output schema type ────────────────────────────────────────────────────────

export interface BcaDiaryJSON {
  metadata: {
    project_id: string;
    report_date: string;
    submission_timestamp: string;
    weather: { am: string | null; pm: string | null; impact_on_work: string | null };
    geolocation: { lat: number | null; long: number | null; verified: boolean };
  };
  manpower_epss_compliance: Array<{
    worker_id_masked: string;
    employer_uen: string | null;
    trade_code: string;
    trade_description: string;
    attendance: { time_in: string | null; time_out: string | null; total_man_hours: number | null };
  }>;
  site_activities_reg_22: {
    structural_works: Array<{
      location: string;
      task: string;
      status: string;
      verified_by_re_rto: string | null;
    }>;
    concreting_records: {
      check_id: string | null;
      pre_pour_inspection: string | null;
      slump_test_result: string | null;
      cube_test_id: string | null;
    } | null;
    instructions_received: string[];
  };
  logistics_materials: Array<{
    item: string;
    quantity: number | null;
    unit: string | null;
    supplier_uen: string | null;
    do_number: string | null;
    status: string;
  }>;
  agentic_audit_trail: {
    raw_input_type: string;
    raw_transcript: string;
    ai_logic_flags: string[];
    confidence_score: number;
    human_in_the_loop_validation: { validated_by: string | null; validation_time: string | null };
  };
  epss_trade_summary?: Array<{
    trade_code: string;
    trade_description: string;
    worker_count: number;
    local_worker_count: number;
    foreign_worker_count: number;
  }>;
}

export interface DiaryExtractionResult {
  diary: BcaDiaryJSON;
  confidence: number;
  flags: string[];
}

// ── Extraction function ───────────────────────────────────────────────────────

// ── Language config ───────────────────────────────────────────────────────────

const LANGUAGE_HINTS: Record<string, { label: string; examples: string[] }> = {
  en: {
    label: 'English / Singlish',
    examples: ['8 RC workers lah', 'pour concrete already', 'formwork done'],
  },
  zh: {
    label: 'Mandarin / Simplified Chinese',
    examples: ['今天有8个钢筋工人', '浇筑混凝土', '模板工程', '钢筋绑扎'],
  },
  ta: {
    label: 'Tamil',
    examples: ['இன்று 8 RC தொழிலாளர்கள்', 'கான்கிரீட் ஊற்றினோம்', 'அச்சு வேலை'],
  },
  ms: {
    label: 'Malay / Bahasa',
    examples: ['8 pekerja besi beton', 'tuang konkrit', 'acuan siap'],
  },
  hi: {
    label: 'Hindi',
    examples: ['आज 8 RC मजदूर थे', 'कंक्रीट डाला', 'फॉर्मवर्क हो गया'],
  },
  bn: {
    label: 'Bengali',
    examples: ['আজ ৮ জন RC শ্রমিক', 'কংক্রিট ঢালাই', 'ফর্মওয়ার্ক'],
  },
};

function buildMultilingualSection(languages: string[]): string {
  if (languages.length === 0) return '';
  const active = languages
    .filter(l => LANGUAGE_HINTS[l])
    .map(l => {
      const h = LANGUAGE_HINTS[l];
      return `- ${h.label} (e.g. "${h.examples.join('", "')}")`;
    })
    .join('\n');
  if (!active) return '';
  return `\nMULTILINGUAL INPUT — accept messages in any of these languages:\n${active}\nALWAYS output JSON fields in English. Map trade terms by meaning across languages — e.g. 钢筋 / besi beton / RC = rebar = Reinforced Concrete Work = C1.5.\n`;
}

export async function extractDiaryFromTranscript(params: {
  transcript: string;
  projectId: string;
  reportDate: string;        // ISO date YYYY-MM-DD
  lat?: number | null;
  long?: number | null;
  geolocationVerified?: boolean;
  platform?: string;         // 'WhatsApp Voice Note' | 'WhatsApp Text' | 'Microsoft Teams'
  languages?: string[];      // e.g. ['en','zh','ta'] — active languages for this subscriber
  model?: string;
}): Promise<DiaryExtractionResult> {
  const {
    transcript,
    projectId,
    reportDate,
    lat = null,
    long = null,
    geolocationVerified = false,
    platform = 'WhatsApp Voice Note',
    languages = ['en'],
    model = 'claude-sonnet-4-6',
  } = params;

  const submissionTimestamp = new Date().toISOString();

  const systemPrompt = `You are a BCA-certified Site Diary AI for Singapore construction sites.
Your job is to extract structured data from raw voice notes or text messages sent by site workers and PMs.
You must map informal speech to the official BCA Regulation 22 schema.
${buildMultilingualSection(languages)}
EXTRACTION TARGETS — scan the transcript for all three:
1. MANPOWER: Any mention of workers, trades, arrival/departure times, headcount.
   Map trade descriptions to BCA EPSS trade codes using this reference:
${TRADE_CODE_REFERENCE}
   Mask worker IDs to format SXXXX999A. If UEN not mentioned, leave null.

2. SITE ACTIVITIES (Reg 22):
   - Structural works: any mention of rebar, formwork, pouring, steel, piling, inspection.
     Extract: location (block/level/grid), task description, status, RE/RTO name + number if mentioned.
   - Concreting records: if concrete pour mentioned, extract slump test, cube test IDs.
   - Instructions received: any instruction from QP, RE, consultant, or authority.

3. LOGISTICS / MATERIALS: Any mention of deliveries, materials, quantities, DO numbers, suppliers.
   Common items: concrete (m3), rebar/steel (tonnes), formwork, bricks, sand, aggregate.

RULES:
- If a field is not mentioned, set it to null (do not guess or fabricate).
- Infer status as "Completed" if past tense, "In Progress" if present, "Pending" if future.
- For weather: if not mentioned in the transcript, set all weather fields to null.
- confidence_score reflects how complete and unambiguous the extraction is (0.0–1.0).
- ai_logic_flags: include "Entity_Recognition_Success" if entities were found,
  "Compliance_Mapping_Confirmed" if trade codes were mapped,
  "Incomplete_Data" if key fields are missing,
  "Concreting_Detected" if a pour was mentioned (triggers mandatory slump/cube check).`;

  const input = await llm.call({
    model,
    systemPrompt,
    messages: [{ role: 'user', content: `Extract site diary data from this transcript:\n\n"${transcript}"` }],
    tools: [{
      name: 'extract_bca_diary',
      description: 'Extract structured BCA Regulation 22 site diary data from a voice note transcript.',
      input_schema: {
        type: 'object' as const,
        properties: {
          weather: {
            type: 'object',
            properties: {
              am:             { type: ['string', 'null'] },
              pm:             { type: ['string', 'null'] },
              impact_on_work: { type: ['string', 'null'] },
            },
          },
          manpower_epss_compliance: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                worker_id_masked:  { type: 'string' },
                employer_uen:      { type: ['string', 'null'] },
                trade_code:        { type: 'string' },
                trade_description: { type: 'string' },
                time_in:           { type: ['string', 'null'] },
                time_out:          { type: ['string', 'null'] },
                total_man_hours:   { type: ['number', 'null'] },
              },
              required: ['worker_id_masked', 'trade_code', 'trade_description'],
            },
          },
          structural_works: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                location:          { type: 'string' },
                task:              { type: 'string' },
                status:            { type: 'string', enum: ['Pending', 'In Progress', 'Completed', 'Deferred'] },
                verified_by_re_rto:{ type: ['string', 'null'] },
              },
              required: ['location', 'task', 'status'],
            },
          },
          concreting_records: {
            type: ['object', 'null'],
            properties: {
              check_id:            { type: ['string', 'null'] },
              pre_pour_inspection: { type: ['string', 'null'] },
              slump_test_result:   { type: ['string', 'null'] },
              cube_test_id:        { type: ['string', 'null'] },
            },
          },
          instructions_received: {
            type: 'array',
            items: { type: 'string' },
          },
          logistics_materials: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                item:         { type: 'string' },
                quantity:     { type: ['number', 'null'] },
                unit:         { type: ['string', 'null'] },
                supplier_uen: { type: ['string', 'null'] },
                do_number:    { type: ['string', 'null'] },
                status:       { type: 'string', enum: ['Pending', 'Delivered', 'Rejected', 'Partial'] },
              },
              required: ['item', 'status'],
            },
          },
          confidence_score: { type: 'number' },
          ai_logic_flags:   { type: 'array', items: { type: 'string' } },
        },
        required: ['manpower_epss_compliance', 'structural_works', 'logistics_materials', 'confidence_score', 'ai_logic_flags'],
      },
    }],
    toolName: 'extract_bca_diary',
    maxTokens: 2048,
    temperature: 0.2, // low temp for structured extraction
  });

  const raw = input as any;
  const confidence = (raw.confidence_score as number) ?? 0.5;
  const flags = (raw.ai_logic_flags as string[]) ?? [];

  const diary: BcaDiaryJSON = {
    metadata: {
      project_id: projectId,
      report_date: reportDate,
      submission_timestamp: submissionTimestamp,
      weather: {
        am:             raw.weather?.am ?? null,
        pm:             raw.weather?.pm ?? null,
        impact_on_work: raw.weather?.impact_on_work ?? null,
      },
      geolocation: { lat, long, verified: geolocationVerified },
    },
    manpower_epss_compliance: (raw.manpower_epss_compliance ?? []).map((m: any) => ({
      worker_id_masked:  m.worker_id_masked,
      employer_uen:      m.employer_uen ?? null,
      trade_code:        m.trade_code,
      trade_description: m.trade_description,
      attendance: {
        time_in:         m.time_in ?? null,
        time_out:        m.time_out ?? null,
        total_man_hours: m.total_man_hours ?? null,
      },
    })),
    site_activities_reg_22: {
      structural_works:    raw.structural_works ?? [],
      concreting_records:  raw.concreting_records ?? null,
      instructions_received: raw.instructions_received ?? [],
    },
    logistics_materials: (raw.logistics_materials ?? []).map((l: any) => ({
      item:         l.item,
      quantity:     l.quantity ?? null,
      unit:         l.unit ?? null,
      supplier_uen: l.supplier_uen ?? null,
      do_number:    l.do_number ?? null,
      status:       l.status,
    })),
    agentic_audit_trail: {
      raw_input_type: platform,
      raw_transcript: transcript,
      ai_logic_flags: flags,
      confidence_score: confidence,
      human_in_the_loop_validation: {
        validated_by:    null, // set after human validation
        validation_time: null,
      },
    },
  };

  return { diary, confidence, flags };
}
