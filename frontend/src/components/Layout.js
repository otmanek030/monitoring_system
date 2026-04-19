/**
 * Layout — OCP light-theme shell with icon nav rail, brand topbar, filter bar.
 *
 * Structure:
 *   .app-shell
 *     .nav-rail       — 56px icon-only left nav, white bg
 *     .main-column
 *       .topbar       — Phoswatch brand + breadcrumb + time pill + user
 *       .filter-bar   — plant / unit / status filter chips
 *       .main         — <Outlet /> scrollable content
 */
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/* ── SVG icons ───────────────────────────────────────────────── */
const Icons = {
  logo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
    </svg>
  ),
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  equipment: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="2" y="3" width="20" height="5" rx="1"/>
      <rect x="2" y="10" width="20" height="5" rx="1"/>
      <rect x="2" y="17" width="20" height="5" rx="1"/>
      <circle cx="6" cy="5.5" r="1" fill="currentColor"/>
      <circle cx="6" cy="12.5" r="1" fill="currentColor"/>
      <circle cx="6" cy="19.5" r="1" fill="currentColor"/>
    </svg>
  ),
  alarms: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
  ),
  predictions: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  maintenance: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
    </svg>
  ),
  notes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="5" y="2" width="14" height="20" rx="2"/>
      <line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/>
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  help: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/>
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/>
    </svg>
  ),
  chevDown: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  refresh: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M1 4v6h6M23 20v-6h-6"/>
      <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15"/>
    </svg>
  ),
  server: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="2" y="3" width="20" height="5" rx="1"/>
      <rect x="2" y="10" width="20" height="5" rx="1"/>
      <rect x="2" y="17" width="20" height="5" rx="1"/>
    </svg>
  ),
};

/* ── Page meta ───────────────────────────────────────────────── */
const PAGE_META = {
  '/':            { label: 'Dashboard',      unit: 'Equipment Monitoring' },
  '/equipment':   { label: 'Equipment',      unit: 'Registry' },
  '/alarms':      { label: 'Alarms',         unit: 'Active Events' },
  '/predictions': { label: 'AI Predictions', unit: 'ML Models' },
  '/maintenance': { label: 'Maintenance',    unit: 'Work Orders' },
  '/notes':       { label: 'Shift Notes',    unit: 'Logbook' },
  '/reports':     { label: 'Reports',        unit: 'Export' },
  '/users':       { label: 'Users',          unit: 'Access Control' },
};

/* ── Nav items ───────────────────────────────────────────────── */
const NAV_ITEMS = [
  { to: '/',            label: 'Dashboard',      icon: Icons.dashboard,   end: true,  perm: 'dashboard'   },
  { to: '/equipment',   label: 'Equipment',      icon: Icons.equipment,               perm: 'equipment'   },
  { to: '/alarms',      label: 'Alarms',         icon: Icons.alarms,                  perm: 'alarms'      },
  { to: '/predictions', label: 'AI Predictions', icon: Icons.predictions,             perm: 'predictions' },
  { to: '/maintenance', label: 'Maintenance',    icon: Icons.maintenance,             perm: 'maintenance' },
  { to: '/notes',       label: 'Shift Notes',    icon: Icons.notes,                   perm: 'notes'       },
  { to: '/reports',     label: 'Reports',        icon: Icons.reports,                 perm: 'reports'     },
  { to: '/users',       label: 'Users',          icon: Icons.users,                   adminOnly: true     },
];

export default function Layout() {
  const { user, logout, can } = useAuth();
  const location = useLocation();

  const currentPage = PAGE_META[location.pathname] || { label: 'Page', unit: '' };

  const now     = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const visibleLinks = NAV_ITEMS.filter(item => {
    if (item.adminOnly) return user?.role === 'admin';
    if (item.perm === 'reports') return can('reports') || can('my_shift');
    return can(item.perm);
  });

  return (
    <div className="app-shell">

      {/* ── Icon nav rail ── */}
      <nav className="nav-rail">
        <div className="nav-logo" title="PhosWatch">
          {Icons.logo}
        </div>

        {visibleLinks.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-btn${isActive ? ' active' : ''}`}
          >
            {item.icon}
            <span className="nav-tooltip">{item.label}</span>
          </NavLink>
        ))}

        <div className="nav-spacer" />

        <button className="nav-btn" title="Help">
          {Icons.help}
          <span className="nav-tooltip">Help</span>
        </button>
        <button className="nav-btn" title="Log out" onClick={logout} style={{ marginTop: 4 }}>
          {Icons.logout}
          <span className="nav-tooltip">Log out</span>
        </button>
      </nav>

      {/* ── Right column ── */}
      <div className="main-column">

        {/* Topbar */}
        <header className="topbar">
          {/* Brand */}
          <div className="brand">
            <span className="brand-name">phoswatch</span>
            <span className="brand-badge">v1</span>
          </div>
          <div className="brand-sep" />

          {/* Breadcrumb */}
          <div className="breadcrumb">
            <span className="bc-part">OCP Benguerir</span>
            <span className="bc-sep">/</span>
            <span className="bc-current">{currentPage.label}</span>
          </div>

          {/* Right actions */}
          <div className="tb-right">
            {/* Live indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tm)', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }}>
              <span className="sdot" />
              Live
            </div>

            {/* Share */}
            <button className="icon-btn" title="Share">{Icons.share}</button>

            {/* Time pill */}
            <div className="time-pill">
              {Icons.clock}
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>
                {dateStr} · {timeStr}
              </span>
              {Icons.chevDown}
            </div>

            {/* User */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '4px 11px',
              background: '#fff',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
            }}>
              <span style={{ color: 'var(--tx)' }}>
                {user?.fullName?.split(' ')[0] || user?.username || 'User'}
              </span>
              <span className={`badge role-${user?.role || 'viewer'}`}>
                {user?.role || 'viewer'}
              </span>
            </div>
          </div>
        </header>

        {/* Filter bar */}
        <div className="filter-bar">
          <div className="filter-chip">
            <span className="lbl">Plant</span>
            <span className="val">
              Benguerir — Washing &amp; Flotation
              {Icons.chevDown}
            </span>
          </div>
          <div className="filter-chip">
            <span className="lbl">Unit</span>
            <span className="val">All units {Icons.chevDown}</span>
          </div>
          <div className="filter-chip">
            <span className="lbl">Status</span>
            <span className="val">All {Icons.chevDown}</span>
          </div>

          <div className="fb-right">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="sdot" />
              <span>All systems nominal</span>
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {Icons.server}
              <span style={{ color: 'var(--tx)', fontWeight: 500 }}>Plant:</span>
              <code>OCP-BGN-001</code>
            </span>
            <span style={{ color: 'var(--tdd)', fontSize: 11 }}>PFE 2026 · v1.0</span>
          </div>
        </div>

        {/* Scrollable page content */}
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
