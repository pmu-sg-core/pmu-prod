-- Add per-subscriber language override (replaces hardcoded BCA set in governance.ts).
-- NULL means "use plan default" — governance falls back to ['en','zh','ta','ms'] for BCA subs.
ALTER TABLE public.subscriber
    ADD COLUMN IF NOT EXISTS languages TEXT[];

-- Add pending_requery JSONB to active_conversations for the local/foreign worker requery flow.
-- Shape: { diaryEntryId: string, records: [{ id, trade_code, trade_description, worker_count, requery_template }] }
-- NULL when no requery is in flight.
ALTER TABLE public.active_conversations
    ADD COLUMN IF NOT EXISTS pending_requery JSONB;

-- Guard against malformed payloads — both top-level keys must be present or the column is NULL.
ALTER TABLE public.active_conversations
    ADD CONSTRAINT chk_pending_requery_shape CHECK (
        pending_requery IS NULL
        OR (pending_requery ? 'diaryEntryId' AND pending_requery ? 'records')
    );
