import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

export default function ChatAssistant({ messages, onSendMessage, onStopGeneration, isLocked, user }) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (inputValue.trim() && !isLocked) {
      onSendMessage(inputValue);
      setInputValue('');
    }
  };

  const handleQuickPrompt = (text) => {
    if (!isLocked) {
      onSendMessage(text);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface-container-low">
      {/* Assistant Header */}
      <div className="p-6 border-b border-surface-container flex items-center gap-4 bg-surface-container-lowest">
        <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-white">
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
        </div>
        <div>
          <h2 className="text-sm font-bold text-on-surface">Atelier Assistant</h2>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-secondary"></span>
            <span className="text-[0.7rem] font-semibold text-secondary uppercase tracking-widest">Active Now</span>
          </div>
        </div>
      </div>
      
      {/* Chat Messages Container */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 w-full ${msg.sender === user?.name ? 'justify-end' : 'justify-start'}`}>
            {msg.sender !== user?.name && (
              <div className={`w-8 h-8 shrink-0 mt-1 rounded-lg ${msg.role === 'SYSTEM' ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'} flex items-center justify-center`}>
                <span className="material-symbols-outlined text-sm">{msg.role === 'SYSTEM' ? 'auto_awesome' : 'person'}</span>
              </div>
            )}
            <div className="flex flex-col gap-1 max-w-[85%]">
              <div className={`${msg.sender === user?.name ? 'bg-primary text-white rounded-tr-none' : 'bg-surface-container-lowest border border-outline-variant/10 rounded-tl-none'} p-4 rounded-2xl shadow-sm text-sm leading-relaxed overflow-hidden`}>
                {msg.sender !== user?.name && <div className="text-xs opacity-70 mb-2 font-bold">{msg.sender}</div>}
                
                {msg.usedWebContext && (
                  <div className="flex items-center gap-1.5 mb-3 px-2 py-1 bg-surface-container border border-outline-variant/20 rounded max-w-fit">
                    <span className="material-symbols-outlined text-[12px] text-secondary">travel_explore</span>
                    <span className="text-[10px] uppercase tracking-widest font-bold text-secondary">Web Researched</span>
                  </div>
                )}
                
                {msg.sender === user?.name || msg.role === 'SYSTEM' ? (
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                ) : (
                  <div className="prose prose-sm prose-slate max-w-none break-words dark:prose-invert">
                    <ReactMarkdown>{msg.text || ' '}</ReactMarkdown>
                  </div>
                )}

                {msg.isGenerating && (
                  <div className="flex items-center gap-3 mt-3 pt-3 border-t border-outline-variant/10">
                    <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin"></div>
                    <span className="text-xs font-semibold text-primary animate-pulse">{msg.status || 'Thinking...'}</span>
                    {onStopGeneration && (
                      <button
                        onClick={onStopGeneration}
                        className="ml-auto text-[10px] px-2 py-1 rounded bg-error/10 text-error hover:bg-error hover:text-white font-bold transition-colors cursor-pointer"
                      >
                        STOP
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      {/* Input Area */}
      <div className="p-4 bg-white border-t border-slate-100">
        <div className="flex gap-2 mb-3">
          <button 
            disabled={isLocked}
            onClick={() => handleQuickPrompt("Explain this formula")}
            className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-50"
          >
            Explain Formula
          </button>
          <button 
            disabled={isLocked}
            onClick={() => handleQuickPrompt("Summarize this section")}
            className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-50"
          >
            Summarize
          </button>
        </div>
        <div className="relative">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            disabled={isLocked}
            placeholder={isLocked ? "Chat is locked by teacher..." : "Ask your AI tutor..."}
            className={`w-full bg-slate-50 border-none rounded-xl pl-4 pr-12 py-3 text-sm focus:ring-2 focus:ring-primary outline-none transition-all ${isLocked ? 'cursor-not-allowed text-slate-400' : ''}`}
          />
          <button 
            onClick={handleSend}
            disabled={isLocked || !inputValue.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-30"
          >
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
