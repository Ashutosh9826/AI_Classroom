import React from 'react';
import { Link } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';
import useLayoutStore from '../store/useLayoutStore';

export default function Sidebar({ onJoinClass }) {
  const { user } = useAuthStore();
  const isDesktopSidebarExpanded = useLayoutStore((state) => state.isDesktopSidebarExpanded);
  const isMobileSidebarOpen = useLayoutStore((state) => state.isMobileSidebarOpen);
  const closeMobileSidebar = useLayoutStore((state) => state.closeMobileSidebar);

  const sidebarVisibilityClass = [
    isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
    isDesktopSidebarExpanded ? 'lg:translate-x-0' : 'lg:-translate-x-full',
  ].join(' ');

  const handleJoinClass = () => {
    closeMobileSidebar();
    onJoinClass?.();
  };

  return (
    <>
      {isMobileSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 top-16 z-30 bg-black/30 lg:hidden"
          aria-label="Close side menu"
          onClick={closeMobileSidebar}
        />
      )}

      <aside
        className={`fixed left-0 top-16 flex flex-col pt-4 pb-4 h-[calc(100vh-64px)] w-64 bg-surface-container-low font-['Inter'] text-sm font-medium z-40 transition-transform duration-300 ease-out ${sidebarVisibilityClass}`}
      >
        <div className="px-4 mb-4">
          <div className="flex items-center gap-3 px-2 py-3 border-b border-slate-200">
            <div className="w-10 h-10 atelier-card-gradient rounded-xl flex items-center justify-center text-white">
              <span className="material-symbols-outlined">school</span>
            </div>
            <div>
              <div className="text-lg font-bold text-on-surface leading-tight">Academic Atelier</div>
              <div className="text-xs text-on-surface-variant">Classroom</div>
            </div>
          </div>
        </div>
        <nav className="flex-grow space-y-1 pr-4">
          <Link to="/dashboard" onClick={closeMobileSidebar} className="flex items-center gap-4 bg-blue-50 text-blue-700 rounded-r-full px-4 py-3 ml-0 transition-all">
            <span className="material-symbols-outlined">home</span>
            <span>Home</span>
          </Link>
          <Link to="/calendar" onClick={closeMobileSidebar} className="flex items-center gap-4 text-slate-600 px-4 py-3 hover:bg-slate-100 rounded-r-full transition-all">
            <span className="material-symbols-outlined">calendar_today</span>
            <span>Calendar</span>
          </Link>
          <Link to="/dashboard" onClick={closeMobileSidebar} className="flex items-center gap-4 text-slate-600 px-4 py-3 hover:bg-slate-100 rounded-r-full transition-all">
            <span className="material-symbols-outlined">school</span>
            <span>Enrolled</span>
          </Link>
          <Link to="/archived" onClick={closeMobileSidebar} className="flex items-center gap-4 text-slate-600 px-4 py-3 hover:bg-slate-100 rounded-r-full transition-all">
            <span className="material-symbols-outlined">archive</span>
            <span>Archived</span>
          </Link>
          <Link to="/settings" onClick={closeMobileSidebar} className="flex items-center gap-4 text-slate-600 px-4 py-3 hover:bg-slate-100 rounded-r-full transition-all">
            <span className="material-symbols-outlined">settings</span>
            <span>Settings</span>
          </Link>
        </nav>

        <div className="mt-auto px-4 space-y-4">
          {onJoinClass && (
            <button onClick={handleJoinClass} className="w-full atelier-card-gradient text-white rounded-full py-3 px-6 font-semibold flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 active:scale-95 transition-transform">
              <span className="material-symbols-outlined">add</span>
              {user?.role === 'TEACHER' ? 'Create Class' : 'Join Class'}
            </button>
          )}
          <div className="pt-4 border-t border-slate-200">
            <Link to="/help" onClick={closeMobileSidebar} className="flex items-center gap-4 text-slate-500 px-4 py-2 hover:text-slate-900 text-xs">
              <span className="material-symbols-outlined text-sm">help</span>
              <span>Help</span>
            </Link>
            <Link to="/privacy" onClick={closeMobileSidebar} className="flex items-center gap-4 text-slate-500 px-4 py-2 hover:text-slate-900 text-xs">
              <span className="material-symbols-outlined text-sm">security</span>
              <span>Privacy</span>
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}
