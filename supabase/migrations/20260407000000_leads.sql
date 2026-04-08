-- Add lead tracking columns to waitlist for BCA contractor outreach
ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS bca_grade      TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS outreach_status TEXT NOT NULL DEFAULT 'new';

-- bca_grade: contractor grade from BCA eBACS directory (A1, A2, B1, B2, C1)
--   NULL for organic signups where grade is unknown at submission time.
-- outreach_status: lead lifecycle tracker
--   values: new | contacted | replied | demo_booked | converted | disqualified
--   default 'new' safely covers all pre-existing rows without a backfill.
