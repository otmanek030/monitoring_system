/**
 * CommunicationPanel — floating messaging widget.
 *
 * Any role can contact any other role:
 *   Admin ↔ Supervisor, Technician, Operator  (and vice versa)
 *
 * Messages are stored in localStorage (cross-tab simulation).
 * In production, this would use WebSocket message rooms.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Users as UsersApi } from '../../services/api';

const STORAGE_KEY = 'phoswatch.messages.v2';

function loadMessages() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveMessages(msgs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-300))); }
  catch {}
}

/* Role badge colors */
const ROLE_COLORS = {
  admin:      { bg: '#102818', text: '#8fc96f' },
  supervisor: { bg: '#1a4d2e', text: '#4CAF50' },
  technician: { bg: '#1e3a28', text: '#66BB6A' },
  operator:   { bg: '#2e5c3a', text: '#A5D6A7' },
};

const roleOrder = ['admin', 'supervisor', 'technician', 'operator'];

export default function CommunicationPanel() {
  const { user } = useAuth();
  const [open,      setOpen]      = useState(false);
  const [messages,  setMessages]  = useState(loadMessages);
  const [text,      setText]      = useState('');
  const [recipient, setRecipient] = useState('');
  const [contacts,  setContacts]  = useState([]);
  const [unread,    setUnread]    = useState(0);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'inbox'
  const bottomRef = useRef(null);

  /* Poll localStorage for new messages */
  useEffect(() => {
    const tick = () => {
      const fresh = loadMessages();
      setMessages(fresh);
      if (!open) {
        const myInbox = fresh.filter(m => m.to === user?.id);
        setUnread(myInbox.filter(m => !m.read).length);
      }
    };
    const t = setInterval(tick, 1500);
    return () => clearInterval(t);
  }, [open, user]);

  /* Load ALL other users regardless of role */
  useEffect(() => {
    if (!user) return;
    UsersApi.list()
      .then(d => {
        const all = d.items || d.users || d || [];
        const others = all.filter(u => u.is_active && u.id !== user.id);
        setContacts(others);
        if (others.length && !recipient) setRecipient(String(others[0].id));
      })
      .catch(() => {});
  }, [user]); // eslint-disable-line

  /* Scroll + mark read on open */
  useEffect(() => {
    if (open) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
      const updated = loadMessages().map(m =>
        m.to === user?.id ? { ...m, read: true } : m
      );
      saveMessages(updated);
      setMessages(updated);
      setUnread(0);
    }
  }, [open, user]);

  const send = () => {
    if (!text.trim() || !recipient) return;
    const target = contacts.find(c => String(c.id) === String(recipient));
    const msg = {
      id:       Date.now(),
      from:     user?.id,
      fromName: user?.username || user?.fullName || 'User',
      fromRole: user?.role,
      to:       target?.id,
      toName:   target?.username || target?.full_name || '?',
      toRole:   target?.role,
      body:     text.trim(),
      ts:       new Date().toISOString(),
      read:     false,
    };
    const updated = [...loadMessages(), msg];
    saveMessages(updated);
    setMessages(updated);
    setText('');
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  /* Build thread for selected recipient */
  const selectedContact = contacts.find(c => String(c.id) === String(recipient));
  const thread = messages
    .filter(m =>
      (m.from === user?.id && m.to === selectedContact?.id) ||
      (m.to   === user?.id && m.from === selectedContact?.id)
    )
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));

  /* All inbox messages */
  const inbox = messages
    .filter(m => m.to === user?.id)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));

  /* Group contacts by role */
  const groupedContacts = contacts.reduce((acc, c) => {
    const r = c.role || 'unknown';
    if (!acc[r]) acc[r] = [];
    acc[r].push(c);
    return acc;
  }, {});

  return (
    <>
      {/* Floating toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9000,
          width: 48, height: 48, borderRadius: '50%',
          background: 'var(--g)', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0,122,61,.35)',
          transition: 'transform .15s',
        }}
        title="Communication"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"
          style={{ width: 22, height: 22 }}>
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            background: 'var(--red)', color: '#fff',
            borderRadius: '50%', width: 18, height: 18,
            fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #fff',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 78, right: 20, zIndex: 8999,
          width: 360, maxHeight: 540,
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,.16)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>

          {/* Header */}
          <div style={{
            padding: '11px 14px',
            background: 'var(--g)',
            display: 'flex', alignItems: 'center', gap: 8,
            flexShrink: 0,
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"
              style={{ width: 16, height: 16, flexShrink: 0 }}>
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 13, flex: 1 }}>Communication</span>
            <span style={{ color: 'rgba(255,255,255,.72)', fontSize: 10.5 }}>
              {user?.username} ·{' '}
              <span style={{
                textTransform: 'capitalize',
                padding: '1px 5px', borderRadius: 3,
                background: 'rgba(255,255,255,.2)',
              }}>
                {user?.role}
              </span>
            </span>
            <button onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 18, lineHeight: 1, padding: '0 0 0 8px' }}>
              ×
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {[
              { id: 'chat',  label: 'Messages' },
              { id: 'inbox', label: `Inbox${inbox.length > 0 ? ` (${inbox.length})` : ''}` },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{
                  flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer',
                  background: activeTab === t.id ? 'var(--g-softer)' : 'transparent',
                  borderBottom: activeTab === t.id ? '2px solid var(--g)' : '2px solid transparent',
                  color: activeTab === t.id ? 'var(--g)' : 'var(--tm)',
                  fontWeight: activeTab === t.id ? 700 : 400,
                  fontSize: 12,
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Chat tab ── */}
          {activeTab === 'chat' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

              {/* Recipient selector — grouped by role */}
              <div style={{
                padding: '8px 12px',
                borderBottom: '1px solid var(--border)',
                flexShrink: 0,
                background: 'var(--g-softer)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--td)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: .5 }}>
                  Contact a role
                </div>
                {contacts.length > 0 ? (
                  <select
                    value={recipient}
                    onChange={e => setRecipient(e.target.value)}
                    style={{
                      width: '100%', fontSize: 12, padding: '5px 8px',
                      border: '1px solid var(--border)', borderRadius: 6,
                      background: '#fff', color: 'var(--tx)',
                    }}
                  >
                    {roleOrder
                      .filter(r => groupedContacts[r]?.length > 0)
                      .map(r => (
                        <optgroup key={r} label={`── ${r.charAt(0).toUpperCase() + r.slice(1)} ──`}>
                          {groupedContacts[r].map(c => (
                            <option key={c.id} value={String(c.id)}>
                              {c.username || c.full_name} ({c.role})
                            </option>
                          ))}
                        </optgroup>
                      ))
                    }
                    {Object.keys(groupedContacts)
                      .filter(r => !roleOrder.includes(r))
                      .map(r => (
                        <optgroup key={r} label={`── ${r} ──`}>
                          {groupedContacts[r].map(c => (
                            <option key={c.id} value={String(c.id)}>
                              {c.username || c.full_name} ({c.role})
                            </option>
                          ))}
                        </optgroup>
                      ))
                    }
                  </select>
                ) : (
                  <div style={{ fontSize: 11.5, color: 'var(--td)' }}>No contacts available.</div>
                )}

                {/* Show selected contact's role badge */}
                {selectedContact && (
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                      background: ROLE_COLORS[selectedContact.role]?.bg || '#333',
                      color:      ROLE_COLORS[selectedContact.role]?.text || '#fff',
                      textTransform: 'capitalize',
                    }}>
                      {selectedContact.role}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--tm)', fontWeight: 600 }}>
                      {selectedContact.username || selectedContact.full_name}
                    </span>
                  </div>
                )}
              </div>

              {/* Thread */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {thread.length === 0 && (
                  <div style={{ color: 'var(--td)', fontSize: 12, textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>
                    {selectedContact
                      ? `Start a conversation with\n${selectedContact.username}`
                      : 'Select a contact to start chatting'}
                  </div>
                )}
                {thread.map(m => {
                  const isMe = m.from === user?.id;
                  return (
                    <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '82%', padding: '7px 11px',
                        borderRadius: isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                        background: isMe ? 'var(--g)' : 'var(--g-softer)',
                        border: `1px solid ${isMe ? 'transparent' : 'var(--border)'}`,
                        color: isMe ? '#fff' : 'var(--tx)',
                        fontSize: 12.5, lineHeight: 1.45,
                      }}>
                        {m.body}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, fontSize: 9.5, color: 'var(--td)' }}>
                        {!isMe && (
                          <span style={{
                            padding: '1px 6px', borderRadius: 3,
                            background: ROLE_COLORS[m.fromRole]?.bg || '#333',
                            color: ROLE_COLORS[m.fromRole]?.text || '#fff',
                            fontSize: 9, fontWeight: 600, textTransform: 'capitalize',
                          }}>
                            {m.fromRole}
                          </span>
                        )}
                        {new Date(m.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Compose */}
              <div style={{
                padding: '8px 12px 11px',
                borderTop: '1px solid var(--border)',
                display: 'flex', gap: 6, flexShrink: 0,
              }}>
                <input
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
                  placeholder={selectedContact ? `Message ${selectedContact.username}…` : 'Select a contact first…'}
                  disabled={!selectedContact}
                  style={{
                    flex: 1, fontSize: 12.5, padding: '7px 10px',
                    border: '1px solid var(--border)', borderRadius: 7,
                    background: selectedContact ? '#fff' : 'var(--g-softer)',
                    color: 'var(--tx)', outline: 'none',
                  }}
                />
                <button
                  onClick={send}
                  disabled={!text.trim() || !selectedContact}
                  style={{
                    background: 'var(--g)', border: 'none', cursor: 'pointer',
                    borderRadius: 7, padding: '0 14px', color: '#fff', fontSize: 12,
                    fontWeight: 600,
                    opacity: (!text.trim() || !selectedContact) ? .4 : 1,
                    transition: 'opacity .15s',
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          )}

          {/* ── Inbox tab ── */}
          {activeTab === 'inbox' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {inbox.length === 0 ? (
                <div style={{ color: 'var(--td)', fontSize: 12, textAlign: 'center', marginTop: 24 }}>
                  No messages received yet.
                </div>
              ) : (
                inbox.map(m => (
                  <div key={m.id} style={{
                    padding: '10px 12px',
                    background: m.read ? 'var(--g-softer)' : 'rgba(0,122,61,.06)',
                    border: `1px solid ${m.read ? 'var(--border)' : 'rgba(0,122,61,.22)'}`,
                    borderRadius: 8,
                    borderLeft: `3px solid ${ROLE_COLORS[m.fromRole]?.bg || '#ccc'}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          padding: '2px 7px', borderRadius: 4,
                          background: ROLE_COLORS[m.fromRole]?.bg || '#333',
                          color:      ROLE_COLORS[m.fromRole]?.text || '#fff',
                          fontSize: 9.5, fontWeight: 700, textTransform: 'capitalize',
                        }}>
                          {m.fromRole}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx)' }}>{m.fromName}</span>
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--td)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {new Date(m.ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--tx)', lineHeight: 1.5 }}>{m.body}</div>
                    <button
                      onClick={() => {
                        setRecipient(String(m.from));
                        setActiveTab('chat');
                      }}
                      style={{
                        marginTop: 7, fontSize: 10.5, color: 'var(--g)', background: 'none',
                        border: '1px solid var(--border)', borderRadius: 5, padding: '3px 9px',
                        cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      ↩ Reply
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
