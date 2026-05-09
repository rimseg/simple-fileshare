import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, setSession } from '../api/client.js';

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function formatDate(ts) { return new Date(ts).toLocaleString(); }
function shareUrl(token) { return `${window.location.origin}/share/${token}`; }

export default function ShareDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [share, setShare] = useState(null);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  async function load() {
    try {
      const data = await api.getShare(id);
      setShare(data.share);
      setFiles(data.files);
    } catch (err) {
      if (err.status === 401) {
        setSession(null);
        navigate('/login', { replace: true });
      } else setError(err.message);
    }
  }

  useEffect(() => { load(); /* eslint-disable-line */ }, [id]);

  async function readEntry(entry, prefix = '') {
    if (entry.isFile) {
      return new Promise((resolve, reject) => {
        entry.file(
          (file) => resolve([{ file, relativePath: prefix + file.name }]),
          reject
        );
      });
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      const readBatch = () =>
        new Promise((resolve, reject) => {
          reader.readEntries(async (entries) => {
            if (entries.length === 0) return resolve();
            for (const ent of entries) {
              const sub = await readEntry(ent, prefix + entry.name + '/');
              all.push(...sub);
            }
            readBatch().then(resolve, reject);
          }, reject);
        });
      await readBatch();
      return all;
    }
    return [];
  }

  function addPending(items) {
    setPending((prev) => [
      ...prev,
      ...items.map((it) => ({
        id: crypto.randomUUID(),
        file: it.file,
        relativePath: it.relativePath,
        status: 'pending',
        progress: 0,
        error: null,
      })),
    ]);
  }

  function onPickFiles(e) {
    addPending([...e.target.files].map((f) => ({ file: f, relativePath: f.name })));
    e.target.value = '';
  }
  function onPickFolder(e) {
    addPending([...e.target.files].map((f) => ({ file: f, relativePath: f.webkitRelativePath || f.name })));
    e.target.value = '';
  }
  async function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const dt = e.dataTransfer;
    const collected = [];
    if (dt.items && dt.items.length) {
      for (const item of dt.items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          const sub = await readEntry(entry);
          collected.push(...sub);
        } else if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) collected.push({ file: f, relativePath: f.name });
        }
      }
    } else {
      for (const f of dt.files) collected.push({ file: f, relativePath: f.name });
    }
    if (collected.length) addPending(collected);
  }

  async function startUpload() {
    for (const item of pending) {
      if (item.status !== 'pending') continue;
      setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'uploading' } : p)));
      try {
        await api.uploadFile(id, item.file, item.relativePath, (p) => {
          setPending((prev) => prev.map((x) => (x.id === item.id ? { ...x, progress: p } : x)));
        });
        setPending((prev) => prev.map((x) => (x.id === item.id ? { ...x, status: 'done', progress: 1 } : x)));
      } catch (err) {
        setPending((prev) => prev.map((x) => (x.id === item.id ? { ...x, status: 'error', error: err.message } : x)));
      }
    }
    load();
  }

  async function removeFile(fileId) {
    if (!confirm('Remove this file from the share?')) return;
    await api.deleteFile(id, fileId);
    load();
  }

  if (error) {
    return (
      <div className="container"><div className="panel"><div className="error">{error}</div>
        <Link to="/shares">Back</Link>
      </div></div>
    );
  }
  if (!share) return <div className="container"><p className="muted">Loading…</p></div>;

  const pendingCount = pending.filter((p) => p.status === 'pending').length;
  const uploadingCount = pending.filter((p) => p.status === 'uploading').length;

  return (
    <div className="container">
      <div className="topbar">
        <h1>{share.label || '(no label)'}</h1>
        <Link to="/shares" className="btn ghost">← Back</Link>
      </div>

      <div className="panel">
        <h2>Share link</h2>
        <div className="copyable">
          <span>{shareUrl(share.token)}</span>
          <button
            className="btn ghost"
            onClick={() => navigator.clipboard.writeText(shareUrl(share.token))}
          >
            Copy
          </button>
        </div>
        <div className="muted">
          Expires: {formatDate(share.expires_at)}
        </div>
        <SharePasswordSection shareId={share.id} />
      </div>

      <div className="panel">
        <h2>Add files</h2>
        <div
          className={`dropzone ${dragOver ? 'active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          Drop files or folders here<br />
          <span className="muted">or</span>
          <div className="dropzone-buttons">
            <button className="btn ghost" type="button" onClick={() => fileInputRef.current?.click()}>
              Choose files
            </button>
            <button className="btn ghost" type="button" onClick={() => folderInputRef.current?.click()}>
              Choose folder
            </button>
          </div>
          <input ref={fileInputRef} type="file" multiple hidden onChange={onPickFiles} />
          <input ref={folderInputRef} type="file" multiple hidden webkitdirectory="" directory="" onChange={onPickFolder} />
        </div>

        {pending.length > 0 && (
          <>
            <div className="bar">
              <span className="muted">{pending.length} file(s) selected</span>
              <button
                className="btn"
                disabled={pendingCount === 0 || uploadingCount > 0}
                onClick={startUpload}
              >
                {uploadingCount > 0 ? 'Uploading…' : `Start upload (${pendingCount})`}
              </button>
            </div>
            <ul className="upload-list">
              {pending.map((it) => (
                <li key={it.id}>
                  <span className="file-name">{it.relativePath}</span>
                  <span className={`status-${it.status} file-meta`}>
                    {it.status === 'pending' && formatBytes(it.file.size)}
                    {it.status === 'uploading' && `${Math.round(it.progress * 100)}%`}
                    {it.status === 'done' && '✓'}
                    {it.status === 'error' && (it.error || 'Error')}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Uploaded files ({files.length})</h2>
        {files.length === 0 ? (
          <p className="muted">No files uploaded yet.</p>
        ) : (
          <ul className="upload-list unbounded">
            {files.map((f) => (
              <li key={f.id}>
                <span className="file-name">{f.relative_path}</span>
                <span className="file-meta">{formatBytes(f.size_bytes)}</span>
                <button className="btn danger" onClick={() => removeFile(f.id)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SharePasswordSection({ shareId }) {
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function reset() {
    setPassword('');
    setError('');
    setSuccess('');
  }

  function cancel() {
    reset();
    setEditing(false);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api.setSharePassword(shareId, password);
      setSuccess('Password updated');
      setPassword('');
      setTimeout(() => { setSuccess(''); setEditing(false); }, 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div>
        <button className="btn ghost" onClick={() => setEditing(true)}>
          Change password
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="stack-sm">
      <div className="field">
        <label>New password (min. 4 characters)</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={4}
          required
          autoFocus
        />
      </div>
      <div className="btn-group">
        <button className="btn" disabled={busy} type="submit">
          {busy ? 'Saving…' : 'Save password'}
        </button>
        <button className="btn ghost" type="button" onClick={cancel}>Cancel</button>
      </div>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
    </form>
  );
}
