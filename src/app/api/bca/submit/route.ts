// POST /api/bca/submit
// Triggers ePSS submission for a completed site diary entry.
// Validates records exist, builds payload, submits with retry,
// and persists the outcome in epss_submissions.

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { submitToEpss } from '@/adapters/bca/epss-submit';

export async function POST(req: Request) {
  try {
    const { diary_entry_id } = await req.json();

    if (!diary_entry_id) {
      return NextResponse.json({ error: 'diary_entry_id is required' }, { status: 400 });
    }

    // Guard: confirm entry exists and belongs to a known project
    const { data: entry } = await supabase
      .from('site_diary_entries')
      .select('id, report_date, site_project_id')
      .eq('id', diary_entry_id)
      .single();

    if (!entry) {
      return NextResponse.json({ error: 'Diary entry not found' }, { status: 404 });
    }

    // Guard: block re-submission if already accepted
    const { data: accepted } = await supabase
      .from('epss_submissions')
      .select('id, submission_ref')
      .eq('diary_entry_id', diary_entry_id)
      .eq('status', 'accepted')
      .maybeSingle();

    if (accepted) {
      return NextResponse.json({
        error: 'Already submitted',
        submission_ref: accepted.submission_ref,
      }, { status: 409 });
    }

    // Guard: block submission if any records still require requery
    const { count: requeryCount } = await supabase
      .from('epss_productivity_records')
      .select('id', { count: 'exact', head: true })
      .eq('diary_entry_id', diary_entry_id)
      .eq('requires_requery', true);

    if (requeryCount && requeryCount > 0) {
      return NextResponse.json({
        error: 'Cannot submit — diary has unresolved requery fields',
        pending_requery_count: requeryCount,
      }, { status: 422 });
    }

    // Submit
    const result = await submitToEpss(diary_entry_id);

    if (result.success) {
      return NextResponse.json({
        success: true,
        submission_ref: result.submissionRef,
      });
    }

    // Validation errors (payload build failed)
    if (result.errors?.length) {
      return NextResponse.json({
        success: false,
        errors: result.errors,
      }, { status: 422 });
    }

    // API-level error
    return NextResponse.json({
      success: false,
      error_code: result.errorCode,
    }, { status: 502 });

  } catch (error) {
    console.error('[bca/submit]', error);
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 });
  }
}
