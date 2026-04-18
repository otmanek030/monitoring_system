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
      <form className="card box" onSubmit={submit}>
        <h2 style={{ color: '#fff' }}>Phoswatch</h2>
        <div className="muted mb-16">Sign in to continue</div>
        <label className="mb-10" style={{ display: 'block' }}>
          <span className="muted" style={{ fontSize: 12 }}>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)}
                 autoFocus style={{ width: '100%' }} />
        </label>
        <label className="mb-10" style={{ display: 'block' }}>
          <span className="muted" style={{ fontSize: 12 }}>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 style={{ width: '100%' }} />
        </label>
        <button className="primary" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <div className="error">{error}</div>}
        <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
          Seed credentials: admin / phoswatch123
        </div>
      </form>
    </div>
  );
}
