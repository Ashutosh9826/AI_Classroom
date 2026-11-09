import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { API_BASE_URL, assignmentService } from '../services/api';
import useAuthStore from '../store/useAuthStore';

export default function AssignmentView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [submissionContent, setSubmissionContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const isTeacher = user?.role === 'TEACHER';
  const hasSubmission = Array.isArray(assignment?.submissions) && assignment.submissions.length > 0;

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchAssignment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, navigate]);

  const fetchAssignment = async () => {
    try {
      setLoading(true);
      const data = await assignmentService.getById(id);
      setAssignment(data);
    } catch (err) {
      console.error('Failed to fetch assignment:', err);
      setError(err.response?.data?.error || 'Failed to load assignment');
    } finally {
      setLoading(false);
    }
  };

  const handleTurnIn = async () => {
    if (isTeacher) return;
    if (!submissionContent.trim()) return;
    try {
      setSubmitError('');
      setSubmitting(true);
      await assignmentService.submit(id, submissionContent);
      setSubmissionContent('');
      await fetchAssignment(); // Refresh to show submission status
    } catch (err) {
      console.error('Failed to submit:', err);
      if (err?.response?.status === 504) {
        setSubmitError('Request timed out on the server. Please try submitting again.');
      } else if (!err.response) {
        setSubmitError(`Cannot reach backend API (${API_BASE_URL}). Check connection and try again.`);
      } else {
        setSubmitError(err.response?.data?.error || err.message || 'Failed to submit assignment');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'No due date';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="bg-surface text-on-surface min-h-screen flex items-center justify-center">
        <p className="text-on-surface-variant text-lg">Loading assignment...</p>
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <div className="bg-surface text-on-surface min-h-screen flex flex-col items-center justify-center gap-4">
        <span className="material-symbols-outlined text-5xl text-slate-300">error</span>
        <p className="text-on-surface-variant text-lg">{error || 'Assignment not found'}</p>
        <Link to="/dashboard" className="text-primary font-semibold hover:underline">Back to Dashboard</Link>
      </div>
    );
  }

  return (
    <div className="bg-surface text-on-surface antialiased min-h-screen">
      {/* TopAppBar */}
      <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-slate-100 shadow-sm font-['Inter'] antialiased">
        <div className="flex justify-between items-center px-6 h-16 w-full max-w-screen-2xl mx-auto">
          <div className="flex items-center gap-8">
            <Link to="/dashboard" className="text-xl font-semibold text-slate-900">Academic Atelier</Link>
            <nav className="hidden md:flex items-center space-x-6">
              <Link to="/dashboard" className="text-slate-500 hover:text-slate-900 transition-colors">Home</Link>
              <span className="text-blue-600 border-b-2 border-blue-600 pb-2">Classwork</span>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <button
              className="p-2 text-slate-500 hover:bg-slate-50 rounded-full transition-colors"
              type="button"
              onClick={() => navigate('/classwork')}
              title="Go to classwork"
            >
              <span className="material-symbols-outlined">apps</span>
            </button>
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold">
              {user?.name?.charAt(0) || 'U'}
            </div>
          </div>
        </div>
      </header>
      
      <main className="pt-24 pb-12 px-6 max-w-screen-xl mx-auto">
        {/* Back Navigation */}
        <div className="mb-8">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-primary font-medium hover:underline group">
            <span className="material-symbols-outlined text-sm transition-transform group-hover:-translate-x-1">arrow_back</span>
            Back to Classwork
          </button>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Main Content Area */}
          <div className="lg:col-span-8">
            {/* Assignment Header */}
            <div className="flex items-start gap-5 mb-10">
              <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>assignment</span>
              </div>
              <div className="flex-grow">
                <h1 className="text-[2.5rem] font-bold tracking-tight text-on-surface leading-tight mb-2">{assignment.title}</h1>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-2">
                  <div className="flex items-center gap-1.5 text-on-surface-variant">
                    <span className="text-sm">Class: {assignment.class?.name || 'Unknown'}</span>
                  </div>
                  <div className="text-sm font-bold text-tertiary">
                    {assignment.due_date ? `Due ${formatDate(assignment.due_date)}` : 'No due date'}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Assignment Body */}
            <div className="space-y-8">
              {assignment.description ? (
                <section>
                  <div className="prose prose-slate max-w-none text-on-surface leading-relaxed text-lg">
                    <p>{assignment.description}</p>
                  </div>
                </section>
              ) : (
                <section className="bg-surface-container-low rounded-xl p-8 text-center">
                  <p className="text-slate-400 italic">No description provided</p>
                </section>
              )}
              
              {/* Attachments */}
              {assignment.attachment_url && (
                <section>
                  <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant mb-6">Attachments</h3>
                  <a className="flex items-center gap-4 p-4 rounded-xl border border-outline-variant hover:bg-surface-container-low transition-all group" href={assignment.attachment_url} target="_blank" rel="noreferrer">
                    <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
                      <span className="material-symbols-outlined text-3xl">description</span>
                    </div>
                    <div className="flex-grow overflow-hidden">
                      <p className="text-sm font-bold text-on-surface truncate">Attachment</p>
                      <p className="text-xs text-on-surface-variant">Click to open</p>
                    </div>
                    <span className="material-symbols-outlined text-outline-variant group-hover:text-primary transition-colors">open_in_new</span>
                  </a>
                </section>
              )}
            </div>
          </div>
          
          {/* Sidebar */}
          <div className="lg:col-span-4 space-y-6">
            {/* Role-specific Sidebar Card */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 sticky top-24">
              {isTeacher ? (
                <>
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-on-surface">Teacher actions</h2>
                    <span className="text-xs font-bold uppercase tracking-widest text-primary">Instructor</span>
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm text-on-surface-variant">
                      Teachers can create and grade assignments. Student turn-in is disabled for teacher accounts.
                    </p>
                    <Link
                      to={`/assignment/${assignment.id}/grade`}
                      className="w-full inline-flex items-center justify-center py-3 px-4 rounded-full signature-gradient text-white font-bold shadow-md hover:shadow-lg transition-all"
                    >
                      Grade submissions
                    </Link>
                    <Link
                      to={`/class/stream?classId=${assignment.class_id}`}
                      className="w-full inline-flex items-center justify-center py-3 px-4 rounded-full border border-outline-variant text-on-surface font-semibold hover:bg-surface-container-low transition-colors"
                    >
                      Back to class stream
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-on-surface">Your work</h2>
                    {hasSubmission ? (
                      <span className="text-xs font-bold uppercase tracking-widest text-secondary">Submitted</span>
                    ) : (
                      <span className="text-xs font-bold uppercase tracking-widest text-tertiary">Assigned</span>
                    )}
                  </div>
                  
                  <div className="space-y-4">
                    {hasSubmission ? (
                      <div data-testid="assignment-submitted-state" className="p-4 bg-secondary/5 rounded-xl border border-secondary/20">
                        <p className="text-sm font-bold text-secondary mb-1">Success!</p>
                        <p className="text-xs text-on-surface-variant">Your work has been turned in.</p>
                        {assignment.submissions?.[0]?.grade !== null && (
                          <div className="mt-4 pt-4 border-t border-secondary/10">
                            <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Grade</p>
                            <p className="text-2xl font-bold text-secondary">{assignment.submissions[0].grade} / 100</p>
                            {assignment.submissions[0].feedback && (
                              <div className="mt-2 p-3 bg-white rounded-lg text-xs italic text-on-surface-variant">
                                "{assignment.submissions[0].feedback}"
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        {submitError && (
                          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
                            {submitError}
                          </div>
                        )}
                        <textarea 
                          data-testid="assignment-submission-input"
                          className="w-full bg-surface-container-high border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary min-h-[120px] resize-none outline-none" 
                          placeholder="Paste your submission link or text here..."
                          value={submissionContent}
                          onChange={(e) => setSubmissionContent(e.target.value)}
                        ></textarea>
                        <button 
                          data-testid="assignment-turnin-button"
                          onClick={handleTurnIn}
                          disabled={!submissionContent.trim() || submitting}
                          className="w-full py-3 px-4 rounded-full signature-gradient text-white font-bold shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2" 
                          type="button"
                        >
                          {submitting ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> : 'Turn in'}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
