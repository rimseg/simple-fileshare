import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../api/client.js';
import StorageBar from '../components/StorageBar.jsx';

function formatDate(ts) { return new Date(ts).toLocaleString(); }

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingPassword, setEditingPassword] = useState(null); // user id
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const [usersData, storageData] = await Promise.all([
        api.listUsers(),
        api.getStorage(),
      ]);
      setUsers(usersData.users);
      setStorage(storageData);
    } catch (err) {
      if (err.status === 401) {
        setSession(null);
        navigate('/login', { replace: true });
      } else setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  async function onDelete(u) {
    if (!confirm(`Delete user "${u.username}" and all ${u.share_count} share(s)?`)) return;
    await api.deleteUser(u.id);
    load();
  }

  return (
    <div className="container">
      <h1>User management</h1>

      <div className="panel">
        <StorageBar stats={storage} />
      </div>

      <CreateUserForm onCreated={load} />

      <div className="panel">
        <h2>All users</h2>
        {loading && <p className="muted">Loading…</p>}
        {error && <div className="error">{error}</div>}
        {!loading && users.length === 0 && <p className="muted">No users.</p>}
        <ul className="link-list">
          {users.map((u) => (
            <li key={u.id} className="link-row">
              <div className="link-row-main stack-sm">
                <div className="text-bold">
                  {u.username} <span className="badge">{u.role}</span>
                </div>
                <div className="muted">
                  Created: {formatDate(u.created_at)} · {u.share_count} share(s)
                </div>
                {editingPassword === u.id && (
                  <PasswordResetForm
                    userId={u.id}
                    username={u.username}
                    onDone={() => { setEditingPassword(null); }}
                    onCancel={() => setEditingPassword(null)}
                  />
                )}
              </div>
              <div className="link-row-actions">
                <button
                  className="btn ghost"
                  onClick={() => setEditingPassword(editingPassword === u.id ? null : u.id)}
                >
                  Password
                </button>
                <button className="btn danger" onClick={() => onDelete(u)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PasswordResetForm({ userId, username, onDone, onCancel }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api.setUserPassword(userId, password);
      setSuccess(`Password set for "${username}"`);
      setPassword('');
      setTimeout(onDone, 800);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack-sm" style={{ marginTop: 'var(--gap-sm)' }}>
      <div className="row">
        <div className="field">
          <label>New password (min. 6 characters)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
            autoFocus
          />
        </div>
      </div>
      <div className="btn-group">
        <button className="btn" disabled={busy} type="submit">
          {busy ? 'Saving…' : 'Set password'}
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
    </form>
  );
}

function CreateUserForm({ onCreated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api.createUser(username, password, role);
      setSuccess(`User "${username}" created`);
      setUsername('');
      setPassword('');
      setRole('user');
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Create new user</h2>
      <form onSubmit={onSubmit}>
        <div className="row">
          <div className="field">
            <label>Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={3}
              maxLength={32}
              pattern="[a-zA-Z0-9._\-]+"
              required
            />
          </div>
          <div className="field">
            <label>Password (min. 6 characters)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>
          <div className="field">
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
        </div>
        <button className="btn" disabled={busy} type="submit">
          {busy ? 'Creating…' : 'Create user'}
        </button>
        {error && <div className="error">{error}</div>}
        {success && <div className="success">{success}</div>}
      </form>
    </div>
  );
}
