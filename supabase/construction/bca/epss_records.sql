-- ============================================================
-- ePSS Productivity Records + Submission Tracking
-- Aligned to BCA ePSS API: POST /api/v2/productivity
--
-- Tables:
--   1. epss_productivity_records  — per-trade records (records[n])
--   2. epss_submissions           — submission lifecycle tracking
-- ============================================================


-- ── 1. epss_productivity_records ─────────────────────────────────────────────
-- One row per trade per diary entry.
-- Maps 1:1 to records[n] in the ePSS API payload.

CREATE TABLE IF NOT EXISTS public.epss_productivity_records (
    id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    diary_entry_id          UUID    NOT NULL REFERENCES public.site_diary_entries(id) ON DELETE CASCADE,

    -- ePSS trade classification (C1.x / A2.x / M8.x etc.)
    trade_code              TEXT    NOT NULL REFERENCES public.bca_trade_codes(bca_code),
    trade_description       TEXT,               -- auto-populated from bca_trade_codes.description

    -- Manpower (ePSS required fields)
    worker_count            INT     NOT NULL CHECK (worker_count >= 1),
    local_worker_count      INT     NOT NULL DEFAULT 0,
    foreign_worker_count    INT     NOT NULL DEFAULT 0,
    worker_man_days         NUMERIC(6,2),       -- local + foreign man-days total
    CONSTRAINT chk_worker_split CHECK (local_worker_count + foreign_worker_count = worker_count),

    -- Supervisor (RE/RTO NRIC — pre-stored from site_team_members)
    supervisor_nric_masked  TEXT,

    -- Work location (required for multi-building projects)
    work_location           TEXT,               -- e.g. 'Level 12, Block A, Grid C-D'

    -- Productivity output
    productivity_qty        NUMERIC(10,2),      -- quantity completed today
    productivity_unit       TEXT,               -- m2 | m3 | nr | lg | tonne (from trade code)
    CONSTRAINT chk_epss_unit CHECK (productivity_unit IN ('m2','m3','nr','lg','tonne')),

    -- BEST biometric cross-reference (MOM integration)
    biometric_ref           TEXT,               -- UUID from BEST API, or null if manual

    -- AI extraction confidence for this record
    confidence_score        FLOAT   CHECK (confidence_score BETWEEN 0 AND 1),

    -- Flags
    requires_requery        BOOLEAN NOT NULL DEFAULT FALSE,  -- ambiguity not resolved
    requery_field           TEXT,               -- which field to re-ask
    requery_template        TEXT,               -- from bca_resolution_rules

    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_epss_records_diary   ON public.epss_productivity_records(diary_entry_id);
CREATE INDEX IF NOT EXISTS idx_epss_records_trade   ON public.epss_productivity_records(trade_code);
CREATE INDEX IF NOT EXISTS idx_epss_records_requery ON public.epss_productivity_records(requires_requery) WHERE requires_requery = TRUE;


-- ── 2. epss_submissions ───────────────────────────────────────────────────────
-- Tracks each submission attempt to the BCA ePSS API.
-- One diary entry → potentially multiple attempts (retry logic).

CREATE TABLE IF NOT EXISTS public.epss_submissions (
    id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    diary_entry_id          UUID    NOT NULL REFERENCES public.site_diary_entries(id) ON DELETE CASCADE,

    -- ePSS API header fields
    epss_project_id         TEXT,               -- BCA project ID (from site_projects.project_ref)
    submitter_nric_masked   TEXT,               -- foreman NRIC (masked)
    contractor_bizfile      TEXT,               -- UEN (from subscriber.uen)
    submission_date         DATE    NOT NULL,

    -- Submission outcome
    status                  TEXT    NOT NULL DEFAULT 'pending',
    CONSTRAINT chk_submission_status CHECK (status IN (
        'pending',      -- queued, not yet sent
        'submitted',    -- POST sent, awaiting response
        'accepted',     -- BCA confirmed receipt
        'error',        -- BCA returned error
        'rejected'      -- BCA rejected — validation failure
    )),

    -- BCA response
    submission_ref          TEXT,               -- e.g. 'BCA-SUB-2024-98765'
    error_code              TEXT,               -- e.g. 'ERR_TRADE_CODE_INVALID'
    error_detail            TEXT,               -- full error message from BCA

    -- Retry tracking
    attempt_count           INT     NOT NULL DEFAULT 1,
    last_attempted_at       TIMESTAMPTZ DEFAULT NOW(),
    accepted_at             TIMESTAMPTZ,

    -- Full API payload for audit
    payload_snapshot        JSONB,              -- the exact JSON sent to ePSS
    response_snapshot       JSONB,              -- the exact JSON received from ePSS

    created_at              TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_epss_submission UNIQUE (diary_entry_id, attempt_count)
);

CREATE INDEX IF NOT EXISTS idx_epss_sub_diary   ON public.epss_submissions(diary_entry_id);
CREATE INDEX IF NOT EXISTS idx_epss_sub_status  ON public.epss_submissions(status);
CREATE INDEX IF NOT EXISTS idx_epss_sub_ref     ON public.epss_submissions(submission_ref);
CREATE INDEX IF NOT EXISTS idx_epss_sub_pending ON public.epss_submissions(status, last_attempted_at) WHERE status IN ('pending','error');


-- ── Register ePSS adapter in system_adapters ──────────────────────────────────

INSERT INTO public.system_adapters (code, name, function_id, is_active)
SELECT 'epss_api', 'BCA ePSS Productivity API', bf.id, FALSE
FROM public.business_functions bf WHERE bf.code = 'bca'
ON CONFLICT (code) DO NOTHING;
