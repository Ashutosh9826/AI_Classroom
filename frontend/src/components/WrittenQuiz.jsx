import React, { useState } from 'react';
import { chatService } from '../services/api';

export default function WrittenQuiz({ block, userRole }) {
  const quizData = typeof block.content === 'string' ? JSON.parse(block.content) : block.content;
  
  const [answer, setAnswer] = useState('');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState(null);

  const handleSubmit = async () => {
    if (!answer.trim() || hasSubmitted || userRole === 'TEACHER') return;
    
    setHasSubmitted(true);
    setEvaluating(true);
    
    try {
      const result = await chatService.evaluateAnswer(quizData.question, quizData.idealAnswer, answer);
      setFeedback(result.feedback);
      setScore(result.score);
      
    } catch (err) {
      console.error(err);
      setFeedback('Failed to evaluate answer. Please inform your teacher.');
      setScore(0);
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <div className="relative group my-8">
      <div className="relative bg-surface-container-lowest p-8 rounded-xl shadow-lg space-y-6 border border-outline-variant/30">
        
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <h3 className="text-xl font-bold text-amber-600 flex items-center gap-2">
              <span className="material-symbols-outlined">edit_document</span>
              Written Question Block
            </h3>
            <p className="text-sm text-outline">
              {userRole === 'TEACHER' 
                ? 'This is a self-paced exercise for students.' 
                : evaluating
                  ? 'AI is evaluating...'
                  : hasSubmitted 
                    ? 'Evaluated.' 
                    : 'Take your time to write your answer.'}
            </p>
          </div>
        </div>

        <p className={`text-lg font-medium text-on-surface`}>
          {quizData?.question || 'Untitled Question'}
        </p>

        {userRole === 'STUDENT' && (
          <div className="space-y-4">
            <textarea
              className={`w-full text-base bg-surface-container-low rounded-lg p-4 resize-y outline-none border transition-all ${
                !hasSubmitted ? 'border-amber-500/50 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/20' : 'border-outline-variant opacity-70'
              }`}
              placeholder="Write your answer..."
              rows={4}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              disabled={hasSubmitted || evaluating}
            />
            {!hasSubmitted && !evaluating && (
              <div className="flex justify-end pt-2">
                <button 
                  onClick={handleSubmit} 
                  disabled={!answer.trim()}
                  className="bg-amber-600 text-white px-6 py-2 rounded-full font-bold shadow-md hover:shadow-lg active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 flex items-center gap-2"
                >
                  Submit Answer <span className="material-symbols-outlined text-sm">send</span>
                </button>
              </div>
            )}
            
            {evaluating && (
              <div className="flex items-center gap-3 text-amber-600 font-bold p-4 bg-amber-50/10 rounded-lg animate-pulse">
                <span className="material-symbols-outlined animate-spin">sync</span>
                AI grading in progress...
              </div>
            )}

            {hasSubmitted && !evaluating && (
              <div className="mt-4 p-6 rounded-xl border border-amber-500/30 bg-surface-container-low">
                 <div className="flex items-center gap-4 mb-4 pb-4 border-b border-outline-variant/20">
                    <div className="text-4xl font-black text-amber-600">{score}/10</div>
                    <div>
                      <h4 className="font-bold text-on-surface">AI Evaluation Score</h4>
                      <p className="text-xs text-outline uppercase tracking-widest">Written block complete</p>
                    </div>
                 </div>
                 <div className="text-sm text-on-surface-variant whitespace-pre-wrap leading-relaxed mb-4">
                   {feedback}
                 </div>
                 <div className="p-4 bg-emerald-500/5 rounded-lg border border-emerald-500/20">
                   <h4 className="text-xs text-emerald-600 uppercase tracking-widest font-bold mb-2 flex items-center gap-1">
                     <span className="material-symbols-outlined text-sm">check_circle</span> Ideal Answer
                   </h4>
                   <p className="text-sm text-on-surface-variant italic whitespace-pre-wrap">{quizData?.idealAnswer || 'No ideal answer provided.'}</p>
                 </div>
                 <div className="flex justify-end mt-4">
                   <button 
                     onClick={() => {
                       setHasSubmitted(false);
                       setFeedback(null);
                       setScore(null);
                     }}
                     className="flex items-center gap-1 text-sm font-semibold text-amber-600 hover:bg-amber-500/10 px-4 py-2 rounded-lg transition-colors"
                   >
                     <span className="material-symbols-outlined text-sm">refresh</span>
                     Re-evaluate
                   </button>
                 </div>
              </div>
            )}
          </div>
        )}

        {userRole === 'TEACHER' && (
          <div className="p-4 bg-surface-container-low rounded-lg border border-outline-variant border-dashed">
             <h4 className="text-xs text-outline uppercase tracking-widest font-bold mb-2">Ideal Answer (Hidden from students)</h4>
             <p className="text-sm text-on-surface-variant italic">{quizData?.idealAnswer || 'No ideal answer provided.'}</p>
          </div>
        )}

      </div>
    </div>
  );
}
