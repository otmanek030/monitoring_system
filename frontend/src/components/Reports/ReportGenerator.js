/**
 * ReportGenerator — professional, organized form that builds a report URL
 * and streams the resulting binary back to the user.
 *
 * Layout (vertical):
 *   1. Report type   (segmented control: Equipment / Alarms / Plant Summary)
 *   2. Format        (segmented control: XLSX / PDF)
 *   3. Equipment     (only for type=equipment; auto-hidden otherwise)
 *   4. Date range    (from / to, defaulted to last 7 days, floor at 15/04/2026)
 *   5. Generate      (primary button with loading + success + error feedback)
 *
 * The component owns the loading / done / error UX so the parent doesn't
 * have to handle anything beyond passing in the equipment list.
 */
import { useMemo, useState } from 'react';
import { Reports } from '../../services/api';

const PROJECT_START = '2026-04-15T00:00:00';

const TYPE_OPTIONS = [
  { key: 'equipment',     label: 'Equipment',      desc: 'Sensor readings + alarms + aggregated stats per sensor', icon: '📊' },
  { key: 'alarms',        label: 'Alarms log',     desc: 'All alarms in the date range with ack info & values',      icon: '📋' },
  { key: 'plant_summary', label: 'Plant summary',  desc: 'KPIs · top offenders · AI predictions · maintenance',      icon: '🏭' },
];
const FORMAT_OPTIONS = [
  { key: 'xlsx', label: 'Excel', icon: '📊' },
  { key: 'pdf',  label: 'PDF',   icon: '📄' },
];

const iso = (d) => d.toISOString().slice(0, 19);
const defaultFrom = () => { const d = new Date(); d.setDate(d.getDate() - 7); return iso(d); };
const defaultTo   = () => iso(new Date());

