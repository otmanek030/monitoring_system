import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Phos<span>watch</span></div>
        <nav>
          <NavLink to="/"             end>📊 Dashboard</NavLink>
          <NavLink to="/equipment"       >⚙️ Equipment</NavLink>
          <NavLink to="/alarms"          >🚨 Alarms</NavLink>
          <NavLink to="/predictions"     >🤖 Predictions</NavLink>
          <NavLink to="/maintenance"     >🔧 Maintenance</NavLink>
          <NavLink to="/reports"         >📄 Reports</NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/users"         >👥 Users</NavLink>
          )}
        </nav>
        <div className="foot">
          OCP Benguerir — Washing &amp; Flotation<br/>
          <span className="muted">v1.0 · PFE 2026</span>
        </div>
      </aside>
      <header className="topbar">
        <h1>Real-time Equipment Monitoring</h1>
        <div className="spacer" />
        <span className="user">{user?.fullName || user?.username} · <em>{user?.role}</em></span>
        <button className="ghost" onClick={logout}>Log out</button>
      </header>
      <main className="main"><Outlet /></main>
    </div>
  );
}
