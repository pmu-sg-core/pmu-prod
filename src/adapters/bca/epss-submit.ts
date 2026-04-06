// ePSS API submission adapter — POST /api/v2/productivity
// Builds the BCA ePSS payload, validates required fields,
// submits with retry logic, and persists the outcome.

import { supabase } from '@/lib/supabase';

// ── ePSS payload types ────────────────────────────────────────────────────────

interface EpssRecord {
  tradeCode: string;
  tradeDescription: string;
  workerCount: number;
  localWorkerCount: number;
  foreignWorkerCount: number;
  workerManDays: number;
  supervisorNRIC: string;
  workLocation: string;
  productivityUnit: string;
  productivityQty: number | null;
  biometricRef: string | null;
}

interface EpssPayload {
  header: {
    projectId: string;
    submissionDate: string;       // ISO 8601 date
    submitterNRIC: string;
    contractorBizfile: string;    // UEN
  };
  records: EpssRecord[];
}

interface EpssResponse {
  status: 'submitted' | 'accepted' | 'error' | 'rejected';
  submissionRef?: string;
  errorCode?: string;
  errorDetail?: string;
}

// ── Validation ────────────────────────────────────────────────────────────────

interface ValidationError {
  field: string;
  message: string;
}

function validatePayload(payload: EpssPayload): ValidationError[] {
  const errors: ValidationError[] = [];
  const { header, records } = payload;

  if (!header.projectId) errors.push({ field: 'projectId', message: 'Project ID is required' });
  if (!header.submitterNRIC) errors.push({ field: 'submitterNRIC', message: 'Submitter NRIC is required' });
  if (!header.contractorBizfile) errors.push({ field: 'contractorBizfile', message: 'Contractor UEN is required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(header.submissionDate)) {
    errors.push({ field: 'submissionDate', message: 'Submission date must be ISO 8601 (YYYY-MM-DD)' });
  }

  records.forEach((r, i) => {
    if (!r.tradeCode) errors.push({ field: `records[${i}].tradeCode`, message: 'Trade code required' });
    if (r.workerCount < 1) errors.push({ field: `records[${i}].workerCount`, message: 'Worker count must be ≥1' });
    if (r.localWorkerCount + r.foreignWorkerCount !== r.workerCount) {
      errors.push({ field: `records[${i}].workerSplit`, message: 'Local + foreign must equal total worker count' });
    }
    if (!r.supervisorNRIC) errors.push({ field: `records[${i}].supervisorNRIC`, message: 'Supervisor NRIC required' });
  });

  return errors;
}

// ── Payload builder ───────────────────────────────────────────────────────────

export async function buildEpssPayload(diaryEntryId: string): Promise<{
  payload: EpssPayload | null;
  errors: ValidationError[];
}> {
  // Load diary entry + project + subscriber
  const { data: entry } = await supabase
    .from('site_diary_entries')
    .select(`
      id, report_date,
      site_projects (
        project_ref,
        subscriptions ( subscriber ( uen ) )
      )
    `)
    .eq('id', diaryEntryId)
    .single();

  if (!entry) return { payload: null, errors: [{ field: 'diaryEntryId', message: 'Diary entry not found' }] };

  const project = (entry as any).site_projects;
  const subscriber = project?.subscriptions?.subscriber;

  // Load the submitter (foreman) for this project
  const { data: submitter } = await supabase
    .from('site_team_members')
    .select('nric_masked')
    .eq('site_project_id', project?.id ?? '')
    .eq('is_submitter', true)
    .eq('is_active', true)
    .single();

  // Load productivity records
  const { data: records } = await supabase
    .from('epss_productivity_records')
    .select('*')
    .eq('diary_entry_id', diaryEntryId);

  if (!records?.length) {
    return { payload: null, errors: [{ field: 'records', message: 'No productivity records found for this diary entry' }] };
  }

  const payload: EpssPayload = {
    header: {
      projectId:        project?.project_ref ?? '',
      submissionDate:   entry.report_date,
      submitterNRIC:    submitter?.nric_masked ?? '',
      contractorBizfile: subscriber?.uen ?? '',
    },
    records: records.map(r => ({
      tradeCode:           r.trade_code,
      tradeDescription:    r.trade_description ?? '',
      workerCount:         r.worker_count,
      localWorkerCount:    r.local_worker_count,
      foreignWorkerCount:  r.foreign_worker_count,
      workerManDays:       r.worker_man_days ?? r.worker_count,
      supervisorNRIC:      r.supervisor_nric_masked ?? '',
      workLocation:        r.work_location ?? '',
      productivityUnit:    r.productivity_unit ?? '',
      productivityQty:     r.productivity_qty ?? null,
      biometricRef:        r.biometric_ref ?? null,
    })),
  };

  const errors = validatePayload(payload);
  return { payload: errors.length === 0 ? payload : null, errors };
}

// ── Submission ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = [1000, 3000, 9000]; // exponential backoff

export async function submitToEpss(diaryEntryId: string): Promise<{
  success: boolean;
  submissionRef?: string;
  errorCode?: string;
  errors?: ValidationError[];
}> {
  const { payload, errors } = await buildEpssPayload(diaryEntryId);

  if (!payload) return { success: false, errors };

  // Get current attempt count
  const { data: existing } = await supabase
    .from('epss_submissions')
    .select('attempt_count')
    .eq('diary_entry_id', diaryEntryId)
    .order('attempt_count', { ascending: false })
    .limit(1)
    .single();

  const attemptCount = (existing?.attempt_count ?? 0) + 1;

  // Insert submission record (pending)
  const { data: sub } = await supabase
    .from('epss_submissions')
    .insert({
      diary_entry_id:       diaryEntryId,
      epss_project_id:      payload.header.projectId,
      submitter_nric_masked: payload.header.submitterNRIC,
      contractor_bizfile:   payload.header.contractorBizfile,
      submission_date:      payload.header.submissionDate,
      status:               'pending',
      attempt_count:        attemptCount,
      payload_snapshot:     payload,
    })
    .select('id')
    .single();

  if (!sub) return { success: false, errorCode: 'DB_ERROR' };

  // Submit to ePSS API with retry
  let response: EpssResponse | null = null;
  const epssBaseUrl = process.env.BCA_EPSS_API_URL ?? 'https://api.epss.bca.gov.sg';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${epssBaseUrl}/api/v2/productivity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.BCA_EPSS_API_KEY ?? ''}`,
          'X-BCA-Version': '2',
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json() as EpssResponse;
      response = { ...body, status: res.ok ? (body.status ?? 'accepted') : 'error' };
      if (res.ok) break;

      // Don't retry on validation rejections
      if (res.status === 400 || res.status === 422) break;

    } catch {
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS[attempt]));
      }
    }
  }

  // Persist outcome
  const outcome = response ?? { status: 'error' as const, errorCode: 'NETWORK_ERROR' };
  await supabase
    .from('epss_submissions')
    .update({
      status:            outcome.status,
      submission_ref:    outcome.submissionRef ?? null,
      error_code:        outcome.errorCode ?? null,
      error_detail:      outcome.errorDetail ?? null,
      last_attempted_at: new Date().toISOString(),
      accepted_at:       outcome.status === 'accepted' ? new Date().toISOString() : null,
      response_snapshot: outcome,
    })
    .eq('id', sub.id);

  // Update diary entry status
  if (outcome.status === 'accepted') {
    const { data: submittedStatus } = await supabase
      .from('system_status')
      .select('id')
      .eq('domain', 'site_diary')
      .eq('status_code', 'submitted')
      .single();
    if (submittedStatus) {
      await supabase
        .from('site_diary_entries')
        .update({ status_fk: submittedStatus.id, submission_timestamp: new Date().toISOString() })
        .eq('id', diaryEntryId);
    }
  }

  return {
    success: outcome.status === 'accepted',
    submissionRef: outcome.submissionRef,
    errorCode: outcome.errorCode,
  };
}
