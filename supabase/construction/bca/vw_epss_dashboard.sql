-- ============================================================
-- ePSS Dashboard Views
-- Powers the admin/site manager dashboard with submission
-- status, trade breakdown, and compliance compliance gaps.
-- ============================================================


-- ── 1. vw_epss_submission_status ─────────────────────────────────────────────
-- One row per diary entry — current submission state + key metadata.

CREATE OR REPLACE VIEW public.vw_epss_submission_status AS
SELECT
    de.id                               AS diary_entry_id,
    de.report_date,
    de.confidence_score                 AS extraction_confidence,
    de.validated_by,
    de.validated_at,

    -- Project context
    sp.project_ref,
    sp.project_name,
    sp.uen,

    -- Submission state (latest attempt)
    sub.status                          AS submission_status,
    sub.submission_ref,
    sub.error_code,
    sub.attempt_count,
    sub.last_attempted_at,
    sub.accepted_at,

    -- Record counts
    (SELECT COUNT(*) FROM public.epss_productivity_records r
     WHERE r.diary_entry_id = de.id)    AS trade_record_count,

    (SELECT COUNT(*) FROM public.epss_productivity_records r
     WHERE r.diary_entry_id = de.id
       AND r.requires_requery = TRUE)   AS pending_requery_count,

    -- Total workers across all trade records
    (SELECT SUM(r.worker_count) FROM public.epss_productivity_records r
     WHERE r.diary_entry_id = de.id)    AS total_workers,

    -- Diary lifecycle status
    ss.status_code                      AS diary_status,

    de.created_at

FROM public.site_diary_entries de
JOIN public.site_projects sp
     ON sp.id = de.site_project_id
LEFT JOIN public.epss_submissions sub
     ON sub.diary_entry_id = de.id
    AND sub.attempt_count = (
        SELECT MAX(s2.attempt_count)
        FROM public.epss_submissions s2
        WHERE s2.diary_entry_id = de.id
    )
LEFT JOIN public.system_status ss
     ON ss.id = de.status_fk
ORDER BY de.report_date DESC;


-- ── 2. vw_epss_trade_breakdown ────────────────────────────────────────────────
-- Per-project, per-date trade code summary for productivity reporting.

CREATE OR REPLACE VIEW public.vw_epss_trade_breakdown AS
SELECT
    sp.project_ref,
    sp.project_name,
    de.report_date,
    tc.bca_code,
    tc.category,
    tc.sub_category,
    tc.description                      AS trade_description,
    tc.productivity_unit,

    -- Aggregated productivity
    SUM(r.worker_count)                 AS total_workers,
    SUM(r.local_worker_count)           AS local_workers,
    SUM(r.foreign_worker_count)         AS foreign_workers,
    SUM(r.worker_man_days)              AS total_man_days,
    SUM(r.productivity_qty)             AS total_qty,

    -- Quality flags
    ROUND(AVG(r.confidence_score)::NUMERIC, 2) AS avg_confidence,
    BOOL_OR(r.requires_requery)         AS has_pending_requery,

    -- Submission ref (if accepted)
    MAX(sub.submission_ref)             AS submission_ref

FROM public.epss_productivity_records r
JOIN public.site_diary_entries de
     ON de.id = r.diary_entry_id
JOIN public.site_projects sp
     ON sp.id = de.site_project_id
JOIN public.bca_trade_codes tc
     ON tc.bca_code = r.trade_code
LEFT JOIN public.epss_submissions sub
     ON sub.diary_entry_id = de.id
    AND sub.status = 'accepted'
GROUP BY
    sp.project_ref, sp.project_name,
    de.report_date,
    tc.bca_code, tc.category, tc.sub_category, tc.description, tc.productivity_unit
ORDER BY de.report_date DESC, tc.bca_code;


-- ── 3. vw_epss_compliance_gaps ────────────────────────────────────────────────
-- Identifies diary entries that are not yet submitted to ePSS,
-- grouped by project. Used for compliance alerts and follow-ups.

CREATE OR REPLACE VIEW public.vw_epss_compliance_gaps AS
SELECT
    sp.project_ref,
    sp.project_name,
    sp.uen,
    COUNT(de.id)                        AS unsubmitted_entries,
    MIN(de.report_date)                 AS oldest_unsubmitted,
    MAX(de.report_date)                 AS latest_unsubmitted,
    -- Days since oldest unsubmitted (BCA requires same-day or next-day)
    CURRENT_DATE - MIN(de.report_date)  AS days_overdue
FROM public.site_diary_entries de
JOIN public.site_projects sp
     ON sp.id = de.site_project_id
WHERE NOT EXISTS (
    SELECT 1 FROM public.epss_submissions sub
    WHERE sub.diary_entry_id = de.id
      AND sub.status IN ('submitted','accepted')
)
GROUP BY sp.project_ref, sp.project_name, sp.uen
HAVING COUNT(de.id) > 0
ORDER BY days_overdue DESC;
