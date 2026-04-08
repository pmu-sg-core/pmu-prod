// BCA Site Diary — Word document generator using docx.
// Produces an editable .docx for Tier 1 contractors to amend before signing off.

import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, WidthType, BorderStyle,
  ShadingType, convertInchesToTwip, Header, Footer, PageNumber,
} from 'docx';
import type { BcaDiaryJSON } from './extract-diary';

// ── Colour palette (matches PDF brand) ───────────────────────────────────────
const EMERALD  = '00d4a1';
const DARK     = '0d0d0d';
const ZINC800  = '27272a';
const ZINC100  = 'f4f4f5';
const WHITE    = 'ffffff';

// ── Helpers ───────────────────────────────────────────────────────────────────

function bold(text: string, size = 20): TextRun {
  return new TextRun({ text, bold: true, size, font: 'Calibri' });
}

function normal(text: string, size = 18): TextRun {
  return new TextRun({ text, size, font: 'Calibri' });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 18, color: WHITE, font: 'Calibri' })],
    shading: { type: ShadingType.SOLID, color: ZINC800, fill: ZINC800 },
    spacing: { before: 240, after: 80 },
    indent: { left: convertInchesToTwip(0.1), right: convertInchesToTwip(0.1) },
  });
}

function metaRow(label: string, value: string | null): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 18, color: '52525b', font: 'Calibri' }),
      new TextRun({ text: value ?? '—', size: 18, font: 'Calibri' }),
    ],
    spacing: { after: 60 },
  });
}

function tableHeaderCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 16, color: WHITE, font: 'Calibri' })],
      alignment: AlignmentType.LEFT,
    })],
    shading: { type: ShadingType.SOLID, color: ZINC800, fill: ZINC800 },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

function tableCell(text: string, shaded = false): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: text || '—', size: 16, font: 'Calibri' })],
    })],
    shading: shaded ? { type: ShadingType.SOLID, color: ZINC100, fill: ZINC100 } : undefined,
    margins: { top: 40, bottom: 40, left: 100, right: 100 },
  });
}

// ── Document builder ──────────────────────────────────────────────────────────