export default function ReportGenerator({ equipment = [] }) {
  const [kind,        setKind]        = useState('equipment');
  const [format,      setFormat]      = useState('xlsx');
  const [equipmentId, setEquipmentId] = useState(equipment[0]?.id || '');
  const [from,        setFrom]        = useState(defaultFrom());
  const [to,          setTo]          = useState(defaultTo());
  const [busy,        setBusy]        = useState(false);
  const [done,        setDone]        = useState(null);   // filename of last success
  const [err,         setErr]         = useState('');

  /* Resolve the URL + filename for the current selection. Plant summary
     ignores the format toggle (it's always PDF). */
  const { url, filename, formatLocked, estSeconds } = useMemo(() => {
    const f = from, t = to;
    if (kind === 'alarms') {
      return format === 'xlsx'
        ? { url: Reports.alarmsXlsxUrl(f, t), filename: `alarms_${f.slice(0,10)}.xlsx`, formatLocked: false, estSeconds: 6 }
        : { url: Reports.summaryPdfUrl(f, t), filename: `summary_${f.slice(0,10)}.pdf`, formatLocked: false, estSeconds: 8 };
    }
    if (kind === 'plant_summary') {
      return { url: Reports.summaryPdfUrl(f, t), filename: `plant_summary_${f.slice(0,10)}.pdf`, formatLocked: 'pdf', estSeconds: 10 };
    }
    return format === 'xlsx'
      ? { url: Reports.equipmentXlsxUrl(equipmentId, f, t), filename: `equipment_${equipmentId}_${f.slice(0,10)}.xlsx`, formatLocked: false, estSeconds: 5 }
      : { url: Reports.equipmentPdfUrl(equipmentId, f, t),  filename: `equipment_${equipmentId}_${f.slice(0,10)}.pdf`,  formatLocked: false, estSeconds: 7 };
  }, [kind, format, equipmentId, from, to]);

  const canSubmit = !busy && (kind !== 'equipment' || !!equipmentId);

  const submit = async (e) => {
    e?.preventDefault?.();
    setErr(''); setDone(null);
    if (!canSubmit) return;
    setBusy(true);
    try {
      await Reports.download(url, filename);
      setDone(filename);
    } catch (ex) {
      setErr(
        ex.response?.status === 403 ? 'You do not have permission to generate this report.'
        : ex.response?.status === 404 ? 'Report endpoint not found — check your range or selection.'
        : 'Failed to generate the report. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-head">
        <span className="title">Generate Report</span>
        <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>
          Streamed directly to your machine — JWT-authenticated.
        </span>
        <span className="menu">⋯</span>
      </div>

      <div className="panel-body" style={{ gap: 16, padding: '14px 16px 16px' }}>
        {/* 1) Report type — segmented cards */}
        <Field label="Report type">
          <div className="rg-seg">
            {TYPE_OPTIONS.map(t => (
              <button
                type="button"
                key={t.key}
                className={`rg-seg-btn${kind === t.key ? ' active' : ''}`}
                onClick={() => setKind(t.key)}
                title={t.desc}
              >
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                  <strong style={{ fontSize: 12 }}>{t.label}</strong>
                  <span style={{ fontSize: 10.5, color: kind === t.key ? 'var(--g)' : 'var(--td)', lineHeight: 1.3 }}>
                    {t.desc}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Field>

        {/* 2) Format */}
        <Field label="Format">
          <div className="rg-seg" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            {FORMAT_OPTIONS.map(f => {
              const disabled = formatLocked && formatLocked !== f.key;
              return (
                <button
                  type="button"
                  key={f.key}
                  className={`rg-seg-btn${format === f.key && !disabled ? ' active' : ''}`}
                  onClick={() => !disabled && setFormat(f.key)}
                  disabled={disabled}
                  style={{ opacity: disabled ? .4 : 1 }}
                >
                  <span style={{ fontSize: 16 }}>{f.icon}</span>
                  <strong style={{ fontSize: 12 }}>{f.label}</strong>
                </button>
              );
            })}
          </div>
          {formatLocked === 'pdf' && (
            <Hint>Plant summary is only available as PDF.</Hint>
          )}
        </Field>

        {/* 3) Equipment (only for equipment reports) */}
        {kind === 'equipment' && (
          <Field label="Equipment">
            <select
              value={equipmentId}
              onChange={e => setEquipmentId(e.target.value)}
              required
            >
              <option value="">— select equipment —</option>
              {equipment.map(eq => (
                <option key={eq.id} value={eq.id}>
                  {eq.tag} — {eq.name}
                </option>
              ))}
            </select>
            {!equipmentId && <Hint kind="warn">Pick an asset to enable Generate.</Hint>}
          </Field>
        )}

        {/* 4) Date range */}
        <Field label="Date range">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <SubField label="From">
              <input
                type="datetime-local"
                value={from.slice(0, 16)}
                min={PROJECT_START.slice(0, 16)}
                onChange={e => setFrom(e.target.value + ':00')}
                required
              />
            </SubField>
            <SubField label="To">
              <input
                type="datetime-local"
                value={to.slice(0, 16)}
                min={from.slice(0, 16)}
                onChange={e => setTo(e.target.value + ':00')}
                required
              />
            </SubField>
          </div>
          <Hint>Range floor: 15/04/2026 (project start). Estimated time: ~{estSeconds}s.</Hint>
        </Field>

        {/* 5) Generate + status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="submit"
            disabled={!canSubmit}
            className="primary"
            style={{
              width: '100%', padding: '11px 14px',
              fontSize: 13, fontWeight: 700,
              opacity: canSubmit ? 1 : .4,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {busy
              ? '⏳ Generating — please wait…'
              : `📄 Generate ${formatLocked || format.toUpperCase()} report`}
          </button>

          {/* Status messages */}
          {err && (
            <div style={{
              border: '1px solid rgba(214,69,69,.3)', background: 'rgba(214,69,69,.06)',
              color: 'var(--red)', borderRadius: 6, padding: '8px 12px', fontSize: 12,
            }}>
              ⚠ {err}
            </div>
          )}
          {done && !busy && (
            <div style={{
              border: '1px solid rgba(0,122,61,.3)', background: 'rgba(0,122,61,.06)',
              color: 'var(--g)', borderRadius: 6, padding: '8px 12px', fontSize: 12,
            }}>
              ✓ Saved <code style={{ background: 'var(--g-softer)', padding: '1px 6px', borderRadius: 3 }}>{done}</code>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}

/* ── Reusable form pieces ────────────────────────────────────────── */
function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{
        fontSize: 10.5, fontWeight: 700, color: 'var(--tm)',
        letterSpacing: .5, textTransform: 'uppercase',
      }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function SubField({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: 'var(--td)' }}>{label}</span>
      {children}
    </label>
  );
}

function Hint({ children, kind = 'info' }) {
  const color = kind === 'warn' ? 'var(--yellow)' : 'var(--td)';
  return (
    <span style={{ fontSize: 10.5, color, lineHeight: 1.4 }}>{children}</span>
  );
}
