// GET /api/bca/docx?diary_id=xxx
// Returns an editable Word document for Tier 1 contractor amendments.

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { buildDiaryDocx } from '@/adapters/bca/DiaryDocx';
import type { BcaDiaryJSON } from '@/adapters/bca/extract-diary';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const diaryId = searchParams.get('diary_id');

  if (!diaryId) {
    return NextResponse.json({ error: 'Missing diary_id' }, { status: 400 });
  }

  const { data: entry } = await supabase
    .from('site_diary_entries')
    .select(`
      structured_json,
      report_date,
      site_projects ( project_ref, project_name )
    `)
    .eq('id', diaryId)
    .single();

  if (!entry?.structured_json) {
    return NextResponse.json({ error: 'Diary entry not found' }, { status: 404 });
  }

  const diary = entry.structured_json as BcaDiaryJSON;
  const project = entry.site_projects as any;
  const projectName = project?.project_name ?? project?.project_ref ?? undefined;
  const filename = `pmu-sg-site-diary-${project?.project_ref ?? diaryId.slice(0, 8)}-${entry.report_date}.docx`;

  const buffer = await buildDiaryDocx(diary, projectName);

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
