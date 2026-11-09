import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { attendanceService, classService, SOCKET_BASE_URL } from '../services/api';
import useAuthStore from '../store/useAuthStore';
import TopNavBar from '../components/TopNavBar';
import Sidebar from '../components/Sidebar';

const getTodayDate = () => new Date().toISOString().slice(0, 10);
const SOCKET_URL = SOCKET_BASE_URL;

const formatDate = (dateValue) => {
  if (!dateValue) return '-';
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return dateValue;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function AttendancePage() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const forcedClassId = new URLSearchParams(location.search).get('classId');

  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedDate, setSelectedDate] = useState(getTodayDate());

  const [loading, setLoading] = useState(true);
  const [dayLoading, setDayLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  const [teacherDayData, setTeacherDayData] = useState(null);
  const [manualStatuses, setManualStatuses] = useState({});
  const [studentAttendanceData, setStudentAttendanceData] = useState(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    loadClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, navigate, forcedClassId]);

  useEffect(() => {
    if (!selectedClassId || !user) return;
    loadAttendanceForSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId, selectedDate, user?.role]);

  useEffect(() => {
    if (!selectedClassId || !user?.id) return undefined;

    const socket = io(SOCKET_URL);

    const joinPayload = {
      classId: selectedClassId,
      userId: user.id,
      role: user.role,
    };

    const handleConnect = () => {
      socket.emit('join_class_presence', joinPayload);
    };

    const handlePresenceUpdated = (payload) => {
      if (payload?.classId !== selectedClassId || user.role !== 'TEACHER') return;

      const onlineSet = new Set(payload.onlineStudentIds || []);
      setTeacherDayData((prev) => {
        if (!prev) return prev;

        return {
          ...prev,
          onlineStudentIds: [...onlineSet],
          students: (prev.students || []).map((student) => ({
            ...student,
            online_now: onlineSet.has(student.id),
          })),
        };
      });
    };

    socket.on('connect', handleConnect);
    socket.on('class_presence_updated', handlePresenceUpdated);

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('class_presence_updated', handlePresenceUpdated);
      socket.emit('leave_class_presence', {
        classId: selectedClassId,
        userId: user.id,
      });
      socket.disconnect();
    };
  }, [selectedClassId, user?.id, user?.role]);

  const selectedClass = useMemo(
    () => classes.find((cls) => cls.id === selectedClassId) || null,
    [classes, selectedClassId]
  );

  const loadClasses = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await classService.getClasses();
      setClasses(data);

      if (data.length > 0) {
        if (forcedClassId) {
          const matchedClass = data.find((cls) => String(cls.id) === String(forcedClassId));
          setSelectedClassId(matchedClass ? matchedClass.id : data[0].id);
        } else {
          setSelectedClassId((prev) => prev || data[0].id);
        }
      } else {
        setSelectedClassId('');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load classes.');
    } finally {
      setLoading(false);
    }
  };

  const hydrateTeacherManualStatuses = (snapshot) => {
    const nextStatuses = {};
    (snapshot?.students || []).forEach((student) => {
      nextStatuses[student.id] = student.status || 'ABSENT';
    });
    setManualStatuses(nextStatuses);
  };

  const loadAttendanceForSelection = async () => {
    try {
      setDayLoading(true);
      setError('');

      if (user?.role === 'TEACHER') {
        const snapshot = await attendanceService.getClassDay(selectedClassId, selectedDate);
        setTeacherDayData(snapshot);
        hydrateTeacherManualStatuses(snapshot);
        setStudentAttendanceData(null);
      } else {
        const data = await attendanceService.getMy(selectedClassId);
        setStudentAttendanceData(data);
        setTeacherDayData(null);
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to load attendance data.');
      setTeacherDayData(null);
      setStudentAttendanceData(null);
    } finally {
      setDayLoading(false);
    }
  };

  const setStudentStatus = (studentId, status) => {
    setManualStatuses((prev) => ({
      ...prev,
      [studentId]: status,
    }));
  };

  const handleSaveManual = async () => {
    if (!selectedClassId || !teacherDayData) return;

    const records = (teacherDayData.students || []).map((student) => ({
      student_id: student.id,
      status: manualStatuses[student.id] || 'ABSENT',
    }));

    try {
      setActionLoading(true);
      setError('');
      const snapshot = await attendanceService.saveManual(selectedClassId, {
        date: selectedDate,
        records,
      });
      setTeacherDayData(snapshot);
      hydrateTeacherManualStatuses(snapshot);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to save manual attendance.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTakeAutomatic = async () => {
    if (!selectedClassId) return;

    try {
      setActionLoading(true);
      setError('');
      const snapshot = await attendanceService.takeAutomatic(selectedClassId, {
        date: selectedDate,
      });
      setTeacherDayData(snapshot);
      hydrateTeacherManualStatuses(snapshot);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to take automatic attendance.');
    } finally {
      setActionLoading(false);
    }
  };

  const renderTeacherView = () => {
    if (dayLoading) {
      return <p className="text-outline">Loading attendance...</p>;
    }

    if (!teacherDayData) {
      return <p className="text-outline">Select a class to load attendance.</p>;
    }

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
            <p className="text-xs uppercase tracking-widest text-outline font-bold">Total</p>
            <p className="text-2xl font-bold mt-1">{teacherDayData.summary?.total || 0}</p>
          </div>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
            <p className="text-xs uppercase tracking-widest text-outline font-bold">Present</p>
            <p className="text-2xl font-bold mt-1 text-emerald-600">{teacherDayData.summary?.present || 0}</p>
          </div>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
            <p className="text-xs uppercase tracking-widest text-outline font-bold">Absent</p>
            <p className="text-2xl font-bold mt-1 text-rose-600">{teacherDayData.summary?.absent || 0}</p>
          </div>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
            <p className="text-xs uppercase tracking-widest text-outline font-bold">Rate</p>
            <p className="text-2xl font-bold mt-1">{teacherDayData.summary?.attendance_rate || 0}%</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleTakeAutomatic}
            disabled={actionLoading}
            className="px-4 py-2 rounded-full bg-secondary text-white font-semibold hover:shadow-md transition-all disabled:opacity-50"
          >
            {actionLoading ? 'Processing...' : 'Auto Mark (Online = Present)'}
          </button>
          <button
            type="button"
            onClick={handleSaveManual}
            disabled={actionLoading}
            className="px-4 py-2 rounded-full border border-primary text-primary font-semibold hover:bg-primary/5 transition-all disabled:opacity-50"
          >
            Save Manual Attendance
          </button>
          <button
            type="button"
            onClick={loadAttendanceForSelection}
            disabled={actionLoading || dayLoading}
            className="px-4 py-2 rounded-full border border-outline-variant/40 text-on-surface-variant font-semibold hover:bg-surface-container-low transition-all disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-outline-variant/20 bg-surface-container-lowest">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-container text-on-surface-variant text-xs uppercase tracking-widest">
              <tr>
                <th className="text-left px-4 py-3">Student</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Online Now</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {(teacherDayData.students || []).map((student) => {
                const status = manualStatuses[student.id] || 'ABSENT';
                return (
                  <tr key={student.id} className="border-t border-outline-variant/15">
                    <td className="px-4 py-3 font-semibold">{student.name}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{student.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${student.online_now ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        <span className="material-symbols-outlined text-sm">{student.online_now ? 'wifi' : 'wifi_off'}</span>
                        {student.online_now ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex rounded-full border border-outline-variant/30 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setStudentStatus(student.id, 'PRESENT')}
                          className={`px-3 py-1.5 text-xs font-bold ${status === 'PRESENT' ? 'bg-emerald-500 text-white' : 'bg-white text-emerald-700'}`}
                        >
                          Present
                        </button>
                        <button
                          type="button"
                          onClick={() => setStudentStatus(student.id, 'ABSENT')}
                          className={`px-3 py-1.5 text-xs font-bold ${status === 'ABSENT' ? 'bg-rose-500 text-white' : 'bg-white text-rose-700'}`}
                        >
                          Absent
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderStudentView = () => {
    if (dayLoading) {
      return <p className="text-outline">Loading your attendance...</p>;
    }

    if (!studentAttendanceData) {
      return <p className="text-outline">Select a class to view your attendance.</p>;
    }

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
            <p className="text-xs uppercase tracking-widest text-outline font-bold">Total</p>
            <p className="text-2xl font-bold mt-1">{studentAttendanceData.summary?.total || 0}</p>
          </div>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
            <p className="text-xs uppercase tracking-widest text-outline font-bold">Present</p>
            <p className="text-2xl font-bold mt-1 text-emerald-600">{studentAttendanceData.summary?.present || 0}</p>
          </div>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
            <p className="text-xs uppercase tracking-widest text-outline font-bold">Absent</p>
            <p className="text-2xl font-bold mt-1 text-rose-600">{studentAttendanceData.summary?.absent || 0}</p>
          </div>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
            <p className="text-xs uppercase tracking-widest text-outline font-bold">Rate</p>
            <p className="text-2xl font-bold mt-1">{studentAttendanceData.summary?.attendance_rate || 0}%</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-outline-variant/20 bg-surface-container-lowest">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-surface-container text-on-surface-variant text-xs uppercase tracking-widest">
              <tr>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Mode</th>
              </tr>
            </thead>
            <tbody>
              {(studentAttendanceData.records || []).map((record) => (
                <tr key={record.id} className="border-t border-outline-variant/15">
                  <td className="px-4 py-3 font-semibold">{formatDate(record.date)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-bold ${record.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {record.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">{record.mode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-background text-on-surface min-h-screen">
      <TopNavBar />
      <div className="flex pt-16">
        <Sidebar />
        <main className="w-full lg:pl-64 px-6 py-8">
          <div className="max-w-6xl mx-auto">
            <header className="mb-8">
              <p className="text-xs font-bold uppercase tracking-widest text-outline">Attendance</p>
              <h1 className="text-4xl font-bold tracking-tight mt-2">
                {forcedClassId && selectedClass ? `${selectedClass.name} Attendance` : 'Class Attendance'}
              </h1>
              <p className="text-sm text-outline mt-2">
                {user?.role === 'TEACHER'
                  ? 'Take attendance manually or automatically based on online students.'
                  : 'View your attendance records.'}
              </p>
            </header>

            {loading && <p className="text-outline">Loading classes...</p>}
            {error && <p className="text-error mb-4">{error}</p>}

            {!loading && classes.length === 0 && (
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-8 text-center">
                <p className="text-outline italic">No classes found yet.</p>
              </div>
            )}

            {!loading && classes.length > 0 && (
              <>
                <section className={`mb-6 grid grid-cols-1 gap-3 ${user?.role === 'TEACHER' && !forcedClassId ? 'md:grid-cols-3' : 'md:grid-cols-1'}`}>
                  {!forcedClassId && (
                    <div className={user?.role === 'TEACHER' ? 'md:col-span-2' : 'md:col-span-1'}>
                      <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">Class</label>
                      <select
                        value={selectedClassId}
                        onChange={(e) => setSelectedClassId(e.target.value)}
                        className="w-full bg-surface-container-lowest border border-outline-variant/25 rounded-xl px-3 py-3 outline-none focus:border-primary"
                      >
                        {classes.map((cls) => (
                          <option key={cls.id} value={cls.id}>
                            {cls.name}{cls.section ? ` - ${cls.section}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {user?.role === 'TEACHER' && (
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">Date</label>
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="w-full bg-surface-container-lowest border border-outline-variant/25 rounded-xl px-3 py-3 outline-none focus:border-primary"
                      />
                    </div>
                  )}
                </section>

                {selectedClass && (
                  <div className="mb-4 text-sm text-on-surface-variant">
                    <span className="font-semibold text-on-surface">{selectedClass.name}</span>
                    {selectedClass.section ? ` - ${selectedClass.section}` : ''}
                  </div>
                )}

                {user?.role === 'TEACHER' ? renderTeacherView() : renderStudentView()}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
