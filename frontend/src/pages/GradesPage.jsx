import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { assignmentService, classService } from '../services/api';
import useAuthStore from '../store/useAuthStore';
import TopNavBar from '../components/TopNavBar';
import Sidebar from '../components/Sidebar';

export default function GradesPage() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [classContextInfo, setClassContextInfo] = useState(null);
  const classId = new URLSearchParams(location.search).get('classId');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchGrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, navigate, classId]);

  const fetchGrades = async () => {
    try {
      setLoading(true);
      setError('');
      let gradeRows = [];

      if (classId) {
        const classInfo = await classService.getById(classId);
        const assignments = await assignmentService.getByClass(classId);
        setClassContextInfo(classInfo);

        gradeRows = await Promise.all(
          assignments.map(async (assignment) => {
            if (user.role === 'TEACHER') {
              return {
                id: assignment.id,
                title: assignment.title,
                className: classInfo.name,
                classId: classInfo.id,
                dueDate: assignment.due_date,
              };
            }

            const detail = await assignmentService.getById(assignment.id);
            return {
              id: assignment.id,
              title: assignment.title,
              className: classInfo.name,
              classId: classInfo.id,
              dueDate: assignment.due_date,
              grade: detail.submissions?.[0]?.grade ?? null,
            };
          })
        );
      } else {
        setClassContextInfo(null);
        const classes = await classService.getClasses();
        const classAssignments = await Promise.all(
          classes.map(async (cls) => {
            const assignments = await assignmentService.getByClass(cls.id);
            return { cls, assignments };
          })
        );

        for (const bundle of classAssignments) {
          for (const assignment of bundle.assignments) {
            if (user.role === 'TEACHER') {
              gradeRows.push({
                id: assignment.id,
                title: assignment.title,
                className: bundle.cls.name,
                classId: bundle.cls.id,
                dueDate: assignment.due_date,
              });
            } else {
              const detail = await assignmentService.getById(assignment.id);
              gradeRows.push({
                id: assignment.id,
                title: assignment.title,
                className: bundle.cls.name,
                classId: bundle.cls.id,
                dueDate: assignment.due_date,
                grade: detail.submissions?.[0]?.grade ?? null,
              });
            }
          }
        }
      }

      gradeRows.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      });

      setRows(gradeRows);
    } catch (err) {
      console.error(err);
      setError('Failed to load grades');
    } finally {
      setLoading(false);
    }
  };

  const formatDueDate = (value) => {
    if (!value) return 'No due date';
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="bg-background text-on-surface min-h-screen">
      <TopNavBar />
      <div className="flex pt-16">
        <Sidebar />
        <main className="w-full lg:pl-64 px-6 py-8">
          <div className="max-w-5xl mx-auto">
            <header className="mb-8">
              <p className="text-xs font-bold uppercase tracking-widest text-outline">Grades</p>
              <h1 className="text-4xl font-bold tracking-tight mt-2">
                {classId
                  ? `${classContextInfo?.name || 'Class'} ${user?.role === 'TEACHER' ? 'Grading Queue' : 'Grades'}`
                  : (user?.role === 'TEACHER' ? 'Grading Queue' : 'My Grades')}
              </h1>
            </header>

            {loading && <p className="text-outline">Loading grades...</p>}
            {error && <p className="text-error">{error}</p>}

            {!loading && !error && rows.length === 0 && (
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-8 text-center">
                <p className="text-outline italic">No grade records available yet.</p>
              </div>
            )}

            {!loading && !error && rows.length > 0 && (
              <div className="space-y-3">
                {rows.map((row) => (
                  <article key={row.id} className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-bold">{row.title}</p>
                        <p className="text-xs text-outline">{row.className} • Due {formatDueDate(row.dueDate)}</p>
                      </div>
                      {user?.role === 'TEACHER' ? (
                        <Link
                          to={`/assignment/${row.id}/grade`}
                          className="text-xs font-semibold text-primary border border-primary/30 px-3 py-1 rounded-full hover:bg-primary/5 transition-colors"
                        >
                          Open Grading
                        </Link>
                      ) : (
                        <p className={`text-sm font-bold ${row.grade === null ? 'text-outline' : 'text-secondary'}`}>
                          {row.grade === null ? 'Not graded' : `${row.grade} / 100`}
                        </p>
                      )}
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
