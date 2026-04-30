/**
 * CommunicationPanel — floating messaging widget.
 *
 * Backed by the /api/messages endpoints (DB-persisted) instead of
 * localStorage so:
 *   • messages survive logout / browser switch
 *   • the alarm-notifier can post on a user's behalf when they're offline
 *   • every authenticated role can DM every other authenticated user
 *
 * The contact dropdown comes from /api/users/directory (auth-only, any
 * role) and lists every active user with their role + email visible so
 * the sender knows who they're contacting.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Users as UsersApi, Messages as MsgApi } from '../../services/api';

const ROLE_COLORS = {
  admin:      { bg: '#102818', text: '#8fc96f' },
  supervisor: { bg: '#1a4d2e', text: '#4CAF50' },
  technician: { bg: '#1e3a28', text: '#66BB6A' },
  operator:   { bg: '#2e5c3a', text: '#A5D6A7' },
  viewer:     { bg: '#3a4f43', text: '#cfe2c8' },
};
const roleOrder = ['admin', 'supervisor', 'technician', 'operator', 'viewer'];

export default function CommunicationPanel() {
  const { user } = useAuth();
  const [open,      setOpen]      = useState(false);
  const [thread,    setThread]    = useState([]);          // current conversation
  const [inbox,     setInbox]     = useState([]);          // raw inbox list
  const [text,      setText]      = useState('');
  const [recipient, setRecipient] = useState('');
  const [contacts,  setContacts]  = useState([]);
  const [unread,    setUnread]    = useState(0);
  const [activeTab, setActiveTab] = useState('chat');      // 'chat' | 'inbox'
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState('');
  const bottomRef = useRef(null);

  /* ── Load contact directory (every active user, any role) ── */
  useEffect(() => {
    if (!user) return;
    UsersApi.directory()
      .then(d => {
        const items = (d.items || []).filter(u => u.id !== user.id);
        setContacts(items);
        if (items.length && !recipient) setRecipient(String(items[0].id));
      })
      .catch(() => setContacts([]));
  }, [user]); // eslint-disable-line

  /* ── Poll inbox + unread count every 4 s ── */
  useEffect(() => {
    if (!user) return;
    const tick = async () => {
      try {
        const [inboxData, unreadData] = await Promise.all([
          MsgApi.list(),
          MsgApi.unread(),
        ]);
        setInbox(inboxData.items || []);
        setUnread(unreadData.count || 0);
      } catch { /* silent — keep retrying */ }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [user]);

  /* ── Load conversation when recipient or open state changes ── */
  useEffect(() => {
    if (!open || !recipient || activeTab !== 'chat') return;
    let cancel = false;
    MsgApi.thread(recipient).then(d => {
      if (cancel) return;
      setThread(d.items || []);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }).catch(() => setThread([]));
    // Mark this peer's incoming messages read
    MsgApi.markRead(Number(recipient)).then(() => {
      MsgApi.unread().then(d => setUnread(d.count || 0)).catch(() => {});
    }).catch(() => {});
    // Refresh thread every 4 s while open
    const t = setInterval(() => {
      MsgApi.thread(recipient).then(d => !cancel && setThread(d.items || [])).catch(() => {});
    }, 4000);
    return () => { cancel = true; clearInterval(t); };
  }, [open, recipient, activeTab]);

  const send = async () => {
    if (!text.trim() || !recipient || busy) return;
    setBusy(true); setErr('');
    try {
      const msg = await MsgApi.send({
        to_user_id: Number(recipient),
        body: text.trim(),
      });
      setThread(prev => [...prev, msg]);
      setText('');
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      setErr(e.response?.data?.message || 'Failed to send');
    } finally {
      setBusy(false);
    }
  };

  const selectedContact = contacts.find(c => String(c.id) === String(recipient));

  /* Group contacts by role for the dropdown */
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
          width: 380, maxHeight: 560,
          background: 'var(--panel, #fff)',
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
              { id: 'inbox', label: `Inbox${unread > 0 ? ` (${unread})` : ''}` },
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

              {/* Recipient selector — grouped by role, shows email */}
              <div style={{
                padding: '8px 12px',
                borderBottom: '1px solid var(--border)',
                flexShrink: 0,
                background: 'var(--g-softer)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--td)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: .5 }}>
                  Pick someone to message ({contacts.length} active users)
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
                              {c.full_name || c.username} — {c.username} ({c.role})
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    {Object.keys(groupedContacts)
                      .filter(r => !roleOrder.includes(r))
                      .map(r => (
                        <optgroup key={r} label={`── ${r} ──`}>
                          {groupedContacts[r].map(c => (
                            <option key={c.id} value={String(c.id)}>
                              {c.full_name || c.username} — {c.username} ({c.role})
                            </option>
                          ))}
                        </optgroup>
                      ))}
                  </select>
                ) : (
                  <div style={{ fontSize: 11.5, color: 'var(--td)' }}>No contacts available.</div>
                )}

                {/* Selected contact details — name, role, email */}
                {selectedContact && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                        background: ROLE_COLORS[selectedContact.role]?.bg || '#333',
                        color:      ROLE_COLORS[selectedContact.role]?.text || '#fff',
                        textTransform: 'capitalize',
                      }}>
                        {selectedContact.role}
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--tm)', fontWeight: 600 }}>
                        {selectedContact.full_name || selectedContact.username}
                      </span>
                    </div>
                    {selectedContact.email && (
                      <div style={{ fontSize: 10.5, color: 'var(--td)', fontFamily: "'JetBrains Mono', monospace" }}>
                        ✉ {selectedContact.email}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Thread */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {thread.length === 0 && (
                  <div style={{ color: 'var(--td)', fontSize: 12, textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>
                    {selectedContact
                      ? `Start a conversation with ${selectedContact.full_name || selectedContact.username}`
                      : 'Select a contact to start chatting'}
                  </div>
                )}
                {thread.map(m => {
                  const isMe = m.from_user_id === user?.id;
                  const isAlert = m.kind === 'alert';
                  return (
                    <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '82%', padding: '7px 11px',
                        borderRadius: isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                        background: isAlert ? 'rgba(214,69,69,.12)'
                                   : isMe   ? 'var(--g)' : 'var(--g-softer)',
                        border: `1px solid ${isAlert ? 'var(--red)'
                                            : isMe   ? 'transparent' : 'var(--border)'}`,
                        color: isAlert ? 'var(--red)' : isMe ? '#fff' : 'var(--tx)',
                        fontSize: 12.5, lineHeight: 1.45,
                        whiteSpace: 'pre-wrap',
                      }}>
                        {isAlert && <span style={{ fontWeight: 700 }}>🚨 ALERT — </span>}
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
                        {new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {err && (
                <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--red)', background: 'rgba(214,69,69,.06)' }}>
                  {err}
                </div>
              )}

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
                  disabled={!selectedContact || busy}
                  style={{
                    flex: 1, fontSize: 12.5, padding: '7px 10px',
                    border: '1px solid var(--border)', borderRadius: 7,
                    background: selectedContact ? '#fff' : 'var(--g-softer)',
                    color: 'var(--tx)', outline: 'none',
                  }}
                />
                <button
                  onClick={send}
                  disabled={!text.trim() || !selectedContact || busy}
                  style={{
                    background: 'var(--g)', border: 'none', cursor: 'pointer',
                    borderRadius: 7, padding: '0 14px', color: '#fff', fontSize: 12,
                    fontWeight: 600,
                    opacity: (!text.trim() || !selectedContact || busy) ? .4 : 1,
                    transition: 'opacity .15s',
                  }}
                >
                  {busy ? '…' : 'Send'}
                </button>
              </div>
            </div>
          )}

          {/* ── Inbox tab ── */}
          {activeTab === 'inbox' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {inbox.length === 0 ? (
                <div style={{ color: 'var(--td)', fontSize: 12, textAlign: 'center', marginTop: 24 }}>
                  No messages yet.
                </div>
              ) : (
                inbox
                  .filter(m => m.to_user_id === user?.id)
                  .map(m => {
                    const isAlert = m.kind === 'alert';
                    return (
                      <div key={m.id} style={{
                        padding: '10px 12px',
                        background: isAlert ? 'rgba(214,69,69,.06)' :
                                    m.read  ? 'var(--g-softer)' : 'rgba(0,122,61,.06)',
                        border: `1px solid ${isAlert ? 'var(--red)'
                                            : m.read ? 'var(--border)' : 'rgba(0,122,61,.22)'}`,
                        borderRadius: 8,
                        borderLeft: `3px solid ${isAlert ? 'var(--red)'
                                                : ROLE_COLORS[m.fromRole]?.bg || '#ccc'}`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{
                              padding: '2px 7px', borderRadius: 4,
                              background: ROLE_COLORS[m.fromRole]?.bg || '#333',
                              color:      ROLE_COLORS[m.fromRole]?.text || '#fff',
                              fontSize: 9.5, fontWeight: 700, textTransform: 'capitalize',
                            }}>
                              {m.fromRole || 'system'}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx)' }}>{m.fromName || m.from_username}</span>
                            {isAlert && (
                              <span style={{ fontSize: 9, color: 'var(--red)', fontWeight: 700, letterSpacing: 1 }}>
                                🚨 CRITICAL
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: 10, color: 'var(--td)', fontFamily: "'JetBrains Mono', monospace" }}>
                            {new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--tx)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                          {m.body}
                        </div>
                        <button
                          onClick={() => {
                            setRecipient(String(m.from_user_id));
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
                    );
                  })
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
