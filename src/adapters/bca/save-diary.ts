// Shared persistence layer for BCA site diary.
// Called by both the /api/bca/extract route and the agent loop (executeIntent).
// Writes the diary header + all child tables atomically (delete-then-insert).

import { supabase } from '@/lib/supabase';
import type { BcaDiaryJSON } from './extract-diary';

export interface SaveDiaryParams {
  siteProjectId: string;
  reportDate: string;         // YYYY-MM-DD
  diary: BcaDiaryJSON;
  confidence: number;
  transcript: string;
  intakeLogId?: string | null;
}

export interface RequeryRecord {
  id: string;
  trade_code: string;
  trade_description: string;
  worker_count: number;
  requery_template: string;
}

export interface SaveDiaryResult {
  diaryEntryId: string;
  requeryRecords: RequeryRecord[];
}

export async function saveDiary(params: SaveDiaryParams): Promise<SaveDiaryResult> {
  const { siteProjectId, reportDate, diary, confidence, transcript, intakeLogId } = params;

  // ── Diary entry (header) ──────────────────────────────────────────────────────

  const { data: draftStatus } = await supabase
    .from('system_status')
    .select('id')
    .eq('domain', 'site_diary')
    .eq('status_code', 'draft')
    .single();

  const { data: entry, error: entryError } = await supabase
    .from('site_diary_entries')
    .upsert({
      site_project_id:  siteProjectId,
      intake_log_id:    intakeLogId ?? null,
      report_date:      reportDate,
      weather_am:       diary.metadata.weather.am,
      weather_pm:       diary.metadata.weather.pm,
      weather_impact:   diary.metadata.weather.impact_on_work,
      raw_transcript:   transcript,
      structured_json:  diary,
      confidence_score: confidence,
      status_fk:        draftStatus?.id ?? null,
    }, { onConflict: 'site_project_id,report_date' })
    .select('id')
    .single();

  if (entryError || !entry) {
    throw new Error(`Failed to upsert site_diary_entries: ${entryError?.message}`);
  }

  const diaryEntryId: string = entry.id;

  // ── Manpower (per-worker rows) ────────────────────────────────────────────────

  await supabase.from('site_diary_manpower').delete().eq('diary_entry_id', diaryEntryId);
  if (diary.manpower_epss_compliance.length > 0) {
    await supabase.from('site_diary_manpower').insert(
      diary.manpower_epss_compliance.map(m => ({
        diary_entry_id:    diaryEntryId,
        worker_id_masked:  m.worker_id_masked,
        employer_uen:      m.employer_uen,
        trade_code:        m.trade_code,
        trade_description: m.trade_description,
        time_in:           m.attendance.time_in,
        time_out:          m.attendance.time_out,
        total_man_hours:   m.attendance.total_man_hours,
      }))
    );
  }

  // ── Activities (structural works + concreting + instructions) ─────────────────

  await supabase.from('site_diary_activities').delete().eq('diary_entry_id', diaryEntryId);
  const activities = [
    ...diary.site_activities_reg_22.structural_works.map(a => ({
      diary_entry_id:   diaryEntryId,
      activity_type:    'structural_works',
      location:         a.location,
      task_description: a.task,
      activity_status:  a.status,
      verified_by:      a.verified_by_re_rto,
    })),
    ...(diary.site_activities_reg_22.concreting_records ? [{
      diary_entry_id:      diaryEntryId,
      activity_type:       'concreting',
      check_id:            diary.site_activities_reg_22.concreting_records.check_id,
      pre_pour_inspection: diary.site_activities_reg_22.concreting_records.pre_pour_inspection,
      slump_test_result:   diary.site_activities_reg_22.concreting_records.slump_test_result,
      cube_test_id:        diary.site_activities_reg_22.concreting_records.cube_test_id,
      activity_status:     'Completed',
    }] : []),
    ...diary.site_activities_reg_22.instructions_received.map(ins => ({
      diary_entry_id:   diaryEntryId,
      activity_type:    'instruction',
      task_description: ins,
      activity_status:  'Completed',
    })),
  ];
  if (activities.length > 0) {
    await supabase.from('site_diary_activities').insert(activities);
  }

  // ── Materials ─────────────────────────────────────────────────────────────────

  await supabase.from('site_diary_materials').delete().eq('diary_entry_id', diaryEntryId);
  if (diary.logistics_materials.length > 0) {
    await supabase.from('site_diary_materials').insert(
      diary.logistics_materials.map(m => ({
        diary_entry_id:  diaryEntryId,
        item_name:       m.item,
        quantity:        m.quantity,
        unit:            m.unit,
        supplier_uen:    m.supplier_uen,
        do_number:       m.do_number,
        delivery_status: m.status,
      }))
    );
  }

  // ── ePSS productivity records (trade-level aggregation) ───────────────────────

  let requeryRecords: RequeryRecord[] = [];
  await supabase.from('epss_productivity_records').delete().eq('diary_entry_id', diaryEntryId);
  if (diary.manpower_epss_compliance.length > 0) {
    const { data: supervisor } = await supabase
      .from('site_team_members')
      .select('nric_masked')
      .eq('site_project_id', siteProjectId)
      .eq('is_supervisor', true)
      .eq('is_active', true)
      .maybeSingle();

    // Aggregate per-worker rows → one row per trade code
    const tradeMap = new Map<string, {
      trade_description: string;
      worker_count: number;
      total_man_hours: number;
      work_location: string | null;
    }>();

    for (const m of diary.manpower_epss_compliance) {
      const existing = tradeMap.get(m.trade_code);
      if (existing) {
        existing.worker_count += 1;
        existing.total_man_hours += m.attendance.total_man_hours ?? 8;
      } else {
        tradeMap.set(m.trade_code, {
          trade_description: m.trade_description,
          worker_count: 1,
          total_man_hours: m.attendance.total_man_hours ?? 8,
          // Best-effort location hint from first structural work activity
          work_location: diary.site_activities_reg_22.structural_works[0]?.location ?? null,
        });
      }
    }

    const epssRecords = Array.from(tradeMap.entries()).map(([trade_code, g]) => ({
      diary_entry_id:         diaryEntryId,
      trade_code,
      trade_description:      g.trade_description,
      worker_count:           g.worker_count,
      local_worker_count:     0,              // unknown at extraction — requery required
      foreign_worker_count:   g.worker_count, // Singapore default: assume WP holders
      worker_man_days:        parseFloat((g.total_man_hours / 8).toFixed(2)),
      supervisor_nric_masked: supervisor?.nric_masked ?? null,
      work_location:          g.work_location,
      confidence_score:       confidence,
      requires_requery:       true,
      requery_field:          'local_worker_count',
      requery_template:       `How many of the ${g.worker_count} ${g.trade_description} workers today are local (Singapore citizens/PRs)?`,
    }));

    const { data: inserted, error: epssError } = await supabase
      .from('epss_productivity_records')
      .insert(epssRecords)
      .select('id, trade_code, trade_description, worker_count, requery_template');
    if (epssError) throw new Error(`Failed to insert epss_productivity_records: ${epssError.message}`);

    requeryRecords = (inserted ?? []).map(r => ({
      id:                r.id as string,
      trade_code:        r.trade_code as string,
      trade_description: r.trade_description as string,
      worker_count:      r.worker_count as number,
      requery_template:  r.requery_template as string,
    }));
  }

  return { diaryEntryId, requeryRecords };
}
