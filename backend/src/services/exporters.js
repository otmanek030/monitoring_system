/**
 * Excel + PDF exporters (ExcelJS + PDFKit).
 * Kept lean and streaming-friendly; big reports don't eat memory.
 */
'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// --- Excel ---------------------------------------------------------------

async function buildEquipmentXlsx({ equipment, sensors, dataBySensor, alarms, from, to }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Phoswatch';
  wb.created = new Date();

  // Overview sheet
  const ov = wb.addWorksheet('Overview');
  ov.columns = [{ header: 'Field', width: 24 }, { header: 'Value', width: 60 }];
  ov.addRow(['Tag code',      equipment.tag_code]);
  ov.addRow(['Name',          equipment.name]);
  ov.addRow(['Area',          equipment.area_code]);
  ov.addRow(['Status',        equipment.status]);
  ov.addRow(['Criticality',   equipment.criticality]);
  ov.addRow(['Runtime (h)',   equipment.runtime_hours]);
  ov.addRow(['Expected life', equipment.expected_life_hours]);
  ov.addRow(['Report range',  `${from.toISOString()} → ${to.toISOString()}`]);
  ov.getRow(1).font = { bold: true };

  // Per-sensor sheets (1-min buckets)
  for (const s of sensors) {
    const ws = wb.addWorksheet(s.tag_code.slice(0, 31));
    ws.columns = [
      { header: 'Timestamp', key: 'ts',  width: 24 },
      { header: 'Avg',       key: 'avg', width: 14 },
      { header: 'Min',       key: 'min', width: 14 },
      { header: 'Max',       key: 'max', width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const p of (dataBySensor[s.tag_code] || [])) {
      ws.addRow({ ts: p.bucket, avg: Number(p.avg), min: Number(p.min), max: Number(p.max) });
    }
  }

  // Alarms sheet
  const al = wb.addWorksheet('Alarms');
  al.columns = [
    { header: 'Timestamp', key: 'ts',       width: 24 },
    { header: 'Severity',  key: 'severity', width: 12 },
    { header: 'Message',   key: 'message',  width: 60 },
    { header: 'Value',     key: 'value',    width: 12 },
  ];
  al.getRow(1).font = { bold: true };
  for (const a of alarms) al.addRow({ ts: a.ts, severity: a.severity, message: a.message, value: a.trigger_value });

  return wb.xlsx.writeBuffer();
}

async function buildAlarmsXlsx({ alarms, from, to }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Alarms');
  ws.columns = [
    { header: 'Timestamp',  key: 'ts',            width: 24 },
    { header: 'Cleared',    key: 'cleared_ts',    width: 24 },
    { header: 'Severity',   key: 'severity',      width: 12 },
    { header: 'Equipment',  key: 'equipment_tag', width: 20 },
    { header: 'Sensor',     key: 'sensor_tag',    width: 24 },
    { header: 'Message',    key: 'message',       width: 60 },
    { header: 'Trigger',    key: 'trigger_value', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const a of alarms) ws.addRow(a);
  ws.addRow({});
  ws.addRow({ message: `Range: ${from.toISOString()} → ${to.toISOString()}` });
  return wb.xlsx.writeBuffer();
}

// --- PDF -----------------------------------------------------------------

function streamEquipmentPdf(stream, { equipment, alarms, rul, from, to }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  doc.pipe(stream);

  doc.fontSize(20).text('Equipment Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).fillColor('#666')
     .text(`Phoswatch | OCP Benguerir | ${new Date().toISOString()}`, { align: 'center' });
  doc.moveDown().fillColor('#000');

  doc.fontSize(14).text(`${equipment.tag_code} — ${equipment.name}`);
  doc.fontSize(10).text(`Area: ${equipment.area_code}   Status: ${equipment.status}   Criticality: ${equipment.criticality}`);
  doc.text(`Runtime: ${equipment.runtime_hours} h / expected ${equipment.expected_life_hours} h`);
  doc.text(`Range: ${from.toISOString()} → ${to.toISOString()}`);
  doc.moveDown();

  if (rul) {
    doc.fontSize(12).fillColor('#064')
      .text(`RUL prediction: ${Math.round(rul.rul_hours)} h  |  Health index: ${(rul.health_index * 100).toFixed(1)}%`);
    doc.fillColor('#000');
    doc.moveDown();
  }

  doc.fontSize(12).text(`Alarms (${alarms.length})`, { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(9);
  if (!alarms.length) doc.text('No alarms in this range.');
  for (const a of alarms.slice(0, 60)) {
    doc.fillColor(a.severity === 'fatal' ? '#a00' : a.severity === 'warning' ? '#c60' : '#444')
       .text(`• ${new Date(a.ts).toISOString()}  [${a.severity}]  ${a.message}`);
  }
  doc.fillColor('#000');
  doc.end();
}

function streamSummaryPdf(stream, { eqHealth, alarmsBySeverity, from, to }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  doc.pipe(stream);

  doc.fontSize(20).text('Plant Summary', { align: 'center' });
  doc.fontSize(10).fillColor('#666').text(
    `Phoswatch | OCP Benguerir | ${new Date().toISOString()}`, { align: 'center' });
  doc.moveDown().fillColor('#000');

  doc.fontSize(11).text(`Range: ${from.toISOString()} → ${to.toISOString()}`);
  doc.moveDown();

  doc.fontSize(14).text('Alarms by severity', { underline: true });
  doc.moveDown(0.3).fontSize(11);
  for (const r of alarmsBySeverity) doc.text(`• ${r.severity.padEnd(8)} ${r.n}`);
  doc.moveDown();

  doc.fontSize(14).text('Top 10 at-risk equipment', { underline: true });
  doc.moveDown(0.3).fontSize(10);
  for (const e of eqHealth) {
    const hi = e.health_index != null ? (e.health_index * 100).toFixed(1) + '%' : 'n/a';
    doc.text(`• ${e.tag_code.padEnd(18)} ${e.name.padEnd(32)} health=${hi}`);
  }
  doc.end();
}

/**
 * Shift / personal PDF report: summarises what `user` did during
 * [from, to] — their notes, alarms raised in the window, and the work
 * orders assigned to them.
 *
 * Uses a deep-green / near-black OCP palette consistent with the UI.
 * Positioning is strictly cursor-based (never absolute) so that the
 * "empty state" notices always render in the right place.
 */
function streamShiftPdf(stream, {
  user, notes = [], alarms = [], orders = [], from, to,
}) {
  // Deep-green / near-black OCP palette
  const OCP_PRIMARY = '#0A4F2A';   // primary (deep)
  const OCP_DEEP    = '#043318';   // near-black green (titles, header band)
  const OCP_ACCENT  = '#16764A';   // secondary accent
  const TINT        = '#DFF0E4';   // soft tint
  const TEXT        = '#0E1B14';   // body text, near-black
  const MUTED       = '#5E6B66';   // subdued text

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  doc.pipe(stream);

  const MARGIN = 48;
  const PAGE_W = doc.page.width;

  // ── Header band ──────────────────────────────────────────────────────────
  doc.save();
  doc.rect(0, 0, PAGE_W, 78).fill(OCP_DEEP);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
     .text('Shift Report', MARGIN, 22, { lineBreak: false });
  doc.font('Helvetica').fontSize(10).fillColor(TINT)
     .text(`Phoswatch · OCP Benguerir · ${new Date().toISOString().replace('T',' ').slice(0,16)}`,
           MARGIN, 50, { lineBreak: false });
  doc.restore();

  // Explicitly move cursor past the header band — do NOT rely on moveDown().
  doc.x = MARGIN;
  doc.y = 98;

  // ── User block ───────────────────────────────────────────────────────────
  doc.fillColor(OCP_PRIMARY).font('Helvetica-Bold').fontSize(13)
     .text(`${user.full_name || user.username}   (${user.role})`);
  doc.fillColor(MUTED).font('Helvetica').fontSize(10)
     .text(`Range: ${from.toISOString().replace('T',' ').slice(0,16)} → ${to.toISOString().replace('T',' ').slice(0,16)}`);
  doc.moveDown(0.5);

  // Summary stat strip (tint background)
  const stripY = doc.y;
  doc.save();
  doc.rect(MARGIN, stripY, PAGE_W - MARGIN * 2, 24).fill(TINT);
  doc.restore();
  doc.fillColor(OCP_DEEP).font('Helvetica-Bold').fontSize(11)
     .text(
       `${notes.length} notes   •   ${alarms.length} alarms in period   •   ${orders.length} work orders`,
       MARGIN + 10, stripY + 7, { width: PAGE_W - MARGIN * 2 - 20 }
     );
  doc.y = stripY + 24;
  doc.moveDown(1);
  doc.x = MARGIN;

  // ── Helper for section titles ────────────────────────────────────────────
  function sectionTitle(text) {
    doc.x = MARGIN;
    // Make absolutely sure we have space; otherwise break page first.
    if (doc.y > doc.page.height - 120) doc.addPage();
    const y = doc.y;
    // Left accent bar
    doc.save();
    doc.rect(MARGIN, y + 2, 3, 14).fill(OCP_ACCENT);
    doc.restore();
    doc.fillColor(OCP_DEEP).font('Helvetica-Bold').fontSize(13)
       .text(text, MARGIN + 10, y, { lineBreak: true });
    doc.moveDown(0.4);
    doc.x = MARGIN;
  }

  function emptyState(message) {
    doc.x = MARGIN;
    // Muted italic, guaranteed to be written on this page.
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED)
       .text(message, MARGIN, doc.y, { width: PAGE_W - MARGIN * 2 });
    doc.font('Helvetica');
    doc.moveDown(0.5);
  }

  // ── Shift notes ──────────────────────────────────────────────────────────
  sectionTitle('Shift notes');
  if (!notes.length) {
    emptyState('No notes recorded during this shift.');
  } else {
    for (const n of notes) {
      if (doc.y > doc.page.height - 100) doc.addPage();
      const color = n.severity === 'critical' ? '#8A1C1C'
                  : n.severity === 'warning'  ? '#8A5A00'
                  : OCP_DEEP;
      doc.fillColor(color).font('Helvetica-Bold').fontSize(11)
         .text(`[${n.category}/${n.severity}] ${n.title}`,
               MARGIN, doc.y, { width: PAGE_W - MARGIN * 2 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
         .text(
           `${new Date(n.created_at).toISOString().replace('T',' ').slice(0,16)} · shift ${n.shift}` +
           (n.equipment_tag ? ` · ${n.equipment_tag}` : ''),
           { width: PAGE_W - MARGIN * 2 }
         );
      if (n.body) {
        doc.fillColor(TEXT).fontSize(10)
           .text(n.body, MARGIN + 10, doc.y, { width: PAGE_W - MARGIN * 2 - 10 });
      }
      doc.moveDown(0.4);
    }
  }
  doc.moveDown(0.5);

  // ── Alarms ───────────────────────────────────────────────────────────────
  sectionTitle('Alarms in period');
  if (!alarms.length) {
    emptyState('No alarms raised during this shift.');
  } else {
    for (const a of alarms.slice(0, 40)) {
      if (doc.y > doc.page.height - 70) doc.addPage();
      const color = a.severity === 'fatal' ? '#8A1C1C'
                  : a.severity === 'warning' ? '#8A5A00'
                  : TEXT;
      doc.fillColor(color).font('Helvetica').fontSize(10)
         .text(
           `• ${new Date(a.ts).toISOString().replace('T',' ').slice(0,16)}  [${a.severity}]  ${a.equipment_tag || '-'}  ${a.message || ''}`,
           MARGIN, doc.y, { width: PAGE_W - MARGIN * 2 }
         );
    }
  }
  doc.moveDown(0.5);

  // ── Work orders ──────────────────────────────────────────────────────────
  sectionTitle('Work orders assigned to me');
  if (!orders.length) {
    emptyState('No work orders assigned.');
  } else {
    for (const o of orders) {
      if (doc.y > doc.page.height - 100) doc.addPage();
      doc.fillColor(OCP_DEEP).font('Helvetica-Bold').fontSize(11)
         .text(`#${o.order_id} · ${o.title}  (${o.status})`,
               MARGIN, doc.y, { width: PAGE_W - MARGIN * 2 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
         .text(`priority=${o.priority}   ${o.equipment_tag || ''}`,
               { width: PAGE_W - MARGIN * 2 });
      if (o.description) {
        doc.fillColor(TEXT).fontSize(10)
           .text(o.description, MARGIN + 10, doc.y, { width: PAGE_W - MARGIN * 2 - 10 });
      }
      doc.moveDown(0.3);
    }
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
     .text('Generated by Phoswatch — Real-Time Equipment Monitoring System',
           MARGIN, doc.page.height - 36,
           { align: 'center', width: PAGE_W - MARGIN * 2, lineBreak: false });

  doc.end();
}

module.exports = {
  buildEquipmentXlsx, buildAlarmsXlsx,
  streamEquipmentPdf, streamSummaryPdf, streamShiftPdf,
};
