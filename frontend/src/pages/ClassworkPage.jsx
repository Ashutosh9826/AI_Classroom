import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { assignmentService, classService, lessonService } from '../services/api';
import useAuthStore from '../store/useAuthStore';
import TopNavBar from '../components/TopNavBar';
import Sidebar from '../components/Sidebar';
import TeacherCreateMenu from '../components/TeacherCreateMenu';

const QUIZ_BLOCK_TYPES = new Set(['QUIZ', 'WRITTEN_QUIZ']);

const detectClassworkLessonType = (blocks) => {
  const normalizedTypes = Array.isArray(blocks)
    ? blocks
      .map((block) => String(block?.type || '').trim().toUpperCase())
      .filter(Boolean)
    : [];

  if (normalizedTypes.length === 0) {
    return 'LESSON';
  }

  const hasQuizBlock = normalizedTypes.some((type) => QUIZ_BLOCK_TYPES.has(type));
  if (!hasQuizBlock) {
    return 'LESSON';
  }

  const hasNonQuizBlock = normalizedTypes.some((type) => !QUIZ_BLOCK_TYPES.has(type));
  return hasNonQuizBlock ? 'LESSON' : 'QUIZ';
};

export default function ClassworkPage() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [classContextInfo, setClassContextInfo] = useState(null);
  const [lessonViewMode, setLessonViewMode] = useState('GLOBAL');
  const [globalLessons, setGlobalLessons] = useState([]);
  const [personalLessons, setPersonalLessons] = useState([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessonsError, setLessonsError] = useState('');
  const [forkingLessonId, setForkingLessonId] = useState(null);
  const [cloningLessonId, setCloningLessonId] = useState(null);
  const classId = new URLSearchParams(location.search).get('classId');
  const isStudent = user?.role === 'STUDENT';

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchClasswork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, navigate, classId]);

  useEffect(() => {
    setLessonViewMode('GLOBAL');
  }, [classId]);

  const fetchStudentLessonCollections = async (activeClassId, options = {}) => {
    if (!isStudent || !activeClassId) {
      setGlobalLessons([]);
      setPersonalLessons([]);
      setLessonsError('');
      setLessonsLoading(false);
      return;
    }

    const shouldShowLoading = options.showLoading !== false;
    if (shouldShowLoading) {
      setLessonsLoading(true);
    }

    try {
      setLessonsError('');
      const [globalResult, personalResult] = await Promise.allSettled([
        lessonService.getByClass(activeClassId),
        lessonService.getPersonalByClass(activeClassId),
      ]);

      const hydrateLessonCollectionTypes = async (rawLessons) => {
        const lessonList = Array.isArray(rawLessons) ? rawLessons : [];
        if (lessonList.length === 0) return [];

        const typed = await Promise.all(
          lessonList.map(async (lesson) => {
            try {
              const lessonDetail = await lessonService.getById(lesson.id);
              return {
                ...lesson,
                collection_item_type: detectClassworkLessonType(lessonDetail?.blocks),
              };
            } catch {
              return {
                ...lesson,
                collection_item_type: 'LESSON',
              };
            }
          })
        );

        return typed.filter((lesson) => lesson.collection_item_type === 'LESSON');
      };

      if (globalResult.status === 'fulfilled') {
        const typedGlobalLessons = await hydrateLessonCollectionTypes(globalResult.value);
        setGlobalLessons(typedGlobalLessons);
      } else {
        console.error('Failed to load global lessons for classwork', globalResult.reason);
        setGlobalLessons([]);
        setLessonsError('Failed to load global lessons.');
      }

      if (personalResult.status === 'fulfilled') {
        const typedPersonalLessons = await hydrateLessonCollectionTypes(personalResult.value);
        setPersonalLessons(typedPersonalLessons);
      } else {
        console.error('Failed to load personal lessons for classwork', personalResult.reason);
        setPersonalLessons([]);
        setLessonsError((prev) => prev || 'Failed to load personal lessons.');
      }
    } finally {
      if (shouldShowLoading) {
        setLessonsLoading(false);
      }
    }
  };

  const fetchClasswork = async () => {
    try {
      setLoading(true);
      setError('');
      let flattened = [];

      if (classId) {
        const [classInfo, assignments] = await Promise.all([
          classService.getById(classId),
          assignmentService.getByClass(classId),
        ]);

        setClassContextInfo(classInfo);
        flattened = assignments.map((assignment) => ({
          ...assignment,
          className: classInfo.name,
          classId: classInfo.id,
          section: classInfo.section || 'General',
        }));

        await fetchStudentLessonCollections(classId, { showLoading: true });
      } else {
        setClassContextInfo(null);
        const classes = await classService.getClasses();
        const withAssignments = await Promise.all(
          classes.map(async (cls) => {
            const assignments = await assignmentService.getByClass(cls.id);
            return { cls, assignments };
          })
        );

        withAssignments.forEach(({ cls, assignments }) => {
          assignments.forEach((assignment) => {
            flattened.push({
              ...assignment,
              className: cls.name,
              classId: cls.id,
              section: cls.section || 'General',
            });
          });
        });

        setGlobalLessons([]);
        setPersonalLessons([]);
        setLessonsError('');
      }

      flattened.sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date) - new Date(b.due_date);
      });

      setRows(flattened);
    } catch (err) {
      console.error(err);
      setError('Failed to load classwork');
    } finally {
      setLoading(false);
    }
  };

  const handleForkLesson = async (lesson) => {
    if (!classId || !lesson?.id || !isStudent) return;

    try {
      setForkingLessonId(lesson.id);
      setLessonsError('');
      const personalLesson = await lessonService.forkForStudent(lesson.id);
      await fetchStudentLessonCollections(classId, { showLoading: false });
      setLessonViewMode('PERSONAL');
      navigate(`/lesson/edit?lessonId=${encodeURIComponent(personalLesson.id)}`);
    } catch (err) {
      console.error('Failed to fork lesson for student edit', err);
      setLessonsError(err.response?.data?.error || 'Failed to create your personal lesson copy.');
    } finally {
      setForkingLessonId(null);
    }
  };

  const handleCloneLessonToPersonal = async (lesson) => {
    if (!classId || !lesson?.id || !isStudent) return;

    try {
      setCloningLessonId(lesson.id);
      setLessonsError('');
      await lessonService.forkForStudent(lesson.id);
      await fetchStudentLessonCollections(classId, { showLoading: false });
      setLessonViewMode('PERSONAL');
    } catch (err) {
      console.error('Failed to clone lesson into personal collection', err);
      setLessonsError(err.response?.data?.error || 'Failed to add lesson to your personal collection.');
    } finally {
      setCloningLessonId(null);
    }
  };

  const upcomingCount = useMemo(() => {
    return rows.filter((r) => r.due_date && new Date(r.due_date) > new Date()).length;
  }, [rows]);

  const activeStudentLessons = lessonViewMode === 'GLOBAL' ? globalLessons : personalLessons;

  const formatDueDate = (value) => {
    if (!value) return 'No due date';
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatLessonDate = (value) => {
    if (!value) return '';
    return new Date(value).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const openCreateFromClasswork = (createAction) => {
    if (!classId) return;
    navigate(`/class/stream?classId=${encodeURIComponent(classId)}&action=${encodeURIComponent(createAction)}`);
  };

  const isArchivedClass = Boolean(classContextInfo?.is_archived);

  return (
    <div className="bg-background text-on-surface min-h-screen">
      <TopNavBar />
      <div className="flex pt-16">
        <Sidebar />
        <main className="w-full lg:pl-64 px-6 py-8">
          <div className="max-w-5xl mx-auto">
            <header className="mb-8">
              <p className="text-xs font-bold uppercase tracking-widest text-outline">Classwork</p>
              <h1 className="text-4xl font-bold tracking-tight mt-2">
                {classId ? `${classContextInfo?.name || 'Class'} Tasks` : 'All Tasks'}
              </h1>
              <p className="text-sm text-outline mt-2">
                {upcomingCount} upcoming {classId ? 'deadlines in this class' : 'deadlines'}
              </p>
            </header>

            {isStudent && (
              <section className="mb-8 rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-outline">Lesson Collections</p>
                    <p className="text-sm text-outline mt-1">
                      Switch between teacher-published lessons and your personal edited copies.
                    </p>
                  </div>
                  <div className="inline-flex rounded-full border border-outline-variant/30 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setLessonViewMode('GLOBAL')}
                      className={`px-4 py-2 text-xs font-bold uppercase tracking-wider ${
                        lessonViewMode === 'GLOBAL'
                          ? 'bg-primary text-white'
                          : 'bg-white text-on-surface-variant hover:bg-surface-container-low'
                      }`}
                    >
                      Global Lessons
                    </button>
                    <button
                      type="button"
                      onClick={() => setLessonViewMode('PERSONAL')}
                      className={`px-4 py-2 text-xs font-bold uppercase tracking-wider ${
                        lessonViewMode === 'PERSONAL'
                          ? 'bg-primary text-white'
                          : 'bg-white text-on-surface-variant hover:bg-surface-container-low'
                      }`}
                    >
                      Personal Lessons
                    </button>
                  </div>
                </div>

                {!classId && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    Open Classwork from a class to view lesson collections.
                  </div>
                )}

                {classId && lessonsError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {lessonsError}
                  </div>
                )}

                {classId && lessonsLoading && (
                  <p className="text-sm text-outline">Loading lessons...</p>
                )}

                {classId && !lessonsLoading && activeStudentLessons.length === 0 && (
                  <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container p-5 text-sm text-outline text-center">
                    {lessonViewMode === 'GLOBAL'
                      ? 'No global lessons available in this class yet.'
                      : 'No personal lessons yet. Fork a global lesson to start your private edits.'}
                  </div>
                )}

                {classId && !lessonsLoading && activeStudentLessons.length > 0 && (
                  <div className="space-y-3">
                    {activeStudentLessons.map((lesson) => {
                      const isPersonalLesson = lessonViewMode === 'PERSONAL';
                      return (
                        <article
                          key={lesson.id}
                          className="rounded-xl border border-outline-variant/20 bg-surface px-4 py-3 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-on-surface truncate">{lesson.title}</p>
                            <p className="text-xs text-outline mt-1">
                              {isPersonalLesson ? 'My private copy' : `Teacher lesson - ${lesson.status || 'PUBLISHED'}`}
                              {lesson.created_at ? ` - ${formatLessonDate(lesson.created_at)}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isPersonalLesson ? (
                              <button
                                type="button"
                                onClick={() => navigate(`/lesson/edit?lessonId=${encodeURIComponent(lesson.id)}`)}
                                className="text-xs font-semibold text-primary border border-primary/30 px-3 py-1 rounded-full hover:bg-primary/5 transition-colors"
                              >
                                Open Editor
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => navigate(`/lesson/live?lessonId=${encodeURIComponent(lesson.id)}`)}
                                  className="text-xs font-semibold text-on-surface-variant border border-outline-variant/40 px-3 py-1 rounded-full hover:bg-surface-container-low transition-colors"
                                >
                                  Open Lesson
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCloneLessonToPersonal(lesson)}
                                  disabled={cloningLessonId === lesson.id || forkingLessonId === lesson.id}
                                  className="text-xs font-semibold text-secondary border border-secondary/30 px-3 py-1 rounded-full hover:bg-secondary/5 transition-colors disabled:opacity-50"
                                >
                                  {cloningLessonId === lesson.id ? 'Adding...' : 'Add to My Collection'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleForkLesson(lesson)}
                                  disabled={forkingLessonId === lesson.id || cloningLessonId === lesson.id}
                                  className="text-xs font-semibold text-primary border border-primary/30 px-3 py-1 rounded-full hover:bg-primary/5 transition-colors disabled:opacity-50"
                                >
                                  {forkingLessonId === lesson.id ? 'Preparing...' : 'Edit My Copy'}
                                </button>
                              </>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {user?.role === 'TEACHER' && classId && (
              <div className="mb-6">
                <TeacherCreateMenu
                  onCreateAssignment={() => openCreateFromClasswork('create-assignment')}
                  onCreateAnnouncement={() => openCreateFromClasswork('create-announcement')}
                  onCreateManualLesson={() => openCreateFromClasswork('create-lesson-manual')}
                  onCreateAiLesson={() => openCreateFromClasswork('create-lesson-ai')}
                  onCreateManualQuiz={() => openCreateFromClasswork('create-quiz-manual')}
                  onCreateAiQuiz={() => openCreateFromClasswork('create-quiz-ai')}
                  disabled={isArchivedClass}
                />
              </div>
            )}

            {loading && <p className="text-outline">Loading classwork...</p>}
            {error && <p className="text-error">{error}</p>}

            {!loading && !error && rows.length === 0 && (
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-8 text-center">
                <p className="text-outline italic">No assignments yet across your classes.</p>
              </div>
            )}

            {!loading && !error && rows.length > 0 && (
              <div className="space-y-4">
                {rows.map((row) => (
                  <Link key={row.id} to={`/assignment/${row.id}`} className="block">
                    <article className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5 hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-bold text-on-surface">{row.title}</p>
                          <p className="text-xs text-outline mt-1">
                            {row.className} ({row.section})
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold text-outline">Due</p>
                          <p className="text-sm font-medium text-on-surface">{formatDueDate(row.due_date)}</p>
                        </div>
                      </div>
                    </article>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
