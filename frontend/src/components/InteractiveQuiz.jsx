import React, { useEffect, useState } from 'react';

export default function InteractiveQuiz({
  block,
  userRole,
  isActive,
  onStart,
  onStop,
  onSubmit,
  results,
  liveEnabled = true,
  isClosed = false,
}) {
  const quizData = typeof block.content === 'string' ? JSON.parse(block.content) : block.content;
  const initialTimeLimit = quizData?.timeLimit || 30;
  const isStaticMode = !liveEnabled || isClosed;

  const [selectedOption, setSelectedOption] = useState(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(initialTimeLimit);

  useEffect(() => {
    if (!isActive || isStaticMode || hasSubmitted) {
      return undefined;
    }

    setTimeLeft(initialTimeLimit);
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [hasSubmitted, initialTimeLimit, isActive, isStaticMode]);

  const handleSelect = (index) => {
    if (userRole === 'TEACHER') return;
    if (hasSubmitted) return;

    if (isStaticMode) {
      if (isClosed) return;
      setSelectedOption(index);
      return;
    }

    if (!isActive || timeLeft === 0) return;
    setSelectedOption(index);
  };

  const handleSubmit = (allowExpired = false) => {
    if (selectedOption === null || hasSubmitted || userRole === 'TEACHER') return;

    if (isStaticMode) {
      if (isClosed) return;
      setHasSubmitted(true);
      return;
    }

    if (timeLeft > 0 || allowExpired) {
      onSubmit(block.id, selectedOption);
      setHasSubmitted(true);
    }
  };

  useEffect(() => {
    if (isStaticMode) return;
    if (timeLeft === 0 && !hasSubmitted && isActive && userRole === 'STUDENT' && selectedOption !== null) {
      onSubmit(block.id, selectedOption);
      setHasSubmitted(true);
    }
  }, [block.id, hasSubmitted, isActive, isStaticMode, onSubmit, selectedOption, timeLeft, userRole]);

  const totalVotes = results ? Object.values(results).reduce((a, b) => a + b, 0) : 0;
  const showAggregates = userRole === 'TEACHER' || hasSubmitted || isClosed;

  const subtitle = () => {
    if (isClosed) return 'MCQ block closed. Live submissions are now disabled.';
    if (userRole === 'TEACHER') {
      return liveEnabled ? 'Control this final MCQ block for the class.' : 'Static MCQ block (not live).';
    }
    if (isStaticMode) {
      return hasSubmitted ? 'Review your response.' : 'Practice at your own pace.';
    }
    if (isActive) {
      return 'Respond now!';
    }
    return hasSubmitted ? 'Submitted.' : 'Waiting for teacher to start.';
  };

  return (
    <div className="relative group my-8">
      {isActive && liveEnabled && !isClosed && (
        <div className="absolute -inset-1 bg-gradient-to-r from-primary to-primary-container rounded-2xl blur opacity-25"></div>
      )}
      <div className={`relative bg-surface-container-lowest p-8 rounded-xl shadow-lg space-y-6 border ${isActive && liveEnabled && !isClosed ? 'border-primary/50' : 'border-outline-variant/30'}`}>

        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <h3 className="text-xl font-bold text-primary flex items-center gap-2">
              <span className="material-symbols-outlined">quiz</span>
              {liveEnabled ? 'Final MCQ Block' : 'MCQ Block'}
            </h3>
            <p className="text-sm text-outline">{subtitle()}</p>
          </div>

          <div className="flex items-center gap-3">
            {liveEnabled && isActive && !isClosed && (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-mono text-lg font-bold ${timeLeft <= 5 ? 'bg-error text-white animate-bounce' : 'bg-primary/10 text-primary'}`}>
                <span className="material-symbols-outlined text-sm">timer</span>
                {timeLeft}s
              </div>
            )}

            {userRole === 'TEACHER' && liveEnabled && !isClosed && (
              <div className="flex items-center gap-2">
                {!isActive ? (
                  <button onClick={() => onStart(block.id)} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md hover:shadow-lg active:scale-95 transition-all flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">play_arrow</span> Start MCQ
                  </button>
                ) : (
                  <button onClick={() => onStop(block.id)} className="bg-error text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md hover:shadow-lg active:scale-95 transition-all flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">stop</span> Finish MCQ
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <p className={`text-lg font-medium text-on-surface ${!isStaticMode && !isActive && userRole === 'STUDENT' && !hasSubmitted ? 'blur-sm select-none' : ''}`}>
          {quizData?.question || 'Untitled Question'}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(quizData?.options || []).map((opt, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const isSelected = selectedOption === idx;
            const votes = results ? results[idx] || 0 : 0;
            const percentage = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
            const showCorrectLabel = isStaticMode || showAggregates;

            return (
              <button
                key={idx}
                onClick={() => handleSelect(idx)}
                disabled={userRole === 'TEACHER' || hasSubmitted || (isStaticMode ? isClosed : !isActive)}
                className={`relative overflow-hidden flex items-center p-4 rounded-lg bg-surface border transition-all text-left group
                  ${isSelected ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-outline-variant hover:border-primary/50'}
                  ${(userRole === 'TEACHER' || hasSubmitted || (isStaticMode ? isClosed : !isActive)) ? 'cursor-default' : 'cursor-pointer hover:bg-primary/5'}
                `}
                type="button"
              >
                {showAggregates && (
                  <div
                    className="absolute left-0 top-0 bottom-0 bg-primary/10 transition-all duration-500 ease-out"
                    style={{ width: `${percentage}%` }}
                  ></div>
                )}

                <span className={`relative z-10 w-8 h-8 flex items-center justify-center rounded-full mr-4 font-bold text-sm transition-colors
                  ${isSelected ? 'bg-primary text-white' : 'bg-surface-container-high group-hover:bg-primary/20'}
                `}>
                  {letter}
                </span>
                <span className={`relative z-10 text-sm font-medium ${!isStaticMode && !isActive && userRole === 'STUDENT' && !hasSubmitted ? 'blur-sm select-none' : ''}`}>
                  {opt.text}
                </span>

                {(showAggregates || showCorrectLabel) && (
                  <div className="relative z-10 ml-auto flex items-center gap-3">
                    {opt.isCorrect && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded uppercase tracking-wider">
                        Correct
                      </span>
                    )}
                    {showAggregates && (
                      <span className="text-xs font-bold text-primary/70">
                        {percentage}% ({votes})
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {userRole === 'STUDENT' && !hasSubmitted && ((isStaticMode && !isClosed) || (!isStaticMode && isActive)) && (
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSubmit}
              disabled={selectedOption === null}
              className="bg-primary text-white px-6 py-2 rounded-full font-bold shadow-md hover:shadow-lg active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 flex items-center gap-2"
            >
              Submit Answer <span className="material-symbols-outlined text-sm">send</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
