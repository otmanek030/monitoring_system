import { createContext, useContext, useEffect, useState } from 'react';
import { Auth } from '../services/api';
import { closeSocket } from '../services/websocket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tok = localStorage.getItem('phoswatch.token');
    if (!tok) { setLoading(false); return; }
    Auth.me()
      .then(setUser)
      .catch(() => localStorage.removeItem('phoswatch.token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const { token, user } = await Auth.login(username, password);
    localStorage.setItem('phoswatch.token', token);
    setUser(user);
    return user;
  };

  const logout = () => {
    localStorage.removeItem('phoswatch.token');
    setUser(null);
    closeSocket();
  };

  const can = (resource, action = 'r') => {
    if (!user) return false;
    const p = user.permissions?.[resource];
    if (p === '*' || p === true) return true;
    if (typeof p === 'string' && p.includes(action)) return true;
    return false;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
