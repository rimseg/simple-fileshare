import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';

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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.shareInfo(token)
      .then(setInfo)
      .catch((err) => setLoadError(err.message));
  }, [token]);

  async function onAuth(e) {
    e.preventDefault();
    setAuthError('');
    setBusy(true);
    try {
      const res = await api.shareAuth(token, password);
      const filesRes = await api.shareFiles(token, res.download_token);
      setFiles(filesRes.files);
      setDownloadToken(res.download_token);
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
    return (
      <div className="container narrow">
        <div className="panel">
          <h1>{info.label || 'Shared files'}</h1>
          <p className="muted">Valid until: {new Date(info.expires_at).toLocaleString()}</p>
          <form onSubmit={onAuth}>
            <div className="field">
              <label>Password</label>
              <input
                autoFocus
                type="password"
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

  return (
    <div className="container">
      <div className="panel">
        <h1>{info.label || 'Shared files'}</h1>
        <p className="muted">
          Valid until: {new Date(info.expires_at).toLocaleString()} ·{' '}
          {files.length} file(s) · {formatBytes(totalBytes)}
        </p>

        {files.length === 0 ? (
          <p className="muted">No files have been uploaded to this share yet.</p>
        ) : (
          <>
            <div>
              <a className="btn" href={api.zipDownloadUrl(token, downloadToken)}>
                Download all as ZIP
              </a>
            </div>
            <ul className="upload-list unbounded">
              {files.map((f) => (
                <li key={f.id}>
                  <span className="file-name">{f.relative_path}</span>
                  <span className="file-meta">{formatBytes(f.size_bytes)}</span>
                  <a className="btn ghost" href={api.fileDownloadUrl(token, f.id, downloadToken)}>
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
