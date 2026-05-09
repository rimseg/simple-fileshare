import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import PasswordInput from '../components/PasswordInput.jsx';
import { DownloadIcon, PlusIcon } from '../components/Icons.jsx';

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export default function SharePage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [downloadToken, setDownloadToken] = useState(null);
  const [files, setFiles] = useState([]);
  const [canUpload, setCanUpload] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.shareInfo(token)
      .then(setInfo)
      .catch((err) => setLoadError(err.message));
  }, [token]);

  async function refreshFiles(tok) {
    const filesRes = await api.shareFiles(token, tok);
    setFiles(filesRes.files);
    setCanUpload(!!filesRes.can_upload);
    // Pick up freshly-set expires_at after the first upload triggers the timer.
    setInfo((prev) => ({ ...prev, expires_at: filesRes.expires_at, started: filesRes.started }));
  }

  async function onAuth(e) {
    e.preventDefault();
    setAuthError('');
    setBusy(true);
    try {
      const res = await api.shareAuth(token, password);
      setDownloadToken(res.download_token);
      await refreshFiles(res.download_token);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="container narrow">
        <div className="panel">
          <h1>Link unavailable</h1>
          <p className="muted">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return <div className="container"><p className="muted">Loading…</p></div>;
  }

  if (!downloadToken) {
    const dropLink = info.allow_guest_upload && !info.started;
    return (
      <div className="container narrow">
        <div className="panel">
          <h1>{info.label || 'Shared files'}</h1>
          {dropLink ? (
            <p className="muted">
              This is a drop link. Enter the password to upload files. The lifetime starts
              after the first file is uploaded.
            </p>
          ) : info.expires_at < 0 ? (
            <p className="muted">Never expires</p>
          ) : (
            <p className="muted">Valid until: {new Date(info.expires_at).toLocaleString()}</p>
          )}
          <form onSubmit={onAuth}>
            <div className="field">
              <label>Password</label>
              <PasswordInput
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button className="btn" disabled={busy} type="submit">
              {busy ? 'Checking…' : 'Unlock'}
            </button>
            {authError && <div className="error">{authError}</div>}
          </form>
        </div>
      </div>
    );
  }

  const totalBytes = files.reduce((acc, f) => acc + f.size_bytes, 0);
  const timerNotStarted = canUpload && !info.started;

  return (
    <div className="container">
      <div className="panel">
        <h1>{info.label || 'Shared files'}</h1>
        {timerNotStarted ? (
          <p className="muted">
            Drop link · lifetime: {info.lifetime_days} day(s), starts after the first upload
          </p>
        ) : info.expires_at < 0 ? (
          <p className="muted">
            Never expires · {files.length} file(s) · {formatBytes(totalBytes)}
          </p>
        ) : (
          <p className="muted">
            Valid until: {new Date(info.expires_at).toLocaleString()} ·{' '}
            {files.length} file(s) · {formatBytes(totalBytes)}
          </p>
        )}

        {files.length > 0 ? (
          <>
            <div className="bar">
              <h3 style={{ margin: 0 }}>Uploaded files ({files.length})</h3>
              <a
                className="btn"
                href={api.zipDownloadUrl(token, downloadToken)}
                title="Download all as ZIP"
              >
                <DownloadIcon /> <span style={{ marginLeft: 6 }}>ZIP</span>
              </a>
            </div>
            <ul className="upload-list unbounded">
              {files.map((f) => (
                <li key={f.id}>
                  <span className="file-name">{f.relative_path}</span>
                  <span className="file-meta">{formatBytes(f.size_bytes)}</span>
                  <a
                    className="icon-btn primary"
                    href={api.fileDownloadUrl(token, f.id, downloadToken)}
                    aria-label={`Download ${f.relative_path}`}
                    title="Download"
                  >
                    <DownloadIcon />
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : (
          !canUpload && (
            <p className="muted">No files have been uploaded to this share yet.</p>
          )
        )}
      </div>

      {canUpload && (
        <div className="panel">
          <h2 className="heading-with-icon"><PlusIcon /> Add files</h2>
          <GuestUploader
            token={token}
            downloadToken={downloadToken}
            onUploaded={() => refreshFiles(downloadToken)}
          />
        </div>
      )}
    </div>
  );
}

function GuestUploader({ token, downloadToken, onUploaded }) {
  const [pending, setPending] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

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
        await api.guestUploadFile(token, downloadToken, item.file, item.relativePath, (p) => {
          setPending((prev) => prev.map((x) => (x.id === item.id ? { ...x, progress: p } : x)));
        });
        setPending((prev) => prev.map((x) => (x.id === item.id ? { ...x, status: 'done', progress: 1 } : x)));
      } catch (err) {
        setPending((prev) => prev.map((x) => (x.id === item.id ? { ...x, status: 'error', error: err.message } : x)));
      }
    }
    onUploaded();
  }

  const pendingCount = pending.filter((p) => p.status === 'pending').length;
  const uploadingCount = pending.filter((p) => p.status === 'uploading').length;

  return (
    <>
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
          <h3>Upload progress</h3>
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
    </>
  );
}
