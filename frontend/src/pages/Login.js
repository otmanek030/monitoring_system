import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('phoswatch123');
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);

  if (user) return <Navigate to={loc.state?.from || '/'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await login(username, password);
      nav(loc.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="box" onSubmit={submit} style={{
        width: 380,
        background: 'var(--panel)',
        padding: '32px 28px',
        borderRadius: 'var(--rl)',
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--border-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}>
        {/* Logo + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <div style={{
            width: 36, height: 36,
            background: 'linear-gradient(135deg, #007a3d, #00a352)',
            borderRadius: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 14px rgba(0,122,61,.3)',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" width={18} height={18}>
              <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--tx)', letterSpacing: -.3 }}>
              Phos<span style={{ color: 'var(--g)' }}>watch</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>OCP Benguerir · PFE 2026</div>
          </div>
        </div>

        <div style={{ color: 'var(--tm)', fontSize: 12, marginBottom: 2 }}>
          Sign in to access the monitoring dashboard
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 11.5, color: 'var(--tm)', fontWeight: 600, letterSpacing: .3 }}>
            USERNAME
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            style={{ width: '100%' }}
            placeholder="username"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 11.5, color: 'var(--tm)', fontWeight: 600, letterSpacing: .3 }}>
            PASSWORD
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%' }}
            placeholder="••••••••"
          />
        </label>

        <button className="primary" type="submit" disabled={busy}
          style={{ width: '100%', padding: '8px 0', fontSize: 13, marginTop: 4 }}>
          {busy ? 'Signing in…' : 'Sign in →'}
        </button>

        {error && <div className="error" style={{ marginTop: 0 }}>⚠ {error}</div>}

        <div style={{ fontSize: 10.5, color: 'var(--td)', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          Default credentials: <code>admin</code> / <code>phoswatch123</code>
        </div>
      </form>
    </div>
  );
}
