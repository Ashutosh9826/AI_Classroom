import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TopNavBar from '../components/TopNavBar';
import Sidebar from '../components/Sidebar';
import useAuthStore from '../store/useAuthStore';
import { classService } from '../services/api';

const formatArchivedDate = (value) => {
  if (!value) return 'Archived';
  return `Archived ${new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
};

export default function ArchivedClassesPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [restoreLoadingId, setRestoreLoadingId] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchArchivedClasses();
  }, [user, navigate]);

  const fetchArchivedClasses = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await classService.getClasses({ archived: true });
      setClasses(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load archived classes');
    } finally {
      setLoading(false);
    }
  };

  const handleUnarchive = async (cls) => {
    const confirmed = window.confirm(`Restore "${cls.name}" to active classes?`);
    if (!confirmed) return;

    try {
      setRestoreLoadingId(cls.id);
      setError('');
      await classService.unarchiveClass(cls.id);
      setMessage(`"${cls.name}" restored to active classes.`);
      await fetchArchivedClasses();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to restore class');
    } finally {
      setRestoreLoadingId(null);
    }
  };

  return (
    <div className="bg-background text-on-surface min-h-screen">
      <TopNavBar />
      <div className="flex pt-16">
        <Sidebar />
        <main className="w-full lg:pl-64 px-6 py-8">
          <div className="max-w-6xl mx-auto">
            <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-outline">Classroom</p>
                <h1 className="text-4xl font-bold tracking-tight mt-2">Archived Classes</h1>
                <p className="text-sm text-outline mt-2">Classes moved here are removed from your active dashboard.</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="px-4 py-2 rounded-full signature-gradient text-white font-semibold"
              >
                Back to Active Classes
              </button>
            </header>

            {message && <p className="mb-4 text-sm text-secondary font-semibold">{message}</p>}
            {loading && <p className="text-outline">Loading archived classes...</p>}
            {error && <p className="text-error">{error}</p>}

            {!loading && !error && classes.length === 0 && (
              <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-8 text-center">
                <span className="material-symbols-outlined text-4xl text-outline">inventory_2</span>
                <p className="text-outline mt-3">No archived classes.</p>
              </section>
            )}

            {!loading && !error && classes.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {classes.map((cls) => (
                  <article key={cls.id} className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
                    <div className="h-28 bg-slate-700 relative p-5">
                      <div className="absolute inset-0 opacity-30">
                        <img
                          alt="Class banner"
                          className="w-full h-full object-cover"
                          src="https://lh3.googleusercontent.com/aida-public/AB6AXuCnZS7AKdtUOvj8_zwB4yiR1JEOA6BG8fgmolXIdyK2Qugb1P-99ewOJjGKQKHtZgPQ9d32wvEujL5f8jEARWGJIVO4lI0PjeDA2PKfRO4mfuE45P7MfHiKQ6ZunZelCv-OJFcHhnerPXqrC0EH0K7cOHl1tzA8sWOQ_ZpH-wHYq6BR_in0DK_qaAqNLgpvARR51jq_Lu_SINfcpyXJCLfuUAa1dlufu_WL8EgfF4XJn--5vpEb4DH_ZXu4u0Jv2ObLtgB2-cYAriA"
                        />
                      </div>
                      <div className="relative z-10">
                        <h2 className="text-lg font-bold text-white">{cls.name}</h2>
                        <p className="text-sm text-white/80">{cls.section || 'General'}</p>
                      </div>
                    </div>
                    <div className="p-5 space-y-4">
                      <p className="text-xs font-semibold uppercase tracking-widest text-outline">{formatArchivedDate(cls.archived_at)}</p>
                      <p className="text-sm text-outline">
                        {user?.role === 'TEACHER'
                          ? `${cls._count?.enrollments || 0} students`
                          : `Teacher: ${cls.teacher?.name || 'Unknown'}`}
                      </p>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/20">
                        <Link
                          to={`/class/stream?classId=${cls.id}`}
                          className="text-sm font-semibold text-primary hover:underline"
                        >
                          Open class
                        </Link>
                        {user?.role === 'TEACHER' && (
                          <button
                            type="button"
                            onClick={() => handleUnarchive(cls)}
                            disabled={restoreLoadingId === cls.id}
                            className="px-3 py-1.5 rounded-full border border-secondary/30 text-secondary text-xs font-bold uppercase tracking-wider hover:bg-secondary/10 disabled:opacity-60"
                          >
                            {restoreLoadingId === cls.id ? 'Restoring...' : 'Restore'}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
