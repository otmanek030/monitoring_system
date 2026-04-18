/**
 * Form that assembles a report URL (equipment or alarms, xlsx or pdf) for a
 * chosen date range and hands it off to <ExportButton />.
 */
import { useMemo, useState } from 'react';
import ExportButton from './ExportButton';
import { Reports } from '../../services/api';

const iso = (d) => d.toISOString().slice(0, 19);
const defaultFrom = () => {
  const d = new Date(); d.setDate(d.getDate() - 7); return iso(d);
};
const defaultTo = () => iso(new Date());

export default function ReportGenerator({ equipment = [] }) {
  const [kind,        setKind]        = useState('equipment');
  const [format,      setFormat]      = useState('xlsx');
  const [equipmentId, setEquipmentId] = useState(equipment[0]?.id || '');
  const [from,        setFrom]        = useState(defaultFrom());
  const [to,          setTo]          = useState(defaultTo());

  const { url, filename } = useMemo(() => {
    const f = from, t = to;
    if (kind === 'alarms') {
      return format === 'xlsx'
        ? { url: Reports.alarmsXlsxUrl(f, t), filename: `alarms_${f}_${t}.xlsx` }
        : { url: Reports.summaryPdfUrl(f, t), filename: `summary_${f}_${t}.pdf` };
    }
    return format === 'xlsx'
      ? { url: Reports.equipmentXlsxUrl(equipmentId, f, t), filename: `equipment_${equipmentId}_${f}.xlsx` }
      : { url: Reports.equipmentPdfUrl(equipmentId, f, t), filename: `equipment_${equipmentId}_${f}.pdf` };
  }, [kind, format, equipmentId, from, to]);

  return (
    <div className="card">
      <div className="card-head"><strong>Generate report</strong></div>
      <div className="grid-2">
        <label>
          <span className="muted" style={{ fontSize: 12 }}>Report type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="equipment">Equipment readings</option>
            <option value="alarms">Alarms / summary</option>
          </select>
        </label>
        <label>
          <span className="muted" style={{ fontSize: 12 }}>Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="pdf">PDF (.pdf)</option>
          </select>
        </label>

        {kind === 'equipment' && (
          <label style={{ gridColumn: 'span 2' }}>
            <span className="muted" style={{ fontSize: 12 }}>Equipment</span>
            <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
              {equipment.map(e => (
                <option key={e.id} value={e.id}>{e.tag} — {e.name}</option>
              ))}
            </select>
          </label>
        )}

        <label>
          <span className="muted" style={{ fontSize: 12 }}>From</span>
          <input type="datetime-local" value={from.slice(0,16)}
                 onChange={(e) => setFrom(e.target.value + ':00')} />
        </label>
        <label>
          <span className="muted" style={{ fontSize: 12 }}>To</span>
          <input type="datetime-local" value={to.slice(0,16)}
                 onChange={(e) => setTo(e.target.value + ':00')} />
        </label>
      </div>
      <div style={{ marginTop: 12 }}>
        <ExportButton url={url} filename={filename}
                      label={`Download ${format.toUpperCase()}`} />
      </div>
    </div>
  );
}
