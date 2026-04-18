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

module.exports = {
  buildEquipmentXlsx, buildAlarmsXlsx,
  streamEquipmentPdf, streamSummaryPdf,
};
