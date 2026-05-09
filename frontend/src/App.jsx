import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import AdminSharesPage from './pages/AdminSharesPage.jsx';
import SharesListPage from './pages/SharesListPage.jsx';
import ShareDetailPage from './pages/ShareDetailPage.jsx';
import SharePage from './pages/SharePage.jsx';
import { getSession, setSession } from './api/client.js';
import { useNavigate } from 'react-router-dom';

function RequireAuth({ children, role }) {
  const session = getSession();
  if (!session) return <Navigate to="/login" replace />;
  if (role && session.user.role !== role) return <Navigate to="/shares" replace />;
  return children;
}

function NavBar() {
  const session = getSession();
  const location = useLocation();
  const navigate = useNavigate();
  if (!session) return null;
  if (location.pathname.startsWith('/share/')) return null;

  function logout() {
    setSession(null);
    navigate('/login', { replace: true });
  }

  return (
    <nav className="navbar">
      <div className="nav-inner">
        <span className="nav-brand">Fileshare</span>
        <Link to="/shares" className={location.pathname.startsWith('/shares') ? 'active' : ''}>
          My shares
        </Link>
        {session.user.role === 'admin' && (
          <>
            <Link to="/all-shares" className={location.pathname.startsWith('/all-shares') ? 'active' : ''}>
              All shares
            </Link>
            <Link to="/users" className={location.pathname.startsWith('/users') ? 'active' : ''}>
              Users
            </Link>
          </>
        )}
        <span className="nav-spacer" />
        <span className="muted">{session.user.username} · {session.user.role}</span>
        <button className="btn ghost" onClick={logout}>Log out</button>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/users"
          element={
            <RequireAuth role="admin">
              <AdminUsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/all-shares"
          element={
            <RequireAuth role="admin">
              <AdminSharesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/shares"
          element={
            <RequireAuth>
              <SharesListPage />
            </RequireAuth>
          }
        />
        <Route
          path="/shares/:id"
          element={
            <RequireAuth>
              <ShareDetailPage />
            </RequireAuth>
          }
        />

        <Route path="/share/:token" element={<SharePage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function RootRedirect() {
  const session = getSession();
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to="/shares" replace />;
}
