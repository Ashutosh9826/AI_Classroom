import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService, classService } from '../services/api';
import useAuthStore from '../store/useAuthStore';
import TopNavBar from '../components/TopNavBar';
import Sidebar from '../components/Sidebar';

export default function DashboardPage() {
  const [classes, setClasses] = useState([]);
  const { user, setUser, logout } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [className, setClassName] = useState('');
  const [classSection, setClassSection] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [modalError, setModalError] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [openMenuClassId, setOpenMenuClassId] = useState(null);
  const [classActionLoadingId, setClassActionLoadingId] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    fetchClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  useEffect(() => {
    if (!actionMessage && !actionError) return undefined;
    const timer = setTimeout(() => {
      setActionMessage('');
      setActionError('');
    }, 3500);
    return () => clearTimeout(timer);
  }, [actionMessage, actionError]);

  const fetchClasses = async () => {
    try {
      setLoading(true);
      const data = await classService.getClasses({ archived: false });
      setClasses(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const resolveSessionUser = async () => {
    try {
      const me = await authService.getMe();
      if (!me) return null;

      if (!user || user.id !== me.id || user.role !== me.role) {
        setUser(me);
      }

      return me;
    } catch (err) {
      console.error('Failed to refresh current session user', err);
      logout();
      navigate('/login');
      return null;
    }
  };

  const handleCreateClass = async (e) => {
    e.preventDefault();
    setModalError('');
    setModalLoading(true);
    try {
      const me = await resolveSessionUser();
      if (!me) return;
      if (me.role !== 'TEACHER') {
        setModalError('Only teacher accounts can create classes. Please log in with a teacher account.');
        return;
      }

      await classService.createClass({ name: className, section: classSection });
      setShowCreateModal(false);
      setClassName('');
      setClassSection('');
      await fetchClasses();
    } catch (err) {
      setModalError(err.response?.data?.error || 'Failed to create class');
    } finally {
      setModalLoading(false);
    }
  };

  const handleJoinClass = async (e) => {
    e.preventDefault();
    setModalError('');
    setModalLoading(true);
    try {
      const me = await resolveSessionUser();
      if (!me) return;
      if (me.role === 'TEACHER') {
        setModalError('This account is a Teacher account. Use "Create Class" or log in with a student account to join classes.');
        return;
      }

      await classService.joinClass(joinCode);
      setShowJoinModal(false);
      setJoinCode('');
      await fetchClasses();
    } catch (err) {
      setModalError(err.response?.data?.error || 'Failed to join class');
    } finally {
      setModalLoading(false);
    }
  };

  const openActionModal = async () => {
    setModalError('');
    const me = await resolveSessionUser();
    if (!me) return;

    if (me.role === 'TEACHER') {
      setShowCreateModal(true);
    } else {
      setShowJoinModal(true);
    }
  };

  const openClassStream = (classId) => {
    setOpenMenuClassId(null);
    navigate(`/class/stream?classId=${classId}`);
  };

  const toggleClassMenu = (classId, event) => {
    event.stopPropagation();
    setOpenMenuClassId((prev) => (prev === classId ? null : classId));
  };

  const copyClassCode = async (cls, event) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(cls.class_code);
      setActionError('');
      setActionMessage(`Class code copied for "${cls.name}"`);
      setOpenMenuClassId(null);
    } catch (err) {
      console.error(err);
      setActionMessage('');
      setActionError('Could not copy class code. Please copy manually from the card.');
    }
  };

  const archiveClass = async (cls, event) => {
    event.stopPropagation();
    const confirmed = window.confirm(`Archive "${cls.name}"? Students and teacher can still view it from Archived Classes.`);
    if (!confirmed) return;

    try {
      setClassActionLoadingId(cls.id);
      setActionError('');
      await classService.archiveClass(cls.id);
      setActionMessage(`"${cls.name}" moved to Archived Classes.`);
      setOpenMenuClassId(null);
      await fetchClasses();
    } catch (err) {
      console.error(err);
      setActionMessage('');
      setActionError(err.response?.data?.error || 'Failed to archive class');
    } finally {
      setClassActionLoadingId(null);
    }
  };

  return (
    <div className="bg-surface text-on-surface font-body min-h-screen">
      <TopNavBar />
      
      <div className="flex min-h-screen pt-16">
        <Sidebar onJoinClass={openActionModal} />
        
        {/* Main Content Area */}
        <main className="flex-grow lg:ml-64 p-6 md:p-12 max-w-screen-2xl mx-auto" onClick={() => setOpenMenuClassId(null)}>
          <header className="mb-12 flex justify-between items-end">
            <div>
              <span className="text-blue-600 font-semibold uppercase tracking-widest text-xs mb-2 block">{user?.role === 'TEACHER' ? 'Teacher Workspace' : 'Student Workspace'}</span>
              <h1 className="text-5xl font-bold tracking-tight text-on-surface">Welcome, {user?.name?.split(' ')[0] || 'User'}</h1>
            </div>
            <div className="hidden sm:flex items-center gap-5">
              <button
                className="group flex items-center gap-2 text-primary font-medium hover:underline decoration-2 underline-offset-4 transition-all"
                type="button"
                onClick={() => navigate('/classwork')}
              >
                View All Tasks
                <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/archived')}
                className="group flex items-center gap-2 text-outline hover:text-on-surface font-medium transition-colors"
              >
                <span className="material-symbols-outlined text-base">archive</span>
                Archived Classes
              </button>
            </div>
          </header>

          {(actionMessage || actionError) && (
            <div
              className={`mb-6 rounded-xl border px-4 py-3 text-sm font-medium ${
                actionError
                  ? 'border-error/30 bg-error-container/40 text-error'
                  : 'border-secondary/30 bg-secondary/10 text-secondary'
              }`}
            >
              {actionError || actionMessage}
            </div>
          )}
          
          {/* Bento-style Grid of Classes */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
            {loading ? (
              <p>Loading classes...</p>
            ) : classes.length > 0 ? (
              classes.map((cls) => (
                <article key={cls.id} data-testid={`class-card-${cls.id}`} className="relative bg-surface-container-lowest rounded-xl overflow-hidden group hover:shadow-xl transition-all duration-300">
                  <div className="h-32 bg-slate-800 relative p-6 flex flex-col justify-between">
                    <div className="absolute inset-0 opacity-40">
                      <img alt="Class header" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCnZS7AKdtUOvj8_zwB4yiR1JEOA6BG8fgmolXIdyK2Qugb1P-99ewOJjGKQKHtZgPQ9d32wvEujL5f8jEARWGJIVO4lI0PjeDA2PKfRO4mfuE45P7MfHiKQ6ZunZelCv-OJFcHhnerPXqrC0EH0K7cOHl1tzA8sWOQ_ZpH-wHYq6BR_in0DK_qaAqNLgpvARR51jq_Lu_SINfcpyXJCLfuUAa1dlufu_WL8EgfF4XJn--5vpEb4DH_ZXu4u0Jv2ObLtgB2-cYAriA" />
                    </div>
                    <div className="relative z-10 flex justify-between items-start">
                      <Link to={`/class/stream?classId=${cls.id}`} data-testid={`class-card-link-${cls.id}`}>
                        <h3 className="text-xl font-bold text-white hover:underline cursor-pointer">{cls.name}</h3>
                        <p className="text-white/80 text-sm">{cls.section || 'General'}</p>
                      </Link>
                      <button
                        className="text-white hover:bg-white/20 p-1 rounded-full transition-colors"
                        type="button"
                        onClick={(event) => toggleClassMenu(cls.id, event)}
                        title="Class actions"
                      >
                        <span className="material-symbols-outlined">more_vert</span>
                      </button>
                    </div>
                    <div className="relative z-10">
                      <p className="text-white font-medium text-sm">
                        {user?.role === 'TEACHER' ? `${cls._count?.enrollments || 0} Students` : cls.teacher?.name}
                      </p>
                    </div>
                  </div>
                  {openMenuClassId === cls.id && (
                    <div
                      className="absolute right-4 top-16 z-30 w-48 rounded-xl border border-outline-variant/30 bg-white shadow-xl py-2"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => openClassStream(cls.id)}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-surface-container-low transition-colors"
                      >
                        Open class
                      </button>
                      {user?.role === 'TEACHER' && (
                        <>
                          <button
                            type="button"
                            onClick={(event) => copyClassCode(cls, event)}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-surface-container-low transition-colors"
                          >
                            Copy class code
                          </button>
                          <button
                            type="button"
                            onClick={(event) => archiveClass(cls, event)}
                            disabled={classActionLoadingId === cls.id}
                            className="w-full px-4 py-2 text-left text-sm text-tertiary hover:bg-tertiary/10 transition-colors disabled:opacity-60"
                          >
                            {classActionLoadingId === cls.id ? 'Archiving...' : 'Archive class'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  <div className="p-6 pt-10 flex flex-col gap-6">
                    <div className="space-y-4">
                      {user?.role === 'TEACHER' ? (
                        <div className="text-sm text-slate-500">Class Code: <span data-testid={`class-code-${cls.id}`} className="font-mono font-bold text-primary">{cls.class_code}</span></div>
                      ) : (
                        <p className="text-slate-400 text-sm italic">No upcoming assignments</p>
                      )}
                    </div>
                    <div className="flex justify-end border-t border-slate-100 pt-4">
                      <div className="flex gap-2">
                        <button
                          className="p-2 text-slate-400 hover:text-primary transition-colors"
                          type="button"
                          onClick={() => openClassStream(cls.id)}
                          title="Open class stream"
                        >
                          <span className="material-symbols-outlined">folder_open</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-6 text-sm text-outline">
                <p>No active classes yet.</p>
                <button
                  type="button"
                  className="mt-3 text-primary font-semibold hover:underline"
                  onClick={() => navigate('/archived')}
                >
                  Open archived classes
                </button>
              </div>
            )}

            {/* Add New Class Card */}
            <article
              data-testid="dashboard-add-class-card"
              onClick={openActionModal}
              className="border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center p-12 group hover:border-primary hover:bg-blue-50/30 transition-all cursor-pointer"
            >
              <div className="w-16 h-16 rounded-full bg-slate-100 text-slate-400 group-hover:bg-primary group-hover:text-white flex items-center justify-center mb-4 transition-all">
                <span className="material-symbols-outlined text-3xl">add</span>
              </div>
              <p className="font-bold text-slate-500 group-hover:text-primary">{user?.role === 'TEACHER' ? 'Create Class' : 'Join Class'}</p>
            </article>
          </div>
        </main>
      </div>
      
      {/* Floating Action Button (FAB) */}
      <button
        data-testid="dashboard-add-class-fab"
        onClick={openActionModal}
        className="lg:hidden fixed bottom-6 right-6 w-14 h-14 atelier-card-gradient text-white rounded-full shadow-2xl flex items-center justify-center active:scale-90 transition-transform z-50"
      >
        <span className="material-symbols-outlined text-2xl">add</span>
      </button>

      {/* Create Class Modal (Teacher) */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div data-testid="create-class-modal" className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-8 animate-in" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-on-surface mb-2">Create a Class</h2>
            <p className="text-sm text-on-surface-variant mb-6">A unique class code will be generated automatically.</p>
            {modalError && <div className="text-error text-sm mb-4 bg-error-container/30 p-3 rounded-lg">{modalError}</div>}
            <form onSubmit={handleCreateClass} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Class Name *</label>
                <input
                  data-testid="create-class-name-input"
                  type="text"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  required
                  placeholder="e.g., Advanced Physics"
                  className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface rounded-t-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Section (optional)</label>
                <input
                  data-testid="create-class-section-input"
                  type="text"
                  value={classSection}
                  onChange={(e) => setClassSection(e.target.value)}
                  placeholder="e.g., Section A"
                  className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface rounded-t-lg"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="flex-1 py-3 rounded-full border-2 border-outline/30 text-on-surface font-semibold hover:bg-surface-container-high transition-colors">Cancel</button>
                <button data-testid="create-class-submit" type="submit" disabled={modalLoading} className="flex-1 py-3 rounded-full signature-gradient text-white font-semibold shadow-lg hover:shadow-xl transition-all active:scale-95 disabled:opacity-50">
                  {modalLoading ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Class Modal (Student) */}
      {showJoinModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowJoinModal(false)}>
          <div data-testid="join-class-modal" className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-8 animate-in" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-on-surface mb-2">Join a Class</h2>
            <p className="text-sm text-on-surface-variant mb-6">Enter the class code provided by your teacher.</p>
            {modalError && <div className="text-error text-sm mb-4 bg-error-container/30 p-3 rounded-lg">{modalError}</div>}
            <form onSubmit={handleJoinClass} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Class Code *</label>
                <input
                  data-testid="join-class-code-input"
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  required
                  placeholder="e.g., ABC123"
                  className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface font-mono text-lg tracking-widest text-center rounded-t-lg"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowJoinModal(false)} className="flex-1 py-3 rounded-full border-2 border-outline/30 text-on-surface font-semibold hover:bg-surface-container-high transition-colors">Cancel</button>
                <button data-testid="join-class-submit" type="submit" disabled={modalLoading} className="flex-1 py-3 rounded-full signature-gradient text-white font-semibold shadow-lg hover:shadow-xl transition-all active:scale-95 disabled:opacity-50">
                  {modalLoading ? 'Joining...' : 'Join'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
