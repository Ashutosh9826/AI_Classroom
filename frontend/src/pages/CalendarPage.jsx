import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TopNavBar from '../components/TopNavBar';
import Sidebar from '../components/Sidebar';
import useAuthStore from '../store/useAuthStore';
import { assignmentService, classService } from '../services/api';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const VIEW_MODES = {
  MONTH: 'MONTH',
  WEEK: 'WEEK',
};

const CLASS_COLOR_PALETTE = [
  {
    dot: 'bg-blue-500',
    chip: 'bg-blue-50 text-blue-700',
    cardAccent: 'border-l-blue-500',
    softRow: 'hover:bg-blue-50',
  },
  {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700',
    cardAccent: 'border-l-emerald-500',
    softRow: 'hover:bg-emerald-50',
  },
  {
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-700',
    cardAccent: 'border-l-amber-500',
    softRow: 'hover:bg-amber-50',
  },
  {
    dot: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-700',
    cardAccent: 'border-l-rose-500',
    softRow: 'hover:bg-rose-50',
  },
  {
    dot: 'bg-violet-500',
    chip: 'bg-violet-50 text-violet-700',
    cardAccent: 'border-l-violet-500',
    softRow: 'hover:bg-violet-50',
  },
  {
    dot: 'bg-cyan-500',
    chip: 'bg-cyan-50 text-cyan-700',
    cardAccent: 'border-l-cyan-500',
    softRow: 'hover:bg-cyan-50',
  },
];

const DEFAULT_CLASS_COLOR = {
  dot: 'bg-slate-500',
  chip: 'bg-slate-100 text-slate-700',
  cardAccent: 'border-l-slate-500',
  softRow: 'hover:bg-slate-100',
};

const toDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const getMonthGridStart = (monthDate) => {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const mondayIndex = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayIndex);
  return start;
};

const getWeekGridStart = (date) => {
  const day = new Date(date);
  const mondayIndex = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - mondayIndex);
  day.setHours(0, 0, 0, 0);
  return day;
};

