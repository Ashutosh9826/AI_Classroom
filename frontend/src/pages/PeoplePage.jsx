import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { classService, SOCKET_BASE_URL } from '../services/api';
import useAuthStore from '../store/useAuthStore';
import TopNavBar from '../components/TopNavBar';
import Sidebar from '../components/Sidebar';

const SOCKET_URL = SOCKET_BASE_URL;

const formatDate = (dateValue) => {
  if (!dateValue) return '-';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatDateTime = (dateValue) => {
  if (!dateValue) return '-';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export default function PeoplePage() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const forcedClassId = new URLSearchParams(location.search).get('classId');
  const isTeacher = user?.role === 'TEACHER';

  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [students, setStudents] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedStudentDetails, setSelectedStudentDetails] = useState(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recordTitle, setRecordTitle] = useState('');
  const [recordRemark, setRecordRemark] = useState('');

  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [recordSaving, setRecordSaving] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState('');
  const [error, setError] = useState('');

  const selectedClass = useMemo(
    () => classes.find((cls) => cls.id === selectedClassId) || null,
    [classes, selectedClassId]
  );

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) || null,
    [students, selectedStudentId]
  );

  const filteredStudents = useMemo(() => {
    const query = String(searchQuery || '').trim().toLowerCase();
    if (!query) return students;
    return students.filter((student) => {
      const name = String(student.name || '').toLowerCase();
      const email = String(student.email || '').toLowerCase();
      return name.includes(query) || email.includes(query);
    });
  }, [students, searchQuery]);

  const onlineCount = useMemo(
    () => students.filter((student) => student.online_now).length,
    [students]
  );

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    loadClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, navigate, forcedClassId]);

  useEffect(() => {
    if (!selectedClassId) return;
    loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  useEffect(() => {
    if (!isProfileOpen || !isTeacher || !selectedClassId || !selectedStudentId) {
      return;
    }
    loadStudentDetails(selectedClassId, selectedStudentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProfileOpen, isTeacher, selectedClassId, selectedStudentId]);

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
      if (payload?.classId !== selectedClassId) return;
      const onlineSet = new Set(payload.onlineStudentIds || []);
      setStudents((prev) =>
        (prev || []).map((student) => ({
          ...student,
          online_now: onlineSet.has(student.id),
        }))
      );
      setSelectedStudentDetails((prev) => {
        if (!prev?.student?.id) return prev;
        return {
          ...prev,
          student: {
            ...prev.student,
            online_now: onlineSet.has(prev.student.id),
          },
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

  const closeProfileDrawer = () => {
    setIsProfileOpen(false);
    setRecordTitle('');
    setRecordRemark('');
  };

  const loadClasses = async () => {
    try {
      setLoadingClasses(true);
      setError('');
      const data = await classService.getClasses();
      setClasses(data || []);

      if (!Array.isArray(data) || data.length === 0) {
        setSelectedClassId('');
        return;
      }

      if (forcedClassId) {
        const matchedClass = data.find((cls) => String(cls.id) === String(forcedClassId));
        setSelectedClassId(matchedClass ? matchedClass.id : data[0].id);
      } else {
        setSelectedClassId((prev) => prev || data[0].id);
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to load classes.');
      setSelectedClassId('');
    } finally {
      setLoadingClasses(false);
    }
  };

  const loadStudents = async () => {
    if (!selectedClassId) return;
    try {
      setLoadingStudents(true);
      setError('');
      const snapshot = await classService.getStudents(selectedClassId);
      const roster = Array.isArray(snapshot?.students) ? snapshot.students : [];
      setStudents(roster);
      setSelectedStudentDetails(null);
      setIsProfileOpen(false);
      setSelectedStudentId((prev) =>
        prev && roster.some((student) => student.id === prev) ? prev : ''
      );
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to load students.');
      setStudents([]);
      setSelectedStudentId('');
      setSelectedStudentDetails(null);
      setIsProfileOpen(false);
    } finally {
      setLoadingStudents(false);
    }
  };

  const loadStudentDetails = async (classId, studentId) => {
    if (!classId || !studentId || !isTeacher) return;
    try {
      setLoadingDetails(true);
      setError('');
      const detail = await classService.getStudentDetails(classId, studentId);
      setSelectedStudentDetails(detail);
    } catch (err) {
      console.error(err);
      setSelectedStudentDetails(null);
      setError(err.response?.data?.error || 'Failed to load student details.');
    } finally {
      setLoadingDetails(false);
    }
  };

  const openStudentProfile = (studentId) => {
    setSelectedStudentId(studentId);
    setIsProfileOpen(true);
    setRecordTitle('');
    setRecordRemark('');
  };

  const handleRemoveStudent = async () => {
    if (!isTeacher || !selectedClassId || !selectedStudent) return;

    const confirmed = window.confirm(
      `Remove ${selectedStudent.name} from this class? This will revoke class access immediately.`
    );
    if (!confirmed) return;

    try {
      setActionLoading(true);
      setError('');
      await classService.removeStudent(selectedClassId, selectedStudent.id);

      setStudents((prev) => (prev || []).filter((student) => student.id !== selectedStudent.id));
      setSelectedStudentId('');
      setSelectedStudentDetails(null);
      setIsProfileOpen(false);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to remove student.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddRecord = async () => {
    if (!isTeacher || !selectedClassId || !selectedStudentId) return;

    const trimmedTitle = String(recordTitle || '').trim();
    const trimmedRemark = String(recordRemark || '').trim();
    if (!trimmedRemark) {
      setError('Remark is required before saving a student record.');
      return;
    }

    try {
      setRecordSaving(true);
      setError('');
      const created = await classService.addStudentRecord(selectedClassId, selectedStudentId, {
        title: trimmedTitle,
        remark: trimmedRemark,
      });

      setSelectedStudentDetails((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          student_records: [created, ...(prev.student_records || [])],
        };
      });
      setRecordTitle('');
      setRecordRemark('');
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to save student record.');
    } finally {
      setRecordSaving(false);
    }
  };

  const handleDeleteRecord = async (recordId) => {
    if (!isTeacher || !selectedClassId || !selectedStudentId || !recordId) return;

    const confirmed = window.confirm('Delete this student record?');
    if (!confirmed) return;

    try {
      setDeletingRecordId(recordId);
      setError('');
      await classService.deleteStudentRecord(selectedClassId, selectedStudentId, recordId);

      setSelectedStudentDetails((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          student_records: (prev.student_records || []).filter((record) => record.id !== recordId),
        };
      });
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to delete student record.');
    } finally {
      setDeletingRecordId('');
    }
  };

  const renderRoster = () => {
    if (loadingStudents) {
      return <p className="text-outline">Loading students...</p>;
    }

    if (students.length === 0) {
      return <p className="text-outline">No students are enrolled in this class yet.</p>;
    }

    if (filteredStudents.length === 0) {
      return <p className="text-outline">No students match your search.</p>;
    }

    return (
      <div className="overflow-x-auto rounded-xl border border-outline-variant/20 bg-surface-container-lowest">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="bg-surface-container text-on-surface-variant text-xs uppercase tracking-widest">
            <tr>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Profile</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.map((student) => (
              <tr
                key={student.id}
                className={`border-t border-outline-variant/15 ${
                  selectedStudentId === student.id && isProfileOpen ? 'bg-primary/5' : ''
                }`}
              >
                <td className="px-4 py-3 font-semibold">{student.name}</td>
                <td className="px-4 py-3 text-on-surface-variant">{student.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${
                      student.online_now ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">
                      {student.online_now ? 'wifi' : 'wifi_off'}
                    </span>
                    {student.online_now ? 'Online' : 'Offline'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => openStudentProfile(student.id)}
                    className="px-3 py-1.5 rounded-full border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/5"
                  >
                    Open Profile
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderTeacherDrawerBody = () => {
    if (!selectedStudent) {
      return <p className="text-outline">Select a student to view details.</p>;
    }

    if (loadingDetails) {
      return <p className="text-outline">Loading student details...</p>;
    }

    const details = selectedStudentDetails;
    const attendanceSummary = details?.attendance_summary;
    const recentAttendance = details?.recent_attendance || [];
    const studentRecords = details?.student_records || [];

    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-outline">Student Profile</p>
              <h2 className="text-2xl font-bold mt-1">{selectedStudent.name}</h2>
              <p className="text-sm text-outline mt-1">{selectedStudent.email}</p>
            </div>
            <button
              type="button"
              onClick={handleRemoveStudent}
              disabled={actionLoading}
              className="px-3 py-2 rounded-full text-xs font-semibold border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              {actionLoading ? 'Removing...' : 'Remove from Class'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <div className="rounded-lg border border-outline-variant/20 bg-white p-3">
              <p className="text-xs uppercase tracking-widest font-bold text-outline">Online Now</p>
              <p className={`text-sm font-semibold mt-1 ${details?.student?.online_now ? 'text-emerald-700' : 'text-slate-600'}`}>
                {details?.student?.online_now ? 'Yes' : 'No'}
              </p>
            </div>
            <div className="rounded-lg border border-outline-variant/20 bg-white p-3">
              <p className="text-xs uppercase tracking-widest font-bold text-outline">Account Created</p>
              <p className="text-sm font-semibold mt-1">{formatDate(details?.student?.account_created_at)}</p>
            </div>
            <div className="rounded-lg border border-outline-variant/20 bg-white p-3">
              <p className="text-xs uppercase tracking-widest font-bold text-outline">Last Attendance Update</p>
              <p className="text-sm font-semibold mt-1">{formatDateTime(attendanceSummary?.last_marked_at)}</p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
            <p className="text-xs uppercase tracking-widest text-outline font-bold">Total</p>
            <p className="text-2xl font-bold mt-1">{attendanceSummary?.total || 0}</p>
          </div>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
            <p className="text-xs uppercase tracking-widest text-outline font-bold">Present</p>
            <p className="text-2xl font-bold mt-1 text-emerald-600">{attendanceSummary?.present || 0}</p>
          </div>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
            <p className="text-xs uppercase tracking-widest text-outline font-bold">Absent</p>
            <p className="text-2xl font-bold mt-1 text-rose-600">{attendanceSummary?.absent || 0}</p>
          </div>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
            <p className="text-xs uppercase tracking-widest text-outline font-bold">Rate</p>
            <p className="text-2xl font-bold mt-1">{attendanceSummary?.attendance_rate || 0}%</p>
          </div>
        </section>

        <section className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4 space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-outline">Add Record / Remark</p>
            <p className="text-xs text-outline mt-1">
              Add private teacher notes for this student.
            </p>
          </div>
          <input
            value={recordTitle}
            onChange={(e) => setRecordTitle(e.target.value)}
            placeholder="Record title (optional)"
            className="w-full bg-white border border-outline-variant/25 rounded-xl px-3 py-2 outline-none focus:border-primary text-sm"
          />
          <textarea
            value={recordRemark}
            onChange={(e) => setRecordRemark(e.target.value)}
            placeholder="Write remark..."
            rows={4}
            className="w-full bg-white border border-outline-variant/25 rounded-xl px-3 py-2 outline-none focus:border-primary text-sm resize-y"
          />
          <button
            type="button"
            onClick={handleAddRecord}
            disabled={recordSaving}
            className="px-4 py-2 rounded-full bg-primary text-white text-xs font-semibold hover:shadow-md disabled:opacity-50"
          >
            {recordSaving ? 'Saving...' : 'Save Record'}
          </button>
        </section>

        <section className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest overflow-hidden">
          <div className="px-4 py-3 border-b border-outline-variant/20">
            <p className="text-xs font-bold uppercase tracking-widest text-outline">Student Records</p>
          </div>
          <div className="p-4 space-y-3">
            {studentRecords.length === 0 && (
              <p className="text-sm text-outline">No records added yet.</p>
            )}
            {studentRecords.map((record) => (
              <article key={record.id} className="rounded-lg border border-outline-variant/20 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{record.title || 'Record'}</p>
                    <p className="text-xs text-outline mt-1">
                      {record.created_by_name || 'Teacher'} · {formatDateTime(record.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteRecord(record.id)}
                    disabled={deletingRecordId === record.id}
                    className="text-xs font-semibold text-rose-700 border border-rose-300 rounded-full px-2.5 py-1 hover:bg-rose-50 disabled:opacity-50"
                  >
                    {deletingRecordId === record.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
                <p className="text-sm text-on-surface-variant mt-2 whitespace-pre-wrap">{record.remark}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest overflow-x-auto">
          <table className="w-full min-w-[460px] text-sm">
            <thead className="bg-surface-container text-on-surface-variant text-xs uppercase tracking-widest">
              <tr>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Mode</th>
              </tr>
            </thead>
            <tbody>
              {recentAttendance.length === 0 && (
                <tr className="border-t border-outline-variant/15">
                  <td className="px-4 py-4 text-on-surface-variant" colSpan={3}>
                    No attendance entries found for this student.
                  </td>
                </tr>
              )}
              {recentAttendance.map((record) => (
                <tr key={record.id} className="border-t border-outline-variant/15">
                  <td className="px-4 py-3 font-semibold">{formatDate(record.date)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-bold ${
                        record.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {record.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">{record.mode || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    );
  };

  const renderStudentDrawerBody = () => {
    if (!selectedStudent) {
      return <p className="text-outline">Select a student to view profile information.</p>;
    }

    return (
      <section className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4 space-y-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-outline">Student</p>
          <h2 className="text-2xl font-bold mt-1">{selectedStudent.name}</h2>
          <p className="text-sm text-outline mt-1">{selectedStudent.email}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-outline-variant/20 bg-white p-3">
            <p className="text-xs uppercase tracking-widest font-bold text-outline">Online Now</p>
            <p className={`text-sm font-semibold mt-1 ${selectedStudent.online_now ? 'text-emerald-700' : 'text-slate-600'}`}>
              {selectedStudent.online_now ? 'Yes' : 'No'}
            </p>
          </div>
          <div className="rounded-lg border border-outline-variant/20 bg-white p-3">
            <p className="text-xs uppercase tracking-widest font-bold text-outline">Account Created</p>
            <p className="text-sm font-semibold mt-1">{formatDate(selectedStudent.account_created_at)}</p>
          </div>
        </div>
        <p className="text-xs text-outline">View-only access for student accounts.</p>
      </section>
    );
  };

  const renderProfileDrawer = () => {
    if (!isProfileOpen) return null;

    return (
      <>
        <button
          type="button"
          onClick={closeProfileDrawer}
          className="fixed inset-0 top-16 bg-black/30 z-40"
          aria-label="Close student profile drawer"
        />
        <aside className="fixed top-16 right-0 h-[calc(100vh-64px)] w-full sm:w-[560px] bg-white border-l border-outline-variant/20 z-50 overflow-y-auto shadow-2xl">
          <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-outline-variant/20 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-outline">Student Profile</p>
              <p className="text-sm font-semibold text-on-surface">
                {selectedStudent?.name || 'Profile'}
              </p>
            </div>
            <button
              type="button"
              onClick={closeProfileDrawer}
              className="material-symbols-outlined p-1 rounded-full hover:bg-surface-container-low"
              aria-label="Close drawer"
            >
              close
            </button>
          </div>
          <div className="p-4 pb-8">
            {isTeacher ? renderTeacherDrawerBody() : renderStudentDrawerBody()}
          </div>
        </aside>
      </>
    );
  };

  return (
    <div className="bg-background text-on-surface min-h-screen">
      <TopNavBar />
      <div className="flex pt-16">
        <Sidebar />
        <main className="w-full lg:pl-64 px-6 py-8">
          <div className="max-w-7xl mx-auto">
            <header className="mb-8">
              <p className="text-xs font-bold uppercase tracking-widest text-outline">People</p>
              <h1 className="text-4xl font-bold tracking-tight mt-2">
                {forcedClassId && selectedClass ? `${selectedClass.name} Students` : 'Students'}
              </h1>
              <p className="text-sm text-outline mt-2">
                {isTeacher
                  ? 'Open a student profile from the roster to view details and add records.'
                  : 'Open a student profile from the roster to view details.'}
              </p>
            </header>

            {loadingClasses && <p className="text-outline">Loading classes...</p>}
            {error && <p className="text-error mb-4">{error}</p>}

            {!loadingClasses && classes.length === 0 && (
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-8 text-center">
                <p className="text-outline italic">No classes found yet.</p>
              </div>
            )}

            {!loadingClasses && classes.length > 0 && (
              <>
                <section className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                  {!forcedClassId && (
                    <div className="md:col-span-2">
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
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">Search Students</label>
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by name or email"
                      className="w-full bg-surface-container-lowest border border-outline-variant/25 rounded-xl px-3 py-3 outline-none focus:border-primary"
                    />
                  </div>
                </section>

                {selectedClass && (
                  <section className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
                      <p className="text-xs uppercase tracking-widest text-outline font-bold">Class</p>
                      <p className="text-sm font-semibold mt-1">{selectedClass.name}</p>
                    </div>
                    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
                      <p className="text-xs uppercase tracking-widest text-outline font-bold">Students</p>
                      <p className="text-2xl font-bold mt-1">{students.length}</p>
                    </div>
                    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
                      <p className="text-xs uppercase tracking-widest text-outline font-bold">Online</p>
                      <p className="text-2xl font-bold mt-1 text-emerald-600">{onlineCount}</p>
                    </div>
                  </section>
                )}

                <section>{renderRoster()}</section>
              </>
            )}
          </div>
        </main>
      </div>

      {renderProfileDrawer()}
    </div>
  );
}
