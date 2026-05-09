function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export default function StorageBar({ stats }) {
  if (!stats) return null;

  const pct = stats.max_bytes > 0 ? stats.used_bytes / stats.max_bytes : 0;
  const pctRound = Math.min(100, Math.max(0, Math.round(pct * 100)));
  const tone = pct >= 0.9 ? 'danger' : pct >= 0.7 ? 'warn' : 'ok';

  return (
    <div className="storage-bar">
      <div className="storage-bar-header">
        <span className="text-bold">Storage</span>
        <span className="muted">
          Available: <span className="text-bold" style={{ color: 'var(--text)' }}>
            {formatBytes(stats.available_bytes)}
          </span> of {formatBytes(stats.max_bytes)}
        </span>
      </div>
      <div className="storage-bar-track">
        <div className={`storage-bar-fill ${tone}`} style={{ width: `${pctRound}%` }} />
      </div>
      <div className="muted" style={{ fontSize: '0.8rem' }}>
        {formatBytes(stats.used_bytes)} used ({pctRound}%)
      </div>
    </div>
  );
}
