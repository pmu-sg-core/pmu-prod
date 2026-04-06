// POST /api/bca/extract
// Accepts a transcript + project context.
// Runs LLM extraction → persists all tables via saveDiary() → returns BCA JSON.

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { extractDiaryFromTranscript } from '@/adapters/bca/extract-diary';
import { saveDiary } from '@/adapters/bca/save-diary';

export async function POST(req: Request) {
  try {
    const {
      transcript,
      site_project_id,
      report_date,
      intake_log_id,
      lat,
      long,
      geolocation_verified = false,
      platform = 'WhatsApp Voice Note',
    } = await req.json();

    if (!transcript || !site_project_id || !report_date) {
      return NextResponse.json(
        { error: 'transcript, site_project_id, and report_date are required' },
        { status: 400 }
      );
    }

    const { data: project } = await supabase
      .from('site_projects')
      .select('project_ref')
      .eq('id', site_project_id)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Site project not found' }, { status: 404 });
    }

    const { diary, confidence, flags } = await extractDiaryFromTranscript({
      transcript,
      projectId: project.project_ref,
      reportDate: report_date,
      lat: lat ?? null,
      long: long ?? null,
      geolocationVerified: geolocation_verified,
      platform,
    });

    const { diaryEntryId } = await saveDiary({
      siteProjectId: site_project_id,
      reportDate: report_date,
      diary,
      confidence,
      transcript,
      intakeLogId: intake_log_id ?? null,
    });

    return NextResponse.json({ diary_entry_id: diaryEntryId, diary, confidence, flags });
  } catch (error) {
    console.error('[bca/extract]', error);
    return NextResponse.json({ error: 'Extraction failed' }, { status: 500 });
  }
}
