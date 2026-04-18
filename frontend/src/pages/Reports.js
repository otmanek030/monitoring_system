/**
 * Reports page: wraps ReportGenerator and lists recent reports created by
 * the user (if the backend /reports history endpoint is implemented).
 */
import { useEffect, useState } from 'react';
import ReportGenerator from '../components/Reports/ReportGenerator';
import { Equipment as EqApi } from '../services/api';

export default function Reports() {
  const [equipment, setEquipment] = useState([]);

  useEffect(() => {
    EqApi.list().then(d => setEquipment(d.items || d)).catch(() => {});
  }, []);

  return (
    <div>
      <div className="page-head"><h2>Reports & exports</h2></div>
      <div className="grid-2">
        <ReportGenerator equipment={equipment} />
        <div className="card">
          <div className="card-head"><strong>Available report types</strong></div>
          <ul className="muted" style={{ lineHeight: 1.8 }}>
            <li><strong>Equipment (xlsx)</strong> — sensor readings + alarms + stats.</li>
            <li><strong>Equipment (pdf)</strong> — 1-page executive summary + health index.</li>
            <li><strong>Alarms log (xlsx)</strong> — every alarm in range with ack info.</li>
            <li><strong>Plant summary (pdf)</strong> — KPIs, top offenders, AI findings.</li>
          </ul>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Reports are generated on-demand by the backend service and streamed as binary.
          </div>
        </div>
      </div>
    </div>
  );
}
