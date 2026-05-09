import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../api/client.js';
import StorageBar from '../components/StorageBar.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { PencilIcon, TrashIcon } from '../components/Icons.jsx';

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function formatDate(ts) { return new Date(ts).toLocaleString(); }

// Unit-aware storage quota input/output. We persist bytes; the form lets the
// admin pick a unit so they don't have to count zeros.
function bytesToFormValue(bytes) {
  const n = Number(bytes || 0);
  if (n === 0) return { value: 0, unit: 'GB' };
  if (n % GIB === 0) return { value: n / GIB, unit: 'GB' };
  if (n % MIB === 0) return { value: n / MIB, unit: 'MB' };
  return { value: n, unit: 'B' };
}
function formValueToBytes(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return 0;
  if (unit === 'GB') return Math.floor(v * GIB);
  if (unit === 'MB') return Math.floor(v * MIB);
  return Math.floor(v);
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingPassword, setEditingPassword] = useState(null);
  const [editingLimits, setEditingLimits] = useState(null);
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
                  Created: {formatDate(u.created_at)} · {u.share_count} share(s) ·{' '}
                  {formatBytes(Number(u.used_bytes || 0))} used
                </div>
                <div className="muted">
                  Max lifetime:{' '}
                  {Number(u.max_lifetime_days) === 0 ? 'unlimited' : `${u.max_lifetime_days} day(s)`}
                  {' · '}
                  Max storage:{' '}
                  {Number(u.max_storage_bytes) === 0 ? 'shares system pool' : formatBytes(Number(u.max_storage_bytes))}
                </div>

                {editingLimits === u.id && (
                  <UserLimitsForm
                    user={u}
                    onDone={() => { setEditingLimits(null); load(); }}
                    onCancel={() => setEditingLimits(null)}
                  />
                )}
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
                  className="icon-btn"
                  aria-label="Edit limits"
                  title="Edit limits"
                  onClick={() => setEditingLimits(editingLimits === u.id ? null : u.id)}
                >
                  <PencilIcon />
                </button>
                <button
                  className="btn ghost"
                  onClick={() => setEditingPassword(editingPassword === u.id ? null : u.id)}
                >
                  Password
                </button>
                <button
                  className="icon-btn danger"
                  aria-label="Delete user"
                  title="Delete user"
                  onClick={() => onDelete(u)}
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function UserLimitsForm({ user, onDone, onCancel }) {
  const [days, setDays] = useState(String(user.max_lifetime_days));
  const initial = bytesToFormValue(user.max_storage_bytes);
  const [storageValue, setStorageValue] = useState(String(initial.value));
  const [storageUnit, setStorageUnit] = useState(initial.unit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.updateUser(user.id, {
        max_lifetime_days: Number(days),
        max_storage_bytes: formValueToBytes(storageValue, storageUnit),
      });
      onDone();
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
          <label>Max lifetime (days, 0 = unlimited)</label>
          <input
            type="number"
            min={0}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Max storage (0 = use system pool)</label>
          <div className="row" style={{ gap: 'var(--gap-sm)' }}>
            <input
              type="number"
              min={0}
              step="any"
              value={storageValue}
              onChange={(e) => setStorageValue(e.target.value)}
              required
              style={{ flex: '2 1 0' }}
            />
            <select
              value={storageUnit}
              onChange={(e) => setStorageUnit(e.target.value)}
              style={{ flex: '1 1 0' }}
            >
              <option value="GB">GB</option>
              <option value="MB">MB</option>
              <option value="B">B</option>
            </select>
          </div>
        </div>
      </div>
      <div className="btn-group">
        <button className="btn" disabled={busy} type="submit">
          {busy ? 'Saving…' : 'Save limits'}
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
      {error && <div className="error">{error}</div>}
    </form>
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
          <PasswordInput
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
  const [days, setDays] = useState('14');
  const [storageValue, setStorageValue] = useState('0');
  const [storageUnit, setStorageUnit] = useState('GB');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Switching role flips the default lifetime, but only if the admin hasn't
  // changed it from a known default.
  function onRoleChange(next) {
    if (next === 'admin' && (days === '14' || days === '')) setDays('0');
    if (next === 'user' && (days === '0' || days === '')) setDays('14');
    setRole(next);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api.createUser({
        username,
        password,
        role,
        max_lifetime_days: Number(days),
        max_storage_bytes: formValueToBytes(storageValue, storageUnit),
      });
      setSuccess(`User "${username}" created`);
      setUsername('');
      setPassword('');
      setRole('user');
      setDays('14');
      setStorageValue('0');
      setStorageUnit('GB');
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
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>
          <div className="field">
            <label>Role</label>
            <select value={role} onChange={(e) => onRoleChange(e.target.value)}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Max lifetime (days, 0 = unlimited)</label>
            <input
              type="number"
              min={0}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Max storage (0 = use system pool)</label>
            <div className="row" style={{ gap: 'var(--gap-sm)' }}>
              <input
                type="number"
                min={0}
                step="any"
                value={storageValue}
                onChange={(e) => setStorageValue(e.target.value)}
                required
                style={{ flex: '2 1 0' }}
              />
              <select
                value={storageUnit}
                onChange={(e) => setStorageUnit(e.target.value)}
                style={{ flex: '1 1 0' }}
              >
                <option value="GB">GB</option>
                <option value="MB">MB</option>
                <option value="B">B</option>
              </select>
            </div>
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
