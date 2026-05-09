import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import AdminSharesPage from './pages/AdminSharesPage.jsx';
import SharesListPage from './pages/SharesListPage.jsx';
import ShareDetailPage from './pages/ShareDetailPage.jsx';
import SharePage from './pages/SharePage.jsx';
import { getSession, setSession } from './api/client.js';
import { useTheme } from './components/ThemeProvider.jsx';
import { BrandIcon, LogoutIcon, MoonIcon, SunIcon } from './components/Icons.jsx';

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
  const { theme, toggle } = useTheme();
  if (!session) return null;
  if (location.pathname.startsWith('/share/')) return null;

  function logout() {
    setSession(null);
    navigate('/login', { replace: true });
  }

  return (
    <nav className="navbar">
      <div className="nav-inner">
        <Link to="/shares" className="nav-brand" aria-label="Home">
          <BrandIcon size={26} />
        </Link>
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
        <span className="nav-greeting">Hi {session.user.username}</span>
        <button
          className="icon-btn"
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          className="icon-btn"
          onClick={logout}
          aria-label="Log out"
          title="Log out"
        >
          <LogoutIcon />
        </button>
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
