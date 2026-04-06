-- ============================================================
-- Site Team Members — foreman and supervisor profiles per project
-- Required by ePSS API header: submitterNRIC, supervisorNRIC
-- NRIC stored masked (SXXXX123A) — never plain text at rest
-- ============================================================

CREATE TABLE IF NOT EXISTS public.site_team_members (
    id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    site_project_id     UUID    NOT NULL REFERENCES public.site_projects(id) ON DELETE CASCADE,

    -- Identity
    display_name        TEXT    NOT NULL,
    role                TEXT    NOT NULL,
    CONSTRAINT chk_team_role CHECK (role IN (
        'foreman',          -- submitter (NRIC used as submitterNRIC)
        'supervisor',       -- RE / RTO (NRIC used as supervisorNRIC)
        're',               -- Resident Engineer
        'rto',              -- Resident Technical Officer
        'qp',               -- Qualified Person
        'safety_officer',
        'other'
    )),

    -- NRIC — masked format only: S/T/F/G + 4 digits masked + letter
    -- e.g. 'SXXXX123A' — never store full NRIC plain text
    nric_masked         TEXT,
    CONSTRAINT chk_nric_format CHECK (
        nric_masked IS NULL OR nric_masked ~ '^[STFG]XXXX\d{3}[A-Z]$'
    ),

    -- Channel identity (WhatsApp number they submit from)
    whatsapp_number     TEXT,

    -- BEST biometric system reference (MOM cross-check)
    best_ref            TEXT,

    -- ePSS role flags
    is_submitter        BOOLEAN NOT NULL DEFAULT FALSE,   -- maps to submitterNRIC
    is_supervisor       BOOLEAN NOT NULL DEFAULT FALSE,   -- maps to supervisorNRIC

    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_team_member UNIQUE (site_project_id, nric_masked)
);

CREATE INDEX IF NOT EXISTS idx_team_project   ON public.site_team_members(site_project_id);
CREATE INDEX IF NOT EXISTS idx_team_role      ON public.site_team_members(role);
CREATE INDEX IF NOT EXISTS idx_team_whatsapp  ON public.site_team_members(whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_team_submitter ON public.site_team_members(site_project_id, is_submitter) WHERE is_submitter = TRUE;
CREATE INDEX IF NOT EXISTS idx_team_supervisor ON public.site_team_members(site_project_id, is_supervisor) WHERE is_supervisor = TRUE;
