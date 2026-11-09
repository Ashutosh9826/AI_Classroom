import React from 'react';

const TeacherControlPanel = ({ 
  lessonId, 
  socket, 
  isChatLocked, 
  onToggleChat,
  onStartCompetition,
  onShowPodium,
  studentCount = 0,
  understandingPercent = 0
}) => {

  const handleToggleChat = () => {
    if (!socket) return;
    const event = isChatLocked ? 'chat_unlock' : 'chat_lock';
    socket.emit(event, { lessonId });
    onToggleChat(!isChatLocked);
  };

  const handleStartCompetition = () => {
    if (!socket) return;
    socket.emit('start_final_quiz', { lessonId });
    if (onStartCompetition) onStartCompetition();
  };

  const handleShowPodium = () => {
    if (!socket) return;
    socket.emit('show_leaderboard', { lessonId });
    if (onShowPodium) onShowPodium();
  };

  return (
    <div className="fixed bottom-6 left-8 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3 flex items-center gap-6 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[calc(100%-26rem)]">
      
      {/* Session Identity */}
      <div className="flex flex-col border-r border-white/5 pr-5">
        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5 opacity-70">Live Session</span>
        <div className="flex items-center gap-1.5">
           <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
           <span className="text-white font-bold text-xs tracking-tight text-nowrap">Orchestrator</span>
        </div>
      </div>

      {/* Live Sync Controls */}
      <div className="flex items-center gap-2">
        <button 
          onClick={handleStartCompetition}
          className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all shadow-lg shadow-amber-500/20"
        >
          <span className="material-symbols-outlined text-sm">rocket_launch</span>
          COMPETITION
        </button>
        
        <button 
          onClick={handleShowPodium}
          className="flex items-center gap-1 bg-surface text-on-surface hover:bg-surface-container-highest px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border border-outline-variant/30"
        >
          <span className="material-symbols-outlined text-sm">emoji_events</span>
          PODIUM
        </button>
        
        <div className="h-6 w-px bg-outline-variant/30"></div>

        <button 
          onClick={handleToggleChat}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${isChatLocked ? 'bg-error text-white' : 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'}`}
        >
          <span className="material-symbols-outlined text-sm">{isChatLocked ? 'lock' : 'lock_open'}</span>
          {isChatLocked ? 'LOCKED' : 'OPEN'}
        </button>
      </div>

      {/* Analytics Snapshot */}
      <div className="flex items-center gap-4 border-l border-white/5 pl-5">
        <div className="flex items-center gap-1.5 cursor-default">
          <span className="material-symbols-outlined text-emerald-400 text-base">groups</span>
          <span className="text-white font-bold text-sm">{studentCount}</span>
        </div>
        <div className="flex items-center gap-1.5 cursor-default">
           <span className="material-symbols-outlined text-blue-400 text-base">insights</span>
          <span className="text-white font-bold text-sm">{understandingPercent}%</span>
        </div>
      </div>
    </div>
  );
};

export default TeacherControlPanel;
