import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { classService } from '../services/api';
import useAuthStore from '../store/useAuthStore';
import useLayoutStore from '../store/useLayoutStore';

const classTabClass = ({ isActive }) =>
  isActive
    ? 'inline-flex h-16 items-center border-b-[3px] border-blue-600 px-4 text-[15px] font-semibold text-blue-600 transition-colors'
    : 'inline-flex h-16 items-center border-b-[3px] border-transparent px-4 text-[15px] font-semibold text-slate-500 hover:text-slate-900 transition-colors';

export default function TopNavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const isDesktopSidebarExpanded = useLayoutStore((state) => state.isDesktopSidebarExpanded);
  const isMobileSidebarOpen = useLayoutStore((state) => state.isMobileSidebarOpen);
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [classInfo, setClassInfo] = useState(null);

  const initials = (user?.name || 'U')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase())
    .join('');

  const searchParams = new URLSearchParams(location.search);
  const classId = searchParams.get('classId');
  const isClassContext =
    Boolean(classId) &&
    (location.pathname === '/class/stream' ||
      location.pathname === '/classwork' ||
      location.pathname === '/class/materials' ||
      location.pathname === '/people' ||
      location.pathname === '/attendance' ||
      location.pathname === '/grades');

  const isTeacher = user?.role === 'TEACHER';

  useEffect(() => {
    let cancelled = false;

    const hydrateClassInfo = async () => {
      if (!isClassContext || !classId) {
        setClassInfo(null);
        return;
      }

      try {
        const details = await classService.getById(classId);
        if (!cancelled) {
          setClassInfo(details);
        }
      } catch (err) {
        console.error('Failed to load class info for top navigation', err);
        if (!cancelled) {
          setClassInfo(null);
        }
      }
    };

    hydrateClassInfo();

    return () => {
      cancelled = true;
    };
  }, [isClassContext, classId]);

  useEffect(() => {
    document.documentElement.classList.toggle('sidebar-collapsed', !isDesktopSidebarExpanded);
    return () => {
      document.documentElement.classList.remove('sidebar-collapsed');
    };
  }, [isDesktopSidebarExpanded]);

  const isMenuOpen = isDesktopSidebarExpanded || isMobileSidebarOpen;
  const getClassRoute = (path) => `${path}?classId=${encodeURIComponent(classId || '')}`;
  const classTabs = [
    { label: 'Stream', path: '/class/stream' },
    { label: 'Classwork', path: '/classwork' },
    { label: 'Class Material', path: '/class/materials' },
    { label: 'People', path: '/people' },
    { label: 'Attendance', path: '/attendance' },
    ...(isTeacher ? [{ label: 'Grades', path: '/grades' }] : []),
  ];

  return (
    <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-slate-100 shadow-sm">
      <div className="flex justify-between items-center px-6 h-16 w-full max-w-screen-2xl mx-auto">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={toggleSidebar}
            className="material-symbols-outlined text-on-surface-variant p-2 hover:bg-slate-50 rounded-full transition-colors"
            title={isMenuOpen ? 'Collapse menu' : 'Open menu'}
            aria-label={isMenuOpen ? 'Collapse side menu' : 'Open side menu'}
          >
            menu
          </button>
          {isClassContext && (
            <div className="hidden sm:flex items-center gap-2 min-w-0">
              <span className="text-lg font-medium text-on-surface">Classroom</span>
              <span className="text-3xl leading-none text-outline-variant">{'>'}</span>
              <span className="text-xl font-semibold text-on-surface truncate">
                {classInfo?.name || 'Classroom'}
              </span>
            </div>
          )}
        </div>

        {isClassContext && (
          <nav className="hidden md:flex items-stretch font-['Inter'] antialiased">
            {classTabs.map((tab) => (
              <NavLink key={tab.path} to={getClassRoute(tab.path)} className={classTabClass}>
                {tab.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="relative flex items-center gap-2">
          <button
            className="w-8 h-8 rounded-full overflow-hidden border border-outline-variant/30 bg-surface-container-low flex items-center justify-center"
            type="button"
            onClick={() => {
              setShowProfileMenu((prev) => !prev);
            }}
            title="Profile"
          >
            {user?.avatar_url ? (
              <img alt="User profile" className="w-full h-full object-cover" src={user.avatar_url} />
            ) : (
              <span className="text-[11px] font-bold text-primary">{initials}</span>
            )}
          </button>

          {showProfileMenu && (
            <div className="absolute right-0 top-12 w-72 bg-white rounded-2xl shadow-xl border border-slate-100 p-3 z-[70]">
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-sm font-bold text-on-surface">{user?.name || 'User'}</p>
                <p className="text-xs text-outline mt-0.5">{user?.email}</p>
              </div>
              <NavLink
                to="/settings"
                className="mt-2 block px-3 py-2 rounded-lg hover:bg-slate-50 text-sm"
                onClick={() => setShowProfileMenu(false)}
              >
                Manage your account
              </NavLink>
              <button
                type="button"
                onClick={() => {
                  setShowProfileMenu(false);
                  logout();
                  navigate('/login');
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 text-sm text-tertiary"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
