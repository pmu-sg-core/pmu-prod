-- ============================================================
-- BCA Trade Code Ambiguity Resolution Rules — pmu.sg IP v1.0
-- Powers the RAG disambiguation layer in the agent pipeline.
-- Each rule defines a conflict pair, trigger keywords, resolution
-- logic, re-query template, and confidence threshold.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bca_resolution_rules (
    id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The two competing codes this rule resolves
    code_a                  TEXT    NOT NULL REFERENCES public.bca_trade_codes(bca_code),
    code_b                  TEXT    NOT NULL REFERENCES public.bca_trade_codes(bca_code),

    -- Trigger: keywords that activate this rule
    trigger_keywords        TEXT[]  NOT NULL DEFAULT '{}',

    -- Context: signals that help disambiguate
    context_signals         TEXT,

    -- Resolution: deterministic rule
    resolution_rule         TEXT    NOT NULL,

    -- Re-query: what to ask the foreman if ambiguous
    requery_template        TEXT    NOT NULL,

    -- Expected answer patterns → outcome mapping
    -- e.g. '{"cast in-situ": "C1.5", "precast": "C1.6"}'
    answer_map              JSONB,

    -- Confidence threshold below which human review is triggered
    confidence_threshold    NUMERIC(3,2) NOT NULL DEFAULT 0.85,

    -- Escalation if confidence < threshold
    escalation_path         TEXT    DEFAULT 'Human review',

    ip_classification       TEXT    DEFAULT 'Core Ontology',
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_resolution_pair UNIQUE (code_a, code_b)
);

CREATE INDEX IF NOT EXISTS idx_resolution_code_a ON public.bca_resolution_rules(code_a);
CREATE INDEX IF NOT EXISTS idx_resolution_code_b ON public.bca_resolution_rules(code_b);


-- ── Seed: 10 resolution rules ─────────────────────────────────────────────────

INSERT INTO public.bca_resolution_rules
    (code_a, code_b, trigger_keywords, context_signals, resolution_rule,
     requery_template, answer_map, confidence_threshold, escalation_path, ip_classification)
VALUES

('C1.5','C1.6',
 ARRAY['concrete','pour','casting','RC'],
 'precast, PC, prefab absent',
 'Default → C1.5. If ''precast'' or ''PC'' detected → C1.6',
 'Was this precast concrete or cast in-situ?',
 '{"cast in-situ": "C1.5", "precast": "C1.6", "PC": "C1.6", "in-situ": "C1.5"}',
 0.85, 'Human review if <0.7', 'Core Ontology'),

('A3.1','A3.2',
 ARRAY['tile','tiling','jubin'],
 'No location context',
 'Require location: floor → A3.1, wall → A3.2',
 'Tiling on floor or wall?',
 '{"floor": "A3.1", "ground": "A3.1", "wall": "A3.2", "toilet": "A3.2", "bathroom": "A3.2"}',
 0.90, 'Human review', 'Core Ontology'),

('A6.1','A6.2',
 ARRAY['waterproof','WP','kalis air'],
 'No location context',
 'Internal rooms/tanks → A6.1. Roof/balcony/ext → A6.2',
 'Waterproofing for toilet/tank or roof/balcony?',
 '{"toilet": "A6.1", "tank": "A6.1", "roof": "A6.2", "balcony": "A6.2", "basement": "A6.2", "external": "A6.2"}',
 0.85, 'Human review', 'Core Ontology'),

('M8.2','M8.3',
 ARRAY['fire','bomba','kebakaran'],
 'Check for ''alarm'' vs ''pipe/sprinkler''',
 '''Alarm''/''detector'' → M8.2. ''Sprinkler''/''hose reel'' → M8.3',
 'Is this fire alarm system or sprinkler/pipe works?',
 '{"alarm": "M8.2", "detector": "M8.2", "sprinkler": "M8.3", "hose reel": "M8.3", "pipe": "M8.3"}',
 0.85, 'Human review', 'Core Ontology'),

('S12.2','C1.9',
 ARRAY['scaffold','perancah','form','acuan'],
 'Check for ''scaffold'' vs ''formwork''',
 '''Scaffold'' → S12.2. ''Formwork''/''shuttering'' → C1.9',
 'Is this scaffolding or formwork?',
 '{"scaffold": "S12.2", "bamboo": "S12.2", "formwork": "C1.9", "shuttering": "C1.9", "prop": "C1.9"}',
 0.90, 'Human review', 'Core Ontology'),

('C1.3','C1.4',
 ARRAY['excavat','dig','gali','retaining'],
 'Check for ''retain''/''shore''/''sheet pile''',
 'Generic dig → C1.3. Retaining/shoring → C1.4',
 'Is this general excavation or a retaining wall/shoring system?',
 '{"excavation": "C1.3", "dig": "C1.3", "retaining": "C1.4", "shoring": "C1.4", "sheet pile": "C1.4"}',
 0.80, 'Human review', 'Core Ontology'),

('S14.1','C1.6',
 ARRAY['IBS','precast','PPVC','PBU','modular'],
 'Check for ''PPVC''/''PBU''/''volumetric''',
 '''PPVC''/''PBU''/''volumetric'' → S14.1. Generic precast → C1.6',
 'Is this a PPVC/PBU module or standard precast element?',
 '{"PPVC": "S14.1", "PBU": "S14.1", "volumetric": "S14.1", "standard": "C1.6", "panel": "C1.6"}',
 0.88, 'Human review', 'Core Ontology'),

('A2.2','A3.2',
 ARRAY['stone','granite','cladding'],
 'Natural material vs tile product',
 '''Natural stone'' → A2.2; ''tile'' or ''homogeneous'' → A3.2',
 'Is this natural stone cladding or tile cladding?',
 '{"natural stone": "A2.2", "granite slab": "A2.2", "tile": "A3.2", "homogeneous": "A3.2"}',
 0.85, 'Human review', 'Core Ontology'),

('A6.2','S13.1',
 ARRAY['roof','bumbung','atap'],
 'Waterproofing layer vs structural roof',
 'Structural roof deck/skylight → S13.1; WP membrane only → A6.2',
 'Is this structural roofing works or just the waterproofing layer?',
 '{"structural": "S13.1", "metal deck": "S13.1", "skylight": "S13.1", "waterproof": "A6.2", "membrane": "A6.2"}',
 0.85, 'Human review', 'Core Ontology'),

('A5.1','A5.2',
 ARRAY['door','window','grille','tingkap','pintu'],
 'Material keyword: aluminium vs steel',
 '''Aluminium''/''alu'' → A5.1. ''Steel''/''security''/''fire door'' → A5.2',
 'Is this aluminium or steel door/window?',
 '{"aluminium": "A5.1", "alu": "A5.1", "sliding": "A5.1", "steel": "A5.2", "security": "A5.2", "fire door": "A5.2"}',
 0.88, 'Human review', 'Core Ontology')

ON CONFLICT (code_a, code_b) DO UPDATE SET
    trigger_keywords     = EXCLUDED.trigger_keywords,
    context_signals      = EXCLUDED.context_signals,
    resolution_rule      = EXCLUDED.resolution_rule,
    requery_template     = EXCLUDED.requery_template,
    answer_map           = EXCLUDED.answer_map,
    confidence_threshold = EXCLUDED.confidence_threshold;
