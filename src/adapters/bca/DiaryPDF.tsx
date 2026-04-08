// BCA Site Diary — branded PDF template using @react-pdf/renderer.
// Renders the full BCA Reg 22 diary JSON as a clean, print-ready PDF.

import {
  Document, Page, Text, View, StyleSheet, Font,
} from '@react-pdf/renderer';
import type { BcaDiaryJSON } from './extract-diary';

// ── Styles ────────────────────────────────────────────────────────────────────

const C = {
  emerald:  '#00d4a1',
  dark:     '#0d0d0d',
  zinc800:  '#27272a',
  zinc600:  '#52525b',
  zinc400:  '#a1a1aa',
  white:    '#ffffff',
  red:      '#ef4444',
  yellow:   '#eab308',
};

const s = StyleSheet.create({
  page:          { fontFamily: 'Helvetica', fontSize: 9, backgroundColor: '#ffffff', padding: 36, color: '#18181b' },
  // Header
  headerRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, borderBottomWidth: 2, borderBottomColor: C.emerald, paddingBottom: 12 },
  brandMark:     { fontSize: 22, fontFamily: 'Helvetica-Bold', color: C.dark },
  brandAccent:   { color: C.emerald },
  headerMeta:    { alignItems: 'flex-end' },
  headerTitle:   { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.dark, marginBottom: 2 },
  headerSub:     { fontSize: 8, color: C.zinc600 },
  // Sections
  section:       { marginBottom: 14 },
  sectionHeader: { backgroundColor: C.dark, color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 8, padding: '4 8', marginBottom: 6, letterSpacing: 0.8 },
  // Grid
  row2:          { flexDirection: 'row', gap: 8, marginBottom: 6 },
  metaBox:       { flex: 1, backgroundColor: '#f4f4f5', borderRadius: 4, padding: '5 8' },
  metaLabel:     { fontSize: 7, color: C.zinc600, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue:     { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.dark },
  // Tables
  tableHeader:   { flexDirection: 'row', backgroundColor: C.zinc800, padding: '3 6', marginBottom: 1 },
  tableHeaderTxt:{ fontFamily: 'Helvetica-Bold', fontSize: 7, color: C.white, flex: 1 },
  tableRow:      { flexDirection: 'row', padding: '3 6', borderBottomWidth: 0.5, borderBottomColor: '#e4e4e7' },
  tableCell:     { fontSize: 8, color: C.dark, flex: 1 },
  tableCellBold: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.dark, flex: 1 },
  // Activity cards
  activityCard:  { borderLeftWidth: 2, borderLeftColor: C.emerald, paddingLeft: 8, marginBottom: 6, padding: '4 4 4 8', backgroundColor: '#f9fafb' },
  activityLoc:   { fontSize: 7, color: C.zinc600, marginBottom: 2 },
  activityTask:  { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.dark, marginBottom: 2 },
  activityMeta:  { flexDirection: 'row', gap: 12 },
  badge:         { fontSize: 7, padding: '1 5', borderRadius: 3 },
  badgeGreen:    { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeYellow:   { backgroundColor: '#fef9c3', color: '#ca8a04' },
  badgeGray:     { backgroundColor: '#f4f4f5', color: C.zinc600 },
  // Concreting
  concBox:       { borderWidth: 0.5, borderColor: C.emerald, borderRadius: 4, padding: 8, marginBottom: 6 },
  concGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  concItem:      { width: '48%', marginBottom: 4 },
  // Instructions
  instruction:   { flexDirection: 'row', gap: 6, marginBottom: 4 },
  bullet:        { width: 10, color: C.emerald, fontFamily: 'Helvetica-Bold' },
  instructTxt:   { flex: 1, fontSize: 8, color: C.dark },
  // Audit footer
  auditBox:      { borderTopWidth: 1.5, borderTopColor: C.dark, paddingTop: 10, marginTop: 12 },
  auditRow:      { flexDirection: 'row', gap: 8, marginBottom: 6 },
  auditItem:     { flex: 1 },
  auditLabel:    { fontSize: 7, color: C.zinc600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  auditValue:    { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.dark },
  flagRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  flag:          { fontSize: 7, backgroundColor: '#e0fdf4', color: '#065f46', padding: '2 5', borderRadius: 3 },
  // Validation
  validationBox: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#86efac', borderRadius: 4, padding: 8, marginTop: 8 },
  pendingBox:    { backgroundColor: '#fefce8', borderWidth: 1, borderColor: '#fde047', borderRadius: 4, padding: 8, marginTop: 8 },
  // Footer
  pageFooter:    { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: '#e4e4e7', paddingTop: 6 },
  footerTxt:     { fontSize: 7, color: C.zinc400 },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const style = status === 'Completed' || status === 'Delivered' ? s.badgeGreen
              : status === 'In Progress' ? s.badgeYellow
              : s.badgeGray;
  return <Text style={[s.badge, style]}>{status}</Text>;
}

function fmt(v: string | number | null | undefined, fallback = '—') {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetaBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metaBox}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue}>{value}</Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={s.sectionHeader}>{title.toUpperCase()}</Text>;
}

