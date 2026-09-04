import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserAvatar } from './UserAvatar';

const NAV_ICONS: Record<string, string> = { tournaments: '🏆', admin: '⚙️', users: '👥' };

export function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navTabs = [
    { to: '/tournaments', key: 'tournaments', label: 'Tournaments' },
    ...(user && (user.role === 'admin' || user.role === 'organizer')
      ? [{ to: '/admin', key: 'admin', label: 'Admin' }]
      : []),
    ...(user && user.role === 'admin' ? [{ to: '/admin/users', key: 'users', label: 'Users' }] : []),
  ];

  return (
    <header className="app-header">
      <div className="header-top-row">
        <NavLink to="/" className="header-brand">
          <span className="header-brand-icon">🥒</span>
          <span className="header-brand-text">AZTS Pickleball</span>
        </NavLink>

        {user ? (
          <div className="header-user-chip">
            <UserAvatar name={user.name} size={34} />
            <div className="header-user-meta">
              <div className="header-user-name">{user.name}</div>
              <span className={`role-badge role-badge--${user.role}`}>{user.role}</span>
            </div>
            <button
              className="header-logout-btn"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              Logout
            </button>
          </div>
        ) : (
          <div className="header-auth-links">
            <NavLink to="/login">Log in</NavLink>
            <NavLink to="/register" className="button">
              Sign up
            </NavLink>
          </div>
        )}
      </div>

      {navTabs.length > 0 && (
        <nav className={`app-nav${mobileNavOpen ? ' mobile-open' : ''}`}>
          <button
            type="button"
            className="mobile-nav-toggle"
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-expanded={mobileNavOpen}
          >
            <span>Menu</span>
            <span>{mobileNavOpen ? '▲' : '▼'}</span>
          </button>
          <div className={`nav-tab-list${mobileNavOpen ? ' is-open' : ''}`}>
            {navTabs.map((tab) => (
              <NavLink
                key={tab.key}
                to={tab.to}
                end={tab.key === 'admin'}
                className={({ isActive }) => `nav-tab-btn${isActive ? ' active' : ''}`}
                onClick={() => setMobileNavOpen(false)}
              >
                {NAV_ICONS[tab.key]} {tab.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
