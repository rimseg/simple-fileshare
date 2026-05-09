const TOKEN_KEY = 'fileshare:session_token';
const USER_KEY = 'fileshare:session_user';

export function getSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  const user = localStorage.getItem(USER_KEY);
  if (!token || !user) return null;
  try { return { token, user: JSON.parse(user) }; } catch { return null; }
}

export function setSession(session) {
  if (session) {
    localStorage.setItem(TOKEN_KEY, session.token);
    localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
}

async function request(path, { method = 'GET', body, auth = true, headers } = {}) {
  const h = { ...(headers || {}) };
  if (body && !(body instanceof FormData)) h['Content-Type'] = 'application/json';
  if (typeof auth === 'string') {
    h['Authorization'] = `Bearer ${auth}`;
  } else if (auth) {
    const session = getSession();
    if (session) h['Authorization'] = `Bearer ${session.token}`;
  }

  const res = await fetch(path, {
    method,
    headers: h,
    body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', body: { username, password }, auth: false }),

  // admin
  listUsers: () => request('/api/admin/users'),
  createUser: (username, password, role) =>
    request('/api/admin/users', { method: 'POST', body: { username, password, role } }),
  deleteUser: (id) => request(`/api/admin/users/${id}`, { method: 'DELETE' }),
  setUserPassword: (id, password) =>
    request(`/api/admin/users/${id}/password`, { method: 'PUT', body: { password } }),
  listAllShares: () => request('/api/admin/shares'),
  adminDeleteShare: (id) => request(`/api/admin/shares/${id}`, { method: 'DELETE' }),

  // storage (any authenticated user)
  getStorage: () => request('/api/storage'),

  // me (any authenticated user)
  listShares: () => request('/api/me/shares'),
  createShare: (label, password, lifetime_days) =>
    request('/api/me/shares', {
      method: 'POST',
      body: { label, password, lifetime_days },
    }),
  getShare: (id) => request(`/api/me/shares/${id}`),
  deleteShare: (id) => request(`/api/me/shares/${id}`, { method: 'DELETE' }),
  setSharePassword: (id, password) =>
    request(`/api/me/shares/${id}/password`, { method: 'PUT', body: { password } }),
  deleteFile: (shareId, fileId) =>
    request(`/api/me/shares/${shareId}/files/${fileId}`, { method: 'DELETE' }),

  uploadFile: (shareId, file, relativePath, onProgress) =>
    new Promise((resolve, reject) => {
      const session = getSession();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/me/shares/${shareId}/files`);
      xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
      xhr.setRequestHeader('X-Relative-Path', encodeURIComponent(relativePath));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        let parsed = {};
        try { parsed = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(parsed);
        else reject(new Error(parsed.error || `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('network error'));
      const fd = new FormData();
      fd.append('file', file);
      xhr.send(fd);
    }),

  // public share (download flow)
  shareInfo: (token) => request(`/api/share/${token}/info`, { auth: false }),
  shareAuth: (token, password) =>
    request(`/api/share/${token}/auth`, { method: 'POST', body: { password }, auth: false }),
  shareFiles: (token, downloadToken) =>
    request(`/api/share/${token}/files`, { auth: downloadToken }),
  fileDownloadUrl: (token, fileId, downloadToken) =>
    `/api/share/${token}/files/${fileId}/download?t=${encodeURIComponent(downloadToken)}`,
  zipDownloadUrl: (token, downloadToken) =>
    `/api/share/${token}/zip?t=${encodeURIComponent(downloadToken)}`,
};
