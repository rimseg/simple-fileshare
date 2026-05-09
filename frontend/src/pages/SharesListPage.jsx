import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setSession } from '../api/client.js';
import StorageBar from '../components/StorageBar.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { CopyIcon, TrashIcon } from '../components/Icons.jsx';
import { useToast } from '../components/Toast.jsx';

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function formatDate(ts) { return new Date(ts).toLocaleString(); }
function shareUrl(token) { return `${window.location.origin}/share/${token}`; }
function expiresLabel(s) {
  if (s.allow_guest_upload && !s.started_at) {
    const d = Number(s.lifetime_days);
    return d > 0
      ? `Lifetime: ${d} day(s), starts after the first upload`
      : `Lifetime: never expires, timer-free drop link`;
  }
  if (s.expires_at < 0) return 'Never expires';
  return `Expires: ${formatDate(s.expires_at)}`;
}

export default function SharesListPage() {
  const [shares, setShares] = useState([]);
  const [storage, setStorage] = useState(null);
  const [maxDays, setMaxDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const [sharesData, storageData] = await Promise.all([
        api.listShares(),
        api.getStorage(),
      ]);
      setShares(sharesData.shares);
      setStorage(storageData);
      setMaxDays(sharesData.max_lifetime_days);
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

  async function onDelete(s) {
    if (!confirm('Delete this share and all its files?')) return;
    await api.deleteShare(s.id);
    load();
  }

  async function copyLink(token) {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      toast('Link copied to clipboard');
    } catch {
      toast('Could not copy link');
    }
  }

  return (
    <div className="container">
      <h1>My shares</h1>

      <div className="panel">
        <StorageBar stats={storage} />
      </div>

      <CreateShareForm maxDays={maxDays} onCreated={(id) => navigate(`/shares/${id}`)} />

      <div className="panel">
        <h2>Active shares</h2>
        {loading && <p className="muted">Loading…</p>}
        {error && <div className="error">{error}</div>}
        {!loading && shares.length === 0 && <p className="muted">No shares yet.</p>}
        <ul className="link-list">
          {shares.map((s) => (
            <li key={s.id} className="link-row">
              <div className="link-row-main stack-sm">
                <div className="text-bold">
                  <Link to={`/shares/${s.id}`}>{s.label || '(no label)'}</Link>
                  {s.allow_guest_upload ? (
                    <span className="badge" style={{ marginLeft: 8 }}>Drop</span>
                  ) : null}
                </div>
                <div className="copyable">
                  <span>{shareUrl(s.token)}</span>
                  <button
                    className="icon-btn"
                    aria-label="Copy link"
                    title="Copy link"
                    onClick={() => copyLink(s.token)}
                  >
                    <CopyIcon />
                  </button>
                </div>
                <div className="muted">
                  {expiresLabel(s)}
                  {' '}· {s.file_count} file(s) ·{' '}
                  {formatBytes(s.total_bytes)} · {s.download_count ?? 0} download(s)
                </div>
              </div>
              <div className="link-row-actions">
                <Link to={`/shares/${s.id}`} className="btn ghost">Edit</Link>
                <button
                  className="icon-btn danger"
                  aria-label="Delete share"
                  title="Delete share"
                  onClick={() => onDelete(s)}
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

function CreateShareForm({ maxDays, onCreated }) {
  const unlimited = Number(maxDays) === 0;
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [days, setDays] = useState(() => (unlimited ? 7 : Math.min(7, Number(maxDays) || 7)));
  const [allowGuestUpload, setAllowGuestUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const link = await api.createShare(label || null, password, Number(days), allowGuestUpload);
      setLabel('');
      setPassword('');
      setAllowGuestUpload(false);
      onCreated(link.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Create new share</h2>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Label (optional)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Project handover" />
        </div>
        <div className="row">
          <div className="field">
            <label>Password (required for access)</label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={4}
              placeholder="At least 4 characters"
            />
          </div>
          <div className="field">
            <label>
              Lifetime (days{unlimited ? ', 0 = never expires' : `, max. ${maxDays}`})
            </label>
            <input
              type="number"
              min={0}
              max={unlimited ? undefined : maxDays}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              required
            />
          </div>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={allowGuestUpload}
            onChange={(e) => setAllowGuestUpload(e.target.checked)}
          />
          <span>Drop mode: recipient may upload files</span>
        </label>
        {allowGuestUpload && (
          <p className="muted hint">
            The lifetime starts after the first file is uploaded. Recipients can keep
            adding files at any time until the share expires.
          </p>
        )}
        <button className="btn" disabled={busy} type="submit">
          {busy ? 'Creating…' : 'Create share & add files'}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
