import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../api/client.js';
import StorageBar from '../components/StorageBar.jsx';
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
      : `Lifetime: never expires (drop link)`;
  }
  if (s.expires_at < 0) return 'Never expires';
  return `Expires: ${formatDate(s.expires_at)}`;
}

export default function AdminSharesPage() {
  const [shares, setShares] = useState([]);
  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const [sharesData, storageData] = await Promise.all([
        api.listAllShares(),
        api.getStorage(),
      ]);
      setShares(sharesData.shares);
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

  async function onDelete(s) {
    if (!confirm(`Delete share "${s.label || '(no label)'}" from ${s.owner_username} and all its files?`)) return;
    await api.adminDeleteShare(s.id);
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

  const totalFiles = shares.reduce((acc, s) => acc + s.file_count, 0);
  const totalBytes = shares.reduce((acc, s) => acc + Number(s.total_bytes), 0);

  return (
    <div className="container">
      <h1>All shares</h1>

      <div className="panel">
        <StorageBar stats={storage} />
      </div>

      <div className="panel">
        <div className="bar">
          <h2>Active shares ({shares.length})</h2>
          <span className="muted">
            Total: {totalFiles} file(s) · {formatBytes(totalBytes)}
          </span>
        </div>

        {loading && <p className="muted">Loading…</p>}
        {error && <div className="error">{error}</div>}
        {!loading && shares.length === 0 && <p className="muted">No active shares.</p>}

        <ul className="link-list">
          {shares.map((s) => (
            <li key={s.id} className="link-row">
              <div className="link-row-main stack-sm">
                <div className="text-bold">
                  {s.label || '(no label)'}
                  <span className="badge" style={{ marginLeft: 8 }}>{s.owner_username}</span>
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
                  {formatBytes(Number(s.total_bytes))} · {s.download_count ?? 0} download(s)
                </div>
              </div>
              <div className="link-row-actions">
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
