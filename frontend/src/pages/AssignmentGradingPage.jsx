import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { assignmentService } from '../services/api';
import useAuthStore from '../store/useAuthStore';

export default function AssignmentGradingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [assignment, setAssignment] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [gradingLoading, setGradingLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

  // Grading form state
  const [grade, setGrade] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (!user || user.role !== 'TEACHER') {
      navigate('/dashboard');
      return;
    }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, navigate]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [assignmentData, submissionsData] = await Promise.all([
        assignmentService.getById(id),
        assignmentService.getSubmissions(id)
      ]);
      setAssignment(assignmentData);
      setSubmissions(submissionsData);
      if (submissionsData.length > 0) {
        handleSelectSubmission(submissionsData[0]);
      }
    } catch (err) {
      console.error('Failed to fetch grading data:', err);
      setError('Failed to load submissions');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSubmission = (sub) => {
    setSelectedSubmission(sub);
    setSaveStatus('');
    const localDraft = localStorage.getItem(`grading-draft:${id}:${sub.id}`);
    if (localDraft) {
      try {
        const parsed = JSON.parse(localDraft);
        setGrade(parsed.grade ?? sub.grade ?? '');
        setFeedback(parsed.feedback ?? sub.feedback ?? '');
        return;
      } catch (e) {
        console.error('Failed to parse grading draft', e);
      }
    }
    setGrade(sub.grade ?? '');
    setFeedback(sub.feedback ?? '');
  };

  const handleSaveGrade = async () => {
    if (!selectedSubmission) return;
    try {
      setGradingLoading(true);
      await assignmentService.grade(selectedSubmission.id, { grade, feedback });
      // Update local state
      setSubmissions(prev => prev.map(s => s.id === selectedSubmission.id ? { ...s, grade: parseFloat(grade), feedback } : s));
      setSelectedSubmission(prev => ({ ...prev, grade: parseFloat(grade), feedback }));
      localStorage.removeItem(`grading-draft:${id}:${selectedSubmission.id}`);
      setSaveStatus('Grade returned to student.');
    } catch (err) {
      console.error('Failed to save grade:', err);
      alert('Failed to save grade');
    } finally {
      setGradingLoading(false);
    }
  };

  const handleSaveDraft = () => {
    if (!selectedSubmission) return;
    const payload = {
      grade,
      feedback,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(`grading-draft:${id}:${selectedSubmission.id}`, JSON.stringify(payload));
    setSaveStatus('Draft saved locally.');
  };

  const filteredSubmissions = submissions.filter((sub) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const name = sub.student?.name?.toLowerCase() || '';
    const email = sub.student?.email?.toLowerCase() || '';
    return name.includes(q) || email.includes(q);
  });

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-surface">Loading submissions...</div>;

  return (
    <div className="bg-surface text-on-surface h-screen flex flex-col overflow-hidden">
      {/* Top Header */}
      <header className="bg-white/80 backdrop-blur-md fixed top-0 w-full z-50 border-b border-slate-100 shadow-sm h-16 flex items-center px-6">
        <div className="flex items-center gap-4 flex-1">
          <button onClick={() => navigate(-1)} className="material-symbols-outlined text-outline hover:bg-surface-container-low p-2 rounded-full transition-colors">arrow_back</button>
          <div className="flex flex-col">
            <h1 className="text-lg font-bold text-slate-900 truncate max-w-md">{assignment?.title}</h1>
            <span className="text-[10px] font-bold text-outline-variant uppercase tracking-wider">Grading Dashboard</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold text-on-surface">{user?.name}</p>
            <p className="text-[10px] text-primary uppercase font-bold tracking-tighter">Teacher</p>
          </div>
          <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold">
            {user?.name?.charAt(0)}
          </div>
        </div>
      </header>

      <main className="flex-1 flex pt-16 overflow-hidden">
        {/* Left Sidebar: Students */}
        <aside className="w-80 flex-shrink-0 bg-surface-container-low border-r border-outline-variant/15 flex flex-col">
          <div className="p-4 border-b border-outline-variant/15">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-outline-variant uppercase tracking-widest">{submissions.length} Submissions</span>
            </div>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-sm">search</span>
              <input 
                className="w-full bg-white border-none rounded-xl pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-primary transition-all outline-none" 
                placeholder="Search students..." 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-1">
            {filteredSubmissions.map(sub => (
              <div 
                key={sub.id} 
                onClick={() => handleSelectSubmission(sub)}
                className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-all ${selectedSubmission?.id === sub.id ? 'bg-white shadow-sm ring-1 ring-primary/10' : 'hover:bg-white/50'}`}
              >
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                  {sub.student?.name?.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{sub.student?.name}</p>
                  <p className={`text-[10px] font-bold uppercase tracking-tighter ${sub.grade !== null ? 'text-secondary' : 'text-tertiary'}`}>
                    {sub.grade !== null ? `Graded: ${sub.grade}/100` : 'Turned In'}
                  </p>
                </div>
                {sub.grade !== null && <span className="material-symbols-outlined text-secondary text-sm">check_circle</span>}
              </div>
            ))}
            {submissions.length === 0 && <div className="p-8 text-center text-xs text-outline-variant italic">No submissions yet</div>}
            {submissions.length > 0 && filteredSubmissions.length === 0 && (
              <div className="p-8 text-center text-xs text-outline-variant italic">No students match that search.</div>
            )}
          </div>
        </aside>

        {/* Center Content: View Submission */}
        <section className="flex-1 bg-surface-dim/10 overflow-y-auto p-8 flex flex-col items-center">
          {selectedSubmission ? (
            <div className="max-w-4xl w-full bg-white shadow-xl rounded-2xl min-h-[800px] flex flex-col relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-1.5 signature-gradient"></div>
               <div className="p-12 space-y-8">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <h2 className="text-3xl font-bold text-on-surface">{selectedSubmission.student?.name}'s Submission</h2>
                      <p className="text-sm text-outline-variant">Submitted on {new Date(selectedSubmission.submitted_at).toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-8 min-h-[400px]">
                    {selectedSubmission.file_url ? (
                       <div className="space-y-4">
                          <p className="text-on-surface-variant leading-relaxed">
                            {selectedSubmission.file_url}
                          </p>
                          <div className="p-4 bg-primary/5 rounded-xl border border-primary/20 flex items-center gap-3">
                            <span className="material-symbols-outlined text-primary">description</span>
                            <div className="flex-1">
                               <p className="text-sm font-bold text-on-surface">Attached Document</p>
                               <p className="text-xs text-outline-variant">Student submitted a text/link document.</p>
                            </div>
                            <a href={selectedSubmission.file_url} target="_blank" rel="noreferrer" className="text-primary font-bold text-xs hover:underline">Open Link</a>
                          </div>
                       </div>
                    ) : (
                      <p className="text-outline-variant italic">No content provided in this submission.</p>
                    )}
                  </div>
               </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-outline-variant gap-4">
               <span className="material-symbols-outlined text-6xl opacity-20">assignment_turned_in</span>
               <p className="font-medium">Select a student to view their submission</p>
            </div>
          )}
        </section>

        {/* Right Sidebar: Grading */}
        <aside className="w-80 flex-shrink-0 bg-white border-l border-outline-variant/15 flex flex-col p-6 gap-8">
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold text-outline-variant uppercase tracking-widest">Grading</h3>
            <div className="flex items-end gap-3">
              <div className="relative flex-1">
                <label className="text-[10px] font-bold text-primary uppercase absolute -top-2.5 left-2 bg-white px-1">Score</label>
                <input 
                  className="w-full text-3xl font-bold border-b-2 border-primary focus:border-primary-container focus:ring-0 p-2 bg-transparent outline-none transition-colors" 
                  type="number" 
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  placeholder="--"
                />
              </div>
              <span className="text-2xl font-bold text-outline-variant pb-2">/ 100</span>
            </div>
          </div>

          <div className="space-y-4 flex-1 flex flex-col">
            <h3 className="text-[10px] font-bold text-outline-variant uppercase tracking-widest">Private Feedback</h3>
            <div className="flex-1 flex flex-col">
              <textarea 
                className="w-full bg-surface-container-high border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary min-h-[200px] resize-none outline-none" 
                placeholder="Write feedback for the student..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              ></textarea>
            </div>
          </div>

          <div className="pt-6 border-t border-outline-variant/15 flex flex-col gap-3">
            <button 
              onClick={handleSaveGrade}
              disabled={!selectedSubmission || gradingLoading}
              className="w-full py-4 rounded-full signature-gradient text-white font-bold shadow-lg hover:shadow-xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {gradingLoading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> : 'Return to Student'}
            </button>
            <button
              onClick={handleSaveDraft}
              className="w-full py-3 rounded-full text-outline-variant font-bold text-sm hover:bg-surface-container-high transition-colors"
              disabled={!selectedSubmission}
            >
              Save Draft
            </button>
            {(saveStatus || error) && (
              <p className={`text-xs text-center ${error ? 'text-error' : 'text-outline'}`}>
                {error || saveStatus}
              </p>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