// ── Main PDF document ─────────────────────────────────────────────────────────

export function DiaryPDF({ diary }: { diary: BcaDiaryJSON }) {
  const { metadata, manpower_epss_compliance, site_activities_reg_22, logistics_materials, agentic_audit_trail } = diary;
  const { structural_works, concreting_records, instructions_received } = site_activities_reg_22;
  const validated = !!agentic_audit_trail.human_in_the_loop_validation.validated_by;

  return (
    <Document title={`Site Diary — ${metadata.project_id} — ${metadata.report_date}`} author="pmu.sg">
      <Page size="A4" style={s.page}>

        {/* ── Header ── */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.brandMark}>pmu<Text style={s.brandAccent}>.sg</Text></Text>
            <Text style={{ fontSize: 8, color: C.zinc600, marginTop: 2 }}>Augmenting Human Potential</Text>
          </View>
          <View style={s.headerMeta}>
            <Text style={s.headerTitle}>BCA Site Diary</Text>
            <Text style={s.headerSub}>Regulation 22 Compliant</Text>
            <Text style={s.headerSub}>{metadata.report_date}</Text>
          </View>
        </View>

        {/* ── Project Metadata ── */}
        <View style={s.section}>
          <SectionHeader title="Project Information" />
          <View style={s.row2}>
            <MetaBox label="Project ID" value={fmt(metadata.project_id)} />
            <MetaBox label="Report Date" value={fmt(metadata.report_date)} />
            <MetaBox label="Submission" value={metadata.submission_timestamp ? new Date(metadata.submission_timestamp).toLocaleString('en-SG') : '—'} />
          </View>
          <View style={s.row2}>
            <MetaBox label="Weather (AM)" value={fmt(metadata.weather.am)} />
            <MetaBox label="Weather (PM)" value={fmt(metadata.weather.pm)} />
            <MetaBox label="Weather Impact" value={fmt(metadata.weather.impact_on_work)} />
          </View>
          {(metadata.geolocation.lat || metadata.geolocation.long) && (
            <View style={s.row2}>
              <MetaBox label="Latitude" value={fmt(metadata.geolocation.lat)} />
              <MetaBox label="Longitude" value={fmt(metadata.geolocation.long)} />
              <MetaBox label="Geolocation Verified" value={metadata.geolocation.verified ? 'Yes ✓' : 'No'} />
            </View>
          )}
        </View>

        {/* ── Manpower / EPSS ── */}
        {manpower_epss_compliance.length > 0 && (
          <View style={s.section}>
            <SectionHeader title="Manpower — EPSS Compliance" />
            <View style={s.tableHeader}>
              <Text style={[s.tableHeaderTxt, { flex: 1.2 }]}>Worker ID</Text>
              <Text style={[s.tableHeaderTxt, { flex: 0.8 }]}>Trade Code</Text>
              <Text style={s.tableHeaderTxt}>Trade</Text>
              <Text style={[s.tableHeaderTxt, { flex: 0.6 }]}>Time In</Text>
              <Text style={[s.tableHeaderTxt, { flex: 0.6 }]}>Time Out</Text>
              <Text style={[s.tableHeaderTxt, { flex: 0.6 }]}>Hours</Text>
            </View>
            {manpower_epss_compliance.map((w, i) => (
              <View key={i} style={[s.tableRow, i % 2 === 0 ? {} : { backgroundColor: '#fafafa' }]}>
                <Text style={[s.tableCellBold, { flex: 1.2 }]}>{w.worker_id_masked}</Text>
                <Text style={[s.tableCell, { flex: 0.8, color: C.emerald, fontFamily: 'Helvetica-Bold' }]}>{w.trade_code}</Text>
                <Text style={s.tableCell}>{w.trade_description}</Text>
                <Text style={[s.tableCell, { flex: 0.6 }]}>{fmt(w.attendance.time_in)}</Text>
                <Text style={[s.tableCell, { flex: 0.6 }]}>{fmt(w.attendance.time_out)}</Text>
                <Text style={[s.tableCell, { flex: 0.6 }]}>{fmt(w.attendance.total_man_hours)}</Text>
              </View>
            ))}
            {diary.epss_trade_summary && diary.epss_trade_summary.length > 0 && (
              <>
                <View style={[s.tableHeader, { marginTop: 6 }]}>
                  <Text style={s.tableHeaderTxt}>Trade</Text>
                  <Text style={[s.tableHeaderTxt, { flex: 0.6 }]}>Total</Text>
                  <Text style={[s.tableHeaderTxt, { flex: 0.6 }]}>Local</Text>
                  <Text style={[s.tableHeaderTxt, { flex: 0.6 }]}>Foreign</Text>
                </View>
                {diary.epss_trade_summary.map((t, i) => (
                  <View key={i} style={[s.tableRow, i % 2 === 0 ? {} : { backgroundColor: '#fafafa' }]}>
                    <Text style={s.tableCellBold}>{t.trade_description} ({t.trade_code})</Text>
                    <Text style={[s.tableCell, { flex: 0.6 }]}>{t.worker_count}</Text>
                    <Text style={[s.tableCell, { flex: 0.6 }]}>{t.local_worker_count}</Text>
                    <Text style={[s.tableCell, { flex: 0.6 }]}>{t.foreign_worker_count}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        )}

        {/* ── Structural Works ── */}
        {structural_works.length > 0 && (
          <View style={s.section}>
            <SectionHeader title="Site Activities — Regulation 22" />
            {structural_works.map((a, i) => (
              <View key={i} style={s.activityCard}>
                <Text style={s.activityLoc}>{a.location}</Text>
                <Text style={s.activityTask}>{a.task}</Text>
                <View style={s.activityMeta}>
                  {statusBadge(a.status)}
                  {a.verified_by_re_rto && (
                    <Text style={{ fontSize: 7, color: C.zinc600 }}>Verified: {a.verified_by_re_rto}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Concreting Records ── */}
        {concreting_records && (
          <View style={s.section}>
            <SectionHeader title="Concreting Records" />
            <View style={s.concBox}>
              <View style={s.concGrid}>
                <View style={s.concItem}>
                  <Text style={s.metaLabel}>Check ID</Text>
                  <Text style={s.metaValue}>{fmt(concreting_records.check_id)}</Text>
                </View>
                <View style={s.concItem}>
                  <Text style={s.metaLabel}>Pre-Pour Inspection</Text>
                  <Text style={[s.metaValue, { color: concreting_records.pre_pour_inspection === 'Pass' ? '#16a34a' : C.red }]}>
                    {fmt(concreting_records.pre_pour_inspection)}
                  </Text>
                </View>
                <View style={s.concItem}>
                  <Text style={s.metaLabel}>Slump Test Result</Text>
                  <Text style={s.metaValue}>{fmt(concreting_records.slump_test_result)}</Text>
                </View>
                <View style={s.concItem}>
                  <Text style={s.metaLabel}>Cube Test ID</Text>
                  <Text style={s.metaValue}>{fmt(concreting_records.cube_test_id)}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── Instructions ── */}
        {instructions_received.length > 0 && (
          <View style={s.section}>
            <SectionHeader title="Instructions Received" />
            {instructions_received.map((ins, i) => (
              <View key={i} style={s.instruction}>
                <Text style={s.bullet}>›</Text>
                <Text style={s.instructTxt}>{ins}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Logistics / Materials ── */}
        {logistics_materials.length > 0 && (
          <View style={s.section}>
            <SectionHeader title="Logistics & Materials" />
            <View style={s.tableHeader}>
              <Text style={s.tableHeaderTxt}>Item</Text>
              <Text style={[s.tableHeaderTxt, { flex: 0.5 }]}>Qty</Text>
              <Text style={[s.tableHeaderTxt, { flex: 0.4 }]}>Unit</Text>
              <Text style={[s.tableHeaderTxt, { flex: 0.8 }]}>DO Number</Text>
              <Text style={[s.tableHeaderTxt, { flex: 0.7 }]}>Status</Text>
            </View>
            {logistics_materials.map((m, i) => (
              <View key={i} style={[s.tableRow, i % 2 === 0 ? {} : { backgroundColor: '#fafafa' }]}>
                <Text style={s.tableCellBold}>{m.item}</Text>
                <Text style={[s.tableCell, { flex: 0.5 }]}>{fmt(m.quantity)}</Text>
                <Text style={[s.tableCell, { flex: 0.4 }]}>{fmt(m.unit)}</Text>
                <Text style={[s.tableCell, { flex: 0.8, fontFamily: 'Helvetica-Bold' }]}>{fmt(m.do_number)}</Text>
                <View style={[{ flex: 0.7 }]}>{statusBadge(m.status)}</View>
              </View>
            ))}
          </View>
        )}

        {/* ── Agentic Audit Trail ── */}
        <View style={s.auditBox}>
          <SectionHeader title="Agentic Audit Trail — IMDA Governance Framework" />
          <View style={s.auditRow}>
            <View style={s.auditItem}>
              <Text style={s.auditLabel}>Input Type</Text>
              <Text style={s.auditValue}>{agentic_audit_trail.raw_input_type}</Text>
            </View>
            <View style={s.auditItem}>
              <Text style={s.auditLabel}>AI Confidence</Text>
              <Text style={[s.auditValue, { color: agentic_audit_trail.confidence_score >= 0.85 ? '#16a34a' : '#ca8a04' }]}>
                {(agentic_audit_trail.confidence_score * 100).toFixed(0)}%
              </Text>
            </View>
            <View style={[s.auditItem, { flex: 2 }]}>
              <Text style={s.auditLabel}>Raw Transcript</Text>
              <Text style={{ fontSize: 7, color: C.zinc600, fontStyle: 'italic' }}>
                &quot;{agentic_audit_trail.raw_transcript.slice(0, 200)}{agentic_audit_trail.raw_transcript.length > 200 ? '…' : ''}&quot;
              </Text>
            </View>
          </View>

          <View style={s.flagRow}>
            {agentic_audit_trail.ai_logic_flags.map((f, i) => (
              <Text key={i} style={s.flag}>{f}</Text>
            ))}
          </View>

          {validated ? (
            <View style={s.validationBox}>
              <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#16a34a' }}>
                ✓ Human-in-the-Loop Validated
              </Text>
              <Text style={{ fontSize: 7, color: '#166534', marginTop: 2 }}>
                Validated by: {agentic_audit_trail.human_in_the_loop_validation.validated_by}
                {'  ·  '}
                {agentic_audit_trail.human_in_the_loop_validation.validation_time
                  ? new Date(agentic_audit_trail.human_in_the_loop_validation.validation_time).toLocaleString('en-SG')
                  : ''}
              </Text>
            </View>
          ) : (
            <View style={s.pendingBox}>
              <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#854d0e' }}>
                ⚠ Pending Human Validation — Not Yet Submitted to BCA
              </Text>
            </View>
          )}
        </View>

        {/* ── Page Footer ── */}
        <View style={s.pageFooter} fixed>
          <Text style={s.footerTxt}>pmu.sg · BCA Site Diary · {metadata.project_id}</Text>
          <Text style={s.footerTxt}>Generated {new Date().toLocaleDateString('en-SG')} · Confidential</Text>
          <Text style={s.footerTxt} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

      </Page>
    </Document>
  );
}