export async function buildDiaryDocx(diary: BcaDiaryJSON, projectName?: string): Promise<Buffer> {
  const { metadata, manpower_epss_compliance, site_activities_reg_22, logistics_materials, agentic_audit_trail } = diary;

  const sections: Paragraph[] = [];

  // ── Header block ─────────────────────────────────────────────────────────────
  sections.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'pmu', bold: true, size: 48, color: DARK, font: 'Calibri' }),
        new TextRun({ text: '.sg', bold: true, size: 48, color: EMERALD, font: 'Calibri' }),
        new TextRun({ text: '   BCA Site Diary — Regulation 22 Compliant', size: 24, color: '52525b', font: 'Calibri' }),
      ],
      spacing: { after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: EMERALD } },
    }),
    new Paragraph({
      children: [normal(`Report Date: ${metadata.report_date}   |   Project: ${projectName ?? metadata.project_id}   |   Generated: ${new Date().toLocaleString('en-SG')}`, 16)],
      spacing: { after: 240 },
    }),
  );

  // ── Project information ───────────────────────────────────────────────────────
  sections.push(
    sectionHeading('Project Information'),
    metaRow('Project ID', projectName ?? metadata.project_id),
    metaRow('Report Date', metadata.report_date),
    metaRow('Submission', metadata.submission_timestamp ? new Date(metadata.submission_timestamp).toLocaleString('en-SG') : '—'),
    metaRow('Weather (AM)', metadata.weather.am),
    metaRow('Weather (PM)', metadata.weather.pm),
    metaRow('Weather Impact', metadata.weather.impact_on_work),
  );

  // ── Manpower ─────────────────────────────────────────────────────────────────
  sections.push(sectionHeading('Manpower — EPSS Compliance'));

  if (manpower_epss_compliance.length > 0) {
    const headerRow = new TableRow({
      children: [
        tableHeaderCell('Worker ID'),
        tableHeaderCell('Trade Code'),
        tableHeaderCell('Trade'),
        tableHeaderCell('Time In'),
        tableHeaderCell('Time Out'),
        tableHeaderCell('Hours'),
      ],
      tableHeader: true,
    });

    const dataRows = manpower_epss_compliance.map((m, i) =>
      new TableRow({
        children: [
          tableCell(m.worker_id_masked, i % 2 === 1),
          tableCell(m.trade_code, i % 2 === 1),
          tableCell(m.trade_description, i % 2 === 1),
          tableCell(m.attendance.time_in ?? '—', i % 2 === 1),
          tableCell(m.attendance.time_out ?? '—', i % 2 === 1),
          tableCell(m.attendance.total_man_hours?.toString() ?? '—', i % 2 === 1),
        ],
      })
    );

    sections.push(
      new Table({
        rows: [headerRow, ...dataRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }) as unknown as Paragraph,
      new Paragraph({ text: '', spacing: { after: 160 } }),
    );
  } else {
    sections.push(new Paragraph({ children: [normal('No manpower records.', 16)], spacing: { after: 160 } }));
  }

  // ── EPSS trade summary (confirmed local/foreign split from requery) ────────────
  if (manpower_epss_compliance.length > 0 && diary.epss_trade_summary && diary.epss_trade_summary.length > 0) {
    sections.push(
      new Paragraph({ children: [bold('Local / Foreign Worker Split (Confirmed)', 16)], spacing: { before: 120, after: 60 } }),
      new Table({
        rows: [
          new TableRow({
            children: [
              tableHeaderCell('Trade'),
              tableHeaderCell('Total'),
              tableHeaderCell('Local'),
              tableHeaderCell('Foreign'),
            ],
            tableHeader: true,
          }),
          ...diary.epss_trade_summary.map((t, i) =>
            new TableRow({
              children: [
                tableCell(`${t.trade_description} (${t.trade_code})`, i % 2 === 1),
                tableCell(String(t.worker_count), i % 2 === 1),
                tableCell(String(t.local_worker_count), i % 2 === 1),
                tableCell(String(t.foreign_worker_count), i % 2 === 1),
              ],
            })
          ),
        ],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }) as unknown as Paragraph,
      new Paragraph({ text: '', spacing: { after: 160 } }),
    );
  }

  // ── Site activities ───────────────────────────────────────────────────────────
  sections.push(sectionHeading('Site Activities — Regulation 22'));

  site_activities_reg_22.structural_works.forEach(a => {
    sections.push(
      new Paragraph({
        children: [bold(`${a.location}`, 18)],
        spacing: { before: 100, after: 40 },
      }),
      new Paragraph({ children: [bold(a.task, 18)] }),
      new Paragraph({
        children: [
          new TextRun({ text: `Status: ${a.status}`, size: 16, color: '52525b', font: 'Calibri' }),
          a.verified_by_re_rto
            ? new TextRun({ text: `   Verified by: ${a.verified_by_re_rto}`, size: 16, font: 'Calibri' })
            : new TextRun({ text: '' }),
        ],
        spacing: { after: 100 },
      }),
    );
  });

  if (site_activities_reg_22.concreting_records) {
    const c = site_activities_reg_22.concreting_records;
    sections.push(
      sectionHeading('Concreting Records'),
      metaRow('Check ID', c.check_id),
      metaRow('Pre-Pour Inspection', c.pre_pour_inspection),
      metaRow('Slump Test Result', c.slump_test_result),
      metaRow('Cube Test ID', c.cube_test_id),
    );
  }

  if (site_activities_reg_22.instructions_received.length > 0) {
    sections.push(sectionHeading('Instructions Received'));
    site_activities_reg_22.instructions_received.forEach(ins => {
      sections.push(new Paragraph({
        children: [new TextRun({ text: `› ${ins}`, size: 18, font: 'Calibri' })],
        spacing: { after: 80 },
      }));
    });
  }

  // ── Materials ─────────────────────────────────────────────────────────────────
  sections.push(sectionHeading('Logistics & Materials'));

  if (logistics_materials.length > 0) {
    const headerRow = new TableRow({
      children: [
        tableHeaderCell('Item'),
        tableHeaderCell('Qty'),
        tableHeaderCell('Unit'),
        tableHeaderCell('DO Number'),
        tableHeaderCell('Status'),
      ],
      tableHeader: true,
    });

    const dataRows = logistics_materials.map((m, i) =>
      new TableRow({
        children: [
          tableCell(m.item, i % 2 === 1),
          tableCell(m.quantity?.toString() ?? '—', i % 2 === 1),
          tableCell(m.unit ?? '—', i % 2 === 1),
          tableCell(m.do_number ?? '—', i % 2 === 1),
          tableCell(m.status, i % 2 === 1),
        ],
      })
    );

    sections.push(
      new Table({
        rows: [headerRow, ...dataRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }) as unknown as Paragraph,
      new Paragraph({ text: '', spacing: { after: 160 } }),
    );
  } else {
    sections.push(new Paragraph({ children: [normal('No materials recorded.', 16)], spacing: { after: 160 } }));
  }

  // ── Audit trail ───────────────────────────────────────────────────────────────
  sections.push(
    sectionHeading('Agentic Audit Trail — IMDA Governance Framework'),
    metaRow('Input Type', agentic_audit_trail.raw_input_type),
    metaRow('AI Confidence', `${Math.round(agentic_audit_trail.confidence_score * 100)}%`),
    metaRow('AI Flags', agentic_audit_trail.ai_logic_flags.join(', ')),
    new Paragraph({
      children: [
        new TextRun({ text: 'Raw Transcript: ', bold: true, size: 16, color: '52525b', font: 'Calibri' }),
        new TextRun({ text: agentic_audit_trail.raw_transcript.slice(0, 300), size: 16, color: '52525b', font: 'Calibri' }),
      ],
      spacing: { after: 160 },
    }),
  );

  // ── Validation / Sign-off block ───────────────────────────────────────────────
  sections.push(
    sectionHeading('Human Validation & Sign-Off'),
    new Paragraph({
      children: [
        new TextRun({ text: 'Status: ', bold: true, size: 18, font: 'Calibri' }),
        new TextRun({ text: 'Pending Human Validation — Not Yet Submitted to BCA', size: 18, color: 'b45309', font: 'Calibri' }),
      ],
      spacing: { after: 160 },
    }),
    new Paragraph({ children: [normal('Validated by: ___________________________________   NRIC: _______________', 18)], spacing: { after: 80 } }),
    new Paragraph({ children: [normal('Date & Time: ___________________________________   Signature: _______________', 18)], spacing: { after: 80 } }),
  );

  const doc = new Document({
    numbering: { config: [] },
    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(0.75),
            bottom: convertInchesToTwip(0.75),
            left:   convertInchesToTwip(0.75),
            right:  convertInchesToTwip(0.75),
          },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              new TextRun({ text: 'pmu.sg · BCA Site Diary · ', size: 14, color: '52525b', font: 'Calibri' }),
              new TextRun({ text: metadata.project_id, size: 14, color: '52525b', font: 'Calibri' }),
            ],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: EMERALD } },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: `Generated ${new Date().toLocaleDateString('en-SG')} · Confidential · Page `, size: 14, color: '52525b', font: 'Calibri' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 14, color: '52525b', font: 'Calibri' }),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      children: sections,
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
