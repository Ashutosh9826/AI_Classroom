import React, { useEffect, useRef, useState } from 'react';

export default function TeacherCreateMenu({
  onCreateAssignment,
  onCreateAnnouncement,
  onCreateManualLesson,
  onCreateAiLesson,
  onCreateManualQuiz,
  onCreateAiQuiz,
  disabled = false,
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showLessonOptions, setShowLessonOptions] = useState(false);
  const [showQuizOptions, setShowQuizOptions] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false);
        setShowLessonOptions(false);
        setShowQuizOptions(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setShowLessonOptions(false);
        setShowQuizOptions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const closeMenu = () => {
    setIsOpen(false);
    setShowLessonOptions(false);
    setShowQuizOptions(false);
  };

  const openAssignment = () => {
    closeMenu();
    onCreateAssignment?.();
  };

  const openAnnouncement = () => {
    closeMenu();
    onCreateAnnouncement?.();
  };

  const openManualLesson = () => {
    closeMenu();
    onCreateManualLesson?.();
  };

  const openAiLesson = () => {
    closeMenu();
    onCreateAiLesson?.();
  };

  const openManualQuiz = () => {
    closeMenu();
    onCreateManualQuiz?.();
  };

  const openAiQuiz = () => {
    closeMenu();
    onCreateAiQuiz?.();
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setIsOpen((prev) => !prev);
          if (isOpen) {
            setShowLessonOptions(false);
            setShowQuizOptions(false);
          }
        }}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-white font-semibold shadow hover:shadow-lg transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span className="material-symbols-outlined text-base">add</span>
        <span>Create</span>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-40 w-72 rounded-xl border border-outline-variant/40 bg-white shadow-xl overflow-hidden">
          <button
            type="button"
            onClick={openAssignment}
            className="w-full flex items-center gap-4 px-5 py-4 text-left text-on-surface hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-on-surface-variant">assignment</span>
            <span className="font-semibold">Assignment</span>
          </button>

          <button
            type="button"
            onClick={openAnnouncement}
            className="w-full flex items-center gap-4 px-5 py-4 text-left text-on-surface hover:bg-surface-container-low transition-colors border-t border-outline-variant/30"
          >
            <span className="material-symbols-outlined text-on-surface-variant">campaign</span>
            <span className="font-semibold">Announcement</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowLessonOptions((prev) => !prev);
              setShowQuizOptions(false);
            }}
            className="w-full flex items-center justify-between px-5 py-4 text-left text-on-surface hover:bg-surface-container-low transition-colors border-t border-outline-variant/30"
          >
            <span className="flex items-center gap-4">
              <span className="material-symbols-outlined text-on-surface-variant">auto_stories</span>
              <span className="font-semibold">Lesson</span>
            </span>
            <span className="material-symbols-outlined text-on-surface-variant">
              {showLessonOptions ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {showLessonOptions && (
            <div className="border-t border-outline-variant/30 bg-surface-container-low">
              <button
                type="button"
                onClick={openAiLesson}
                className="w-full flex items-center gap-4 px-5 py-3 text-left text-on-surface hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-on-surface-variant">magic_button</span>
                <span>Lesson with AI</span>
              </button>
              <button
                type="button"
                onClick={openManualLesson}
                className="w-full flex items-center gap-4 px-5 py-3 text-left text-on-surface hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-on-surface-variant">edit_square</span>
                <span>Lesson manually</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setShowQuizOptions((prev) => !prev);
              setShowLessonOptions(false);
            }}
            className="w-full flex items-center justify-between px-5 py-4 text-left text-on-surface hover:bg-surface-container-low transition-colors border-t border-outline-variant/30"
          >
            <span className="flex items-center gap-4">
              <span className="material-symbols-outlined text-on-surface-variant">quiz</span>
              <span className="font-semibold">Quiz</span>
            </span>
            <span className="material-symbols-outlined text-on-surface-variant">
              {showQuizOptions ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {showQuizOptions && (
            <div className="border-t border-outline-variant/30 bg-surface-container-low">
              <button
                type="button"
                onClick={openAiQuiz}
                className="w-full flex items-center gap-4 px-5 py-3 text-left text-on-surface hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-on-surface-variant">magic_button</span>
                <span>Quiz with AI</span>
              </button>
              <button
                type="button"
                onClick={openManualQuiz}
                className="w-full flex items-center gap-4 px-5 py-3 text-left text-on-surface hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-on-surface-variant">edit_square</span>
                <span>Quiz manually</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
