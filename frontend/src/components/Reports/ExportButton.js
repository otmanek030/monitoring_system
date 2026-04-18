/**
 * Small button that fetches a binary report via Axios (so the JWT header is
 * attached), turns the blob into an object URL, and triggers a download.
 */
import { useState } from 'react';
import { Reports } from '../../services/api';

export default function ExportButton({ url, filename, label = 'Download', icon = '⬇' }) {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  const go = async () => {
    setBusy(true); setErr('');
    try {
      const blob = await Reports.fetchBlob(url);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      setErr(e.response?.status === 403 ? 'Not allowed' : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="primary small" onClick={go} disabled={busy}>
        {icon} {busy ? 'Preparing…' : label}
      </button>
      {err && <span className="error" style={{ marginLeft: 8 }}>{err}</span>}
    </>
  );
}