const getTaskStatus = (task, role, now) => {
  const due = new Date(task.due_date);
  if (role === 'STUDENT') {
    if (task.completed) {
      return { label: 'Completed', className: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
    }
    if (due < now) {
      return { label: 'Overdue', className: 'text-rose-700 bg-rose-50 border-rose-200' };
    }
    if (isSameDay(due, now)) {
      return { label: 'Due today', className: 'text-amber-700 bg-amber-50 border-amber-200' };
    }
    return { label: 'Upcoming', className: 'text-blue-700 bg-blue-50 border-blue-200' };
  }

  if (due < now) {
    return { label: 'Past due', className: 'text-slate-700 bg-slate-100 border-slate-200' };
  }
  if (isSameDay(due, now)) {
    return { label: 'Due today', className: 'text-amber-700 bg-amber-50 border-amber-200' };
  }
  return { label: 'Scheduled', className: 'text-blue-700 bg-blue-50 border-blue-200' };
};

export default function CalendarPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [classFilter, setClassFilter] = useState('ALL');
  const [classes, setClasses] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [viewMode, setViewMode] = useState(VIEW_MODES.MONTH);
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchCalendarData();
  }, [user, navigate]);

  const fetchCalendarData = async () => {
    try {
      setLoading(true);
      setError('');
      const clsData = await classService.getClasses();
      setClasses(clsData);

      const bundles = await Promise.all(
        clsData.map(async (cls) => {
          const assignments = await assignmentService.getByClass(cls.id);
          return { cls, assignments };
        })
      );

      const flattened = [];
      bundles.forEach(({ cls, assignments }) => {
        assignments.forEach((a) => {
          flattened.push({
            ...a,
            className: cls.name,
            classId: String(cls.id),
          });
        });
      });

      setTasks(flattened);
    } catch (err) {
      console.error(err);
      setError('Failed to load calendar data');
    } finally {
      setLoading(false);
    }
  };

  const dueTasks = useMemo(() => tasks.filter((t) => t.due_date), [tasks]);

  const filteredTasks = useMemo(() => {
    if (classFilter === 'ALL') return dueTasks;
    return dueTasks.filter((t) => t.classId === classFilter);
  }, [dueTasks, classFilter]);

  const classColors = useMemo(() => {
    const map = new Map();
    classes.forEach((cls, index) => {
      map.set(String(cls.id), CLASS_COLOR_PALETTE[index % CLASS_COLOR_PALETTE.length]);
    });
    return map;
  }, [classes]);

  const getClassColor = (classId) => classColors.get(String(classId)) || DEFAULT_CLASS_COLOR;

  const tasksByDate = useMemo(() => {
    const map = new Map();
    filteredTasks.forEach((task) => {
      const key = toDateKey(new Date(task.due_date));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(task);
    });

    map.forEach((list) => {
      list.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    });

    return map;
  }, [filteredTasks]);

  const monthCells = useMemo(() => {
    const start = getMonthGridStart(monthDate);
    return Array.from({ length: 42 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return day;
    });
  }, [monthDate]);

  const weekCells = useMemo(() => {
    const start = getWeekGridStart(selectedDate);
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return day;
    });
  }, [selectedDate]);

  const selectedDayTasks = useMemo(() => {
    const key = toDateKey(selectedDate);
    return tasksByDate.get(key) || [];
  }, [selectedDate, tasksByDate]);

  const upcomingTasks = useMemo(() => {
    const now = new Date();
    return filteredTasks
      .filter((t) => {
        const due = new Date(t.due_date);
        if (user?.role === 'STUDENT' && t.completed) return false;
        return due >= now;
      })
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      .slice(0, 8);
  }, [filteredTasks, user?.role]);

  const completedTasks = useMemo(() => {
    if (user?.role !== 'STUDENT') return [];
    return filteredTasks
      .filter((t) => t.completed)
      .sort((a, b) => new Date(b.due_date) - new Date(a.due_date))
      .slice(0, 6);
  }, [filteredTasks, user]);

  const goToToday = () => {
    const today = new Date();
    setSelectedDate(today);
    setMonthDate(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  const movePeriod = (offset) => {
    if (viewMode === VIEW_MODES.MONTH) {
      setMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
      return;
    }

    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + offset * 7);
      return next;
    });
  };

  useEffect(() => {
    if (viewMode === VIEW_MODES.MONTH) {
      setMonthDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    }
  }, [selectedDate, viewMode]);

  const formatMonthTitle = (date) =>
    date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const formatWeekTitle = (date) => {
    const start = getWeekGridStart(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const isSameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    if (isSameMonth) {
      return `${start.toLocaleDateString('en-US', { month: 'long' })} ${start.getDate()}-${end.getDate()}, ${start.getFullYear()}`;
    }

    const isSameYear = start.getFullYear() === end.getFullYear();
    if (isSameYear) {
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`;
    }

    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`;
  };

  const formatDueText = (value) =>
    new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const renderNow = new Date();

  return (
    <div className="bg-background text-on-surface min-h-screen">
      <TopNavBar />
      <div className="flex pt-16">
        <Sidebar />
        <main className="w-full lg:pl-64 px-6 py-8">
          <div className="max-w-[1200px] mx-auto">
            <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-outline">Calendar</p>
                <h1 className="text-4xl font-bold tracking-tight mt-2">Classroom Planner</h1>
                <p className="text-sm text-outline mt-2">Track due dates and stay ahead of classwork.</p>
              </div>

              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-full border border-outline-variant/50 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setViewMode(VIEW_MODES.MONTH)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold tracking-wide transition-colors ${
                      viewMode === VIEW_MODES.MONTH ? 'bg-primary text-white' : 'text-outline hover:bg-surface-container-low'
                    }`}
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode(VIEW_MODES.WEEK)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold tracking-wide transition-colors ${
                      viewMode === VIEW_MODES.WEEK ? 'bg-primary text-white' : 'text-outline hover:bg-surface-container-low'
                    }`}
                  >
                    Week
                  </button>
                </div>
                <select
                  className="bg-white border border-outline-variant/50 rounded-full px-4 py-2 text-sm outline-none focus:border-primary"
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                >
                  <option value="ALL">All classes</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={String(cls.id)}>
                      {cls.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={goToToday}
                  className="px-4 py-2 rounded-full border border-outline-variant/50 text-sm font-semibold hover:bg-white transition-colors"
                >
                  Today
                </button>
              </div>
            </header>

            {loading && <p className="text-outline">Loading calendar...</p>}
            {error && <p className="text-error">{error}</p>}

            {!loading && !error && (
              <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
                <section className="xl:col-span-3 bg-surface-container-lowest rounded-2xl border border-outline-variant/20 overflow-hidden">
                  <div className="px-4 md:px-6 py-4 border-b border-outline-variant/15 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => movePeriod(-1)}
                      className="p-2 rounded-full hover:bg-surface-container-low transition-colors"
                      aria-label={viewMode === VIEW_MODES.MONTH ? 'Previous month' : 'Previous week'}
                    >
                      <span className="material-symbols-outlined">chevron_left</span>
                    </button>
                    <h2 className="text-xl font-bold tracking-tight">
                      {viewMode === VIEW_MODES.MONTH ? formatMonthTitle(monthDate) : formatWeekTitle(selectedDate)}
                    </h2>
                    <button
                      type="button"
                      onClick={() => movePeriod(1)}
                      className="p-2 rounded-full hover:bg-surface-container-low transition-colors"
                      aria-label={viewMode === VIEW_MODES.MONTH ? 'Next month' : 'Next week'}
                    >
                      <span className="material-symbols-outlined">chevron_right</span>
                    </button>
                  </div>

                  <div className="px-4 md:px-6 py-2 border-b border-outline-variant/15 bg-white">
                    <div className="flex flex-wrap items-center gap-3">
                      {classes.map((cls) => {
                        const color = getClassColor(cls.id);
                        return (
                          <div key={cls.id} className="flex items-center gap-2 text-[11px] font-semibold text-outline">
                            <span className={`h-2.5 w-2.5 rounded-full ${color.dot}`} />
                            <span>{cls.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-7 border-b border-outline-variant/15 bg-surface-container-low">
                    {WEEKDAY_LABELS.map((label) => (
                      <div key={label} className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-outline text-center">
                        {label}
                      </div>
                    ))}
                  </div>

                  {viewMode === VIEW_MODES.MONTH ? (
                    <div className="grid grid-cols-7">
                      {monthCells.map((day) => {
                        const key = toDateKey(day);
                        const dayTasks = tasksByDate.get(key) || [];
                        const inMonth = day.getMonth() === monthDate.getMonth();
                        const isToday = isSameDay(day, new Date());
                        const isSelected = isSameDay(day, selectedDate);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setSelectedDate(day)}
                            className={`h-28 md:h-32 border border-outline-variant/10 p-2 text-left transition-colors ${
                              inMonth ? 'bg-white' : 'bg-surface-container-low'
                            } ${isSelected ? 'ring-2 ring-primary/30' : 'hover:bg-primary/5'}`}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className={`text-xs font-semibold ${
                                  isToday ? 'bg-primary text-white rounded-full px-2 py-0.5' : inMonth ? 'text-on-surface' : 'text-outline'
                                }`}
                              >
                                {day.getDate()}
                              </span>
                              {dayTasks.length > 0 && (
                                <span className="text-[10px] font-bold text-primary">{dayTasks.length}</span>
                              )}
                            </div>

                            <div className="mt-2 space-y-1">
                              {dayTasks.slice(0, 2).map((task) => {
                                const color = getClassColor(task.classId);
                                return (
                                  <div key={task.id} className={`text-[10px] px-1.5 py-0.5 rounded truncate ${color.chip}`}>
                                    {task.title}
                                  </div>
                                );
                              })}
                              {dayTasks.length > 2 && (
                                <div className="text-[10px] text-outline font-semibold">+{dayTasks.length - 2} more</div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-7">
                      {weekCells.map((day) => {
                        const key = toDateKey(day);
                        const dayTasks = tasksByDate.get(key) || [];
                        const isToday = isSameDay(day, new Date());
                        const isSelected = isSameDay(day, selectedDate);
                        return (
                          <div
                            key={key}
                            className={`min-h-72 border border-outline-variant/10 ${
                              isSelected ? 'bg-primary/5 ring-2 ring-primary/25' : 'bg-white'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedDate(day)}
                              className="w-full border-b border-outline-variant/10 px-3 py-2 text-left hover:bg-surface-container-low transition-colors"
                            >
                              <p className="text-[10px] font-bold uppercase tracking-wider text-outline">
                                {day.toLocaleDateString('en-US', { weekday: 'short' })}
                              </p>
                              <p className={`text-sm font-bold mt-1 ${isToday ? 'text-primary' : 'text-on-surface'}`}>
                                {day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </p>
                            </button>

                            <div className="p-2 space-y-2">
                              {dayTasks.length === 0 && <p className="text-[11px] text-outline italic px-1">No tasks</p>}
                              {dayTasks.map((task) => {
                                const color = getClassColor(task.classId);
                                return (
                                  <Link key={task.id} to={`/assignment/${task.id}`} className="block">
                                    <article className={`rounded-lg border border-outline-variant/20 border-l-4 p-2 ${color.cardAccent} ${color.softRow}`}>
                                      <p className="text-xs font-semibold text-on-surface truncate">{task.title}</p>
                                      <div className="mt-1 flex items-center justify-between gap-2">
                                        <p className="text-[10px] text-outline truncate">{task.className}</p>
                                        <p className="text-[10px] text-outline">{new Date(task.due_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
                                      </div>
                                    </article>
                                  </Link>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <aside className="xl:col-span-1 space-y-4">
                  <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-outline">Selected Day</h3>
                    <p className="text-sm font-semibold mt-1">{selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>

                    <div className="mt-3 space-y-3">
                      {selectedDayTasks.length === 0 && (
                        <p className="text-xs text-outline italic">No tasks due on this day.</p>
                      )}
                      {selectedDayTasks.map((task) => {
                        const status = getTaskStatus(task, user?.role, renderNow);
                        const color = getClassColor(task.classId);
                        return (
                          <Link key={task.id} to={`/assignment/${task.id}`} className="block">
                            <article className={`border border-outline-variant/20 border-l-4 rounded-xl p-3 hover:shadow-sm transition-shadow ${color.cardAccent}`}>
                              <p className="text-sm font-bold text-on-surface">{task.title}</p>
                              <div className="mt-1 flex items-center gap-2">
                                <span className={`h-2 w-2 rounded-full ${color.dot}`} />
                                <p className="text-xs text-outline">{task.className}</p>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <span className="text-[11px] text-outline">{formatDueText(task.due_date)}</span>
                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${status.className}`}>
                                  {status.label}
                                </span>
                              </div>
                            </article>
                          </Link>
                        );
                      })}
                    </div>
                  </section>

                  <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-outline">Upcoming</h3>
                    <div className="mt-3 space-y-2">
                      {upcomingTasks.length === 0 && <p className="text-xs text-outline italic">No upcoming work.</p>}
                      {upcomingTasks.map((task) => {
                        const color = getClassColor(task.classId);
                        return (
                        <Link key={task.id} to={`/assignment/${task.id}`} className="block">
                          <div className={`p-2 rounded-lg transition-colors ${color.softRow}`}>
                            <p className="text-xs font-semibold text-on-surface truncate">{task.title}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <span className={`h-2 w-2 rounded-full ${color.dot}`} />
                              <p className="text-[11px] text-outline">{new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                            </div>
                          </div>
                        </Link>
                        );
                      })}
                    </div>
                  </section>

                  {user?.role === 'STUDENT' && (
                    <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-outline">Completed</h3>
                      <div className="mt-3 space-y-2">
                        {completedTasks.length === 0 && <p className="text-xs text-outline italic">No completed assignments yet.</p>}
                        {completedTasks.map((task) => (
                          <Link key={task.id} to={`/assignment/${task.id}`} className="block">
                            <div className="p-2 rounded-lg hover:bg-emerald-50 transition-colors">
                              <p className="text-xs font-semibold text-on-surface truncate">{task.title}</p>
                              <p className="text-[11px] text-emerald-700 font-semibold">Completed</p>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </section>
                  )}
                </aside>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
