import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import useAuthStore from '../store/useAuthStore';
import { API_BASE_URL, chatService, lessonService, notesService, SOCKET_BASE_URL } from '../services/api';
import ChatAssistant from '../components/ChatAssistant';
import InteractiveQuiz from '../components/InteractiveQuiz';
import WrittenQuiz from '../components/WrittenQuiz';
import InteractiveSimulationBlock from '../components/InteractiveSimulationBlock';
import CodeNotebookBlock from '../components/CodeNotebookBlock';
import TeacherControlPanel from '../components/TeacherControlPanel';
import MermaidBlock from '../components/MermaidBlock';
import StaticChartBlock from '../components/StaticChartBlock';
import TextbookContentBlock from '../components/TextbookContentBlock';
import { classifyRequestError, isRequestCanceled } from '../utils/requestError';
import {
  buildImagePayloadKey,
  formatBytes,
  isImageLikeFile,
  readImageFileAsBase64Payload,
  REFINE_IMAGE_ACCEPT,
  REFINE_MAX_IMAGES,
  REFINE_MAX_IMAGE_BYTES,
  REFINE_MAX_IMAGE_TOTAL_BYTES,
} from '../utils/refineImageAttachments';

const SOCKET_URL = SOCKET_BASE_URL;

const parseJsonObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const DEFAULT_SIMULATION_FILES = {
  '/App.js': `import React, { useState } from "react";
import "./styles.css";

export default function App() {
  const [value, setValue] = useState(50);

  return (
    <main className="sim-root">
      <h1>My Simulation</h1>
      <p>Move the slider to inspect state changes.</p>
      <input type="range" min="0" max="100" value={value} onChange={(event) => setValue(Number(event.target.value))} />
      <p>Current value: <strong>{value}</strong></p>
    </main>
  );
}
`,
  '/styles.css': `body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #f8fafc; color: #0f172a; }
.sim-root { padding: 16px; max-width: 760px; margin: 0 auto; }`,
};

const sanitizeSimulationFiles = (files) => {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    return null;
  }

  const entries = Object.entries(files).reduce((acc, [path, source]) => {
    if (typeof path !== 'string' || !path.startsWith('/')) return acc;
    acc[path] = typeof source === 'string' ? source : String(source ?? '');
    return acc;
  }, {});

  return Object.keys(entries).length > 0 ? entries : null;
};

const appendTagIfMissing = (html, regex, tagMarkup) => {
  if (regex.test(html)) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tagMarkup}\n</body>`);
  return `${html}\n${tagMarkup}`;
};

const legacySimulationToFiles = (legacy) => {
  const html =
    typeof legacy?.html === 'string' && legacy.html.trim()
      ? legacy.html
      : '<main id="app"></main>';
  const css = typeof legacy?.css === 'string' ? legacy.css : '';
  const js =
    typeof legacy?.js === 'string' && legacy.js.trim()
      ? legacy.js
      : 'const app = document.getElementById("app");\napp.innerHTML = "<p>Build your simulation here.</p>";';

  let indexHtml = html;
  if (!/<html[\s>]/i.test(indexHtml)) {
    indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    ${indexHtml}
    <script src="/index.js"></script>
  </body>
</html>`;
  } else {
    indexHtml = appendTagIfMissing(
      indexHtml,
      /<link[^>]+href=["']\/styles\.css["']/i,
      '<link rel="stylesheet" href="/styles.css" />'
    );
    indexHtml = appendTagIfMissing(
      indexHtml,
      /<script[^>]+src=["']\/index\.js["']/i,
      '<script src="/index.js"></script>'
    );
  }

  return {
    '/index.html': indexHtml,
    '/styles.css': css,
    '/index.js': js,
  };
};

const normalizeSimulationContent = (raw) => {
  const parsed = parseJsonObject(raw) || {};
  const directFiles = sanitizeSimulationFiles(parsed.files);
  if (directFiles) {
    return {
      title: typeof parsed.title === 'string' ? parsed.title : 'Interactive Simulation',
      description: typeof parsed.description === 'string' ? parsed.description : '',
      hint: typeof parsed.hint === 'string' ? parsed.hint : '',
      solutionText: typeof parsed.solutionText === 'string' ? parsed.solutionText : '',
      template: parsed.template === 'vanilla' ? 'vanilla' : 'react',
      files: directFiles,
    };
  }

  const legacySandbox =
    parsed.canvasSandbox && typeof parsed.canvasSandbox === 'object' ? parsed.canvasSandbox : null;
  const legacyFiles = legacySimulationToFiles(legacySandbox || parsed);

  return {
    title: typeof parsed.title === 'string' ? parsed.title : 'Interactive Simulation',
    description: typeof parsed.description === 'string' ? parsed.description : '',
    hint: typeof parsed.hint === 'string' ? parsed.hint : '',
    solutionText: typeof parsed.solutionText === 'string' ? parsed.solutionText : '',
    template: 'vanilla',
    files: legacyFiles,
  };
};

const normalizeCodeContent = (raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }

  if (typeof raw !== 'string') {
    return '';
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Keep legacy string code blocks as-is.
    }
  }

  return raw;
};

const normalizeLessonBlock = (block) => {
  if (block.type === 'INTERACTIVE_SIMULATION') {
    return { ...block, content: normalizeSimulationContent(block.content) };
  }

  if (block.type === 'QUIZ' || block.type === 'EXERCISE' || block.type === 'WRITTEN_QUIZ') {
    return {
      ...block,
      content: parseJsonObject(block.content) || {},
    };
  }

  if (block.type === 'CODE') {
    return {
      ...block,
      content: normalizeCodeContent(block.content),
    };
  }

  if (block.type === 'MERMAID_DIAGRAM' || block.type === 'STATIC_CHART') {
    return {
      ...block,
      content: parseJsonObject(block.content) || {},
    };
  }

  return block;
};

const defaultPersonalSimulationContent = () => ({
  title: 'My Simulation',
  description: 'Personal interactive simulation block.',
  hint: '',
  solutionText: '',
  template: 'react',
  files: { ...DEFAULT_SIMULATION_FILES },
});

const getDefaultPersonalBlockContent = (type) => {
  if (type === 'TEXT') return '';
  if (type === 'CODE') return { defaultLanguage: 'javascript', code: '' };
  if (type === 'INTERACTIVE_SIMULATION') return defaultPersonalSimulationContent();
  return '';
};

const normalizePersonalBlock = (block) => {
  const normalized = normalizeLessonBlock(block);
  return {
    ...normalized,
    isPersonal: true,
  };
};

const mergeOfficialAndPersonalBlocks = (officialBlocks = [], personalBlocks = []) => {
  const official = officialBlocks.map((block) => ({ ...block, isPersonal: false }));
  const personal = [...personalBlocks].sort((a, b) => {
    const orderDelta = (a.order_index || 0) - (b.order_index || 0);
    if (orderDelta !== 0) return orderDelta;
    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
  });

  const personalIds = new Set(personal.map((block) => block.id));
  const anchorableIds = new Set([...official.map((block) => block.id), ...personalIds]);
  const groupedByAnchor = new Map();
  const floating = [];

  personal.forEach((block) => {
    const anchorId = block.after_block_id;
    if (anchorId && anchorableIds.has(anchorId)) {
      const existing = groupedByAnchor.get(anchorId) || [];
      existing.push(block);
      groupedByAnchor.set(anchorId, existing);
    } else {
      floating.push(block);
    }
  });

  const merged = [];
  const insertedPersonalIds = new Set();

  const appendAnchoredChildren = (anchorId, trail = new Set()) => {
    const anchored = groupedByAnchor.get(anchorId) || [];
    anchored.forEach((personalBlock) => {
      if (insertedPersonalIds.has(personalBlock.id)) return;
      if (trail.has(personalBlock.id)) {
        floating.push(personalBlock);
        return;
      }

      insertedPersonalIds.add(personalBlock.id);
      merged.push(personalBlock);
      appendAnchoredChildren(personalBlock.id, new Set([...trail, personalBlock.id]));
    });
  };

  official.forEach((block) => {
    merged.push(block);
    appendAnchoredChildren(block.id, new Set([block.id]));
  });

  floating.forEach((personalBlock) => {
    if (insertedPersonalIds.has(personalBlock.id)) return;
    insertedPersonalIds.add(personalBlock.id);
    merged.push(personalBlock);
    appendAnchoredChildren(personalBlock.id, new Set([personalBlock.id]));
  });

  personal.forEach((personalBlock) => {
    if (insertedPersonalIds.has(personalBlock.id)) return;
    insertedPersonalIds.add(personalBlock.id);
    merged.push(personalBlock);
    appendAnchoredChildren(personalBlock.id, new Set([personalBlock.id]));
  });

  return merged;
};

const groupNotesByBlockId = (notes = []) =>
  notes.reduce((acc, note) => {
    const blockId = note.block_id;
    if (!acc[blockId]) acc[blockId] = [];
    acc[blockId].push(note);
    return acc;
  }, {});

export default function LiveLessonView() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const lessonId = searchParams.get('lessonId');

  const [lesson, setLesson] = useState(null);
  const [personalBlocks, setPersonalBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // AI Chat state
  const [messages, setMessages] = useState([
    { id: 1, sender: 'System', role: 'SYSTEM', text: 'Welcome! I am your AI assistant. How can I help you today?' }
  ]);
  const [isChatLocked, setIsChatLocked] = useState(false); // 2. Add isChatLocked state
  
  // Quiz State via Sockets
  // activeQuizzes: { [blockId]: true/false }
  const [activeQuizzes, setActiveQuizzes] = useState({});
  // quizResults: { [blockId]: { [optionIdx]: count } }
  const [quizResults, setQuizResults] = useState({});
  // Code execution is now self-contained within CodeNotebookBlock (sandboxed iframe)
  const [exerciseStates, setExerciseStates] = useState({}); // { [blockId]: { selectedIndex, submitted: boolean } }
  const [leaderboard, setLeaderboard] = useState({}); // { [userId]: { name, score, count } }
  const [quizPhase, setQuizPhase] = useState('CONTENT'); // 'CONTENT', 'COMPETITION', 'RANKING'
  const [showLeaderboardSidebar, setShowLeaderboardSidebar] = useState(false);
  const [finalQuizClosed, setFinalQuizClosed] = useState(false);
  const [dirtyPersonalBlocks, setDirtyPersonalBlocks] = useState({});
  const [savingPersonalBlocks, setSavingPersonalBlocks] = useState({});
  const [noteComposerOpen, setNoteComposerOpen] = useState({});
  const [newNoteContentByBlock, setNewNoteContentByBlock] = useState({});
  const [notesByBlock, setNotesByBlock] = useState({});
  const [personalAiTargetBlockId, setPersonalAiTargetBlockId] = useState(null);
  const [personalAiInstructions, setPersonalAiInstructions] = useState('');
  const [personalAiLoading, setPersonalAiLoading] = useState(false);
  const [personalAiTimer, setPersonalAiTimer] = useState(0);
  const [personalAiReferenceImages, setPersonalAiReferenceImages] = useState([]);
  const [personalAiReferenceImagesLoading, setPersonalAiReferenceImagesLoading] = useState(false);
  const [personalAiReferenceDropActive, setPersonalAiReferenceDropActive] = useState(false);
  const [personalAiError, setPersonalAiError] = useState('');

  const [studentCount, setStudentCount] = useState(1);
  const [understandingPercent, setUnderstandingPercent] = useState(100);

  const socketRef = useRef(null);
  const finalQuizBlockIdRef = useRef(null);
  const chatAbortControllerRef = useRef(null);
  const personalAiAbortControllerRef = useRef(null);
  const personalAiImageInputRef = useRef(null);

  // Resize State for Right Sidebar
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const isResizingRef = useRef(false);

  useEffect(() => {
    let interval;
    if (personalAiLoading) {
      setPersonalAiTimer(0);
      interval = setInterval(() => {
        setPersonalAiTimer((prev) => prev + 1);
      }, 1000);
    } else {
      setPersonalAiTimer(0);
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [personalAiLoading]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 280 && newWidth < Math.min(1000, window.innerWidth - 300)) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleSidebarMouseDown = () => {
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const finalQuizBlockId = useMemo(() => {
    const officialQuizBlocks = (lesson?.blocks || []).filter((block) => block.type === 'QUIZ');
    if (officialQuizBlocks.length === 0) return null;
    return officialQuizBlocks[officialQuizBlocks.length - 1].id;
  }, [lesson?.blocks]);
  const hasLiveQuiz = Boolean(finalQuizBlockId);

  const visibleBlocks = useMemo(
    () => mergeOfficialAndPersonalBlocks(lesson?.blocks || [], personalBlocks),
    [lesson?.blocks, personalBlocks]
  );
  const aiTargetPersonalBlock = useMemo(
    () =>
      personalAiTargetBlockId
        ? personalBlocks.find((block) => block.id === personalAiTargetBlockId) || null
        : null,
    [personalAiTargetBlockId, personalBlocks]
  );

  useEffect(() => {
    finalQuizBlockIdRef.current = finalQuizBlockId;
  }, [finalQuizBlockId]);

  useEffect(() => {
    setFinalQuizClosed(false);
  }, [finalQuizBlockId, lessonId]);

  useEffect(() => {
    if (!hasLiveQuiz && showLeaderboardSidebar) {
      setShowLeaderboardSidebar(false);
    }
  }, [hasLiveQuiz, showLeaderboardSidebar]);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (!lessonId) {
      navigate('/dashboard');
      return;
    }

    // 1. Fetch Lesson Data
    const fetchLesson = async () => {
      try {
        const data = await lessonService.getById(lessonId);
        if (data.blocks) {
          data.blocks = data.blocks.map(normalizeLessonBlock);
        }
        setLesson(data);

        if (user?.role === 'STUDENT') {
          const [personalResult, notesResult] = await Promise.allSettled([
            lessonService.getPersonalBlocks(lessonId),
            notesService.list(lessonId),
          ]);

          if (personalResult.status === 'fulfilled') {
            setPersonalBlocks((personalResult.value || []).map(normalizePersonalBlock));
          } else {
            console.error('Failed to load personal blocks:', personalResult.reason);
            setPersonalBlocks([]);
          }

          if (notesResult.status === 'fulfilled') {
            setNotesByBlock(groupNotesByBlockId(notesResult.value || []));
          } else {
            console.error('Failed to load notes:', notesResult.reason);
            setNotesByBlock({});
          }
        } else {
          setPersonalBlocks([]);
          setNotesByBlock({});
        }
      } catch (err) {
        console.error('Failed to load lesson:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLesson();

    // 2. Setup Socket
    socketRef.current = io(SOCKET_URL);

    socketRef.current.on('connect', () => {
      // Connection log removed
      socketRef.current.emit('join_lesson', lessonId);
    });

    socketRef.current.on('quiz_started', (data) => {
      const finalQuizId = finalQuizBlockIdRef.current;
      if (data.lessonId === lessonId && finalQuizId && data.blockId === finalQuizId) {
        setActiveQuizzes(prev => ({ ...prev, [data.blockId]: true }));
        setFinalQuizClosed(false);
      }
    });

    socketRef.current.on('quiz_stopped', (data) => {
      const finalQuizId = finalQuizBlockIdRef.current;
      if (data.lessonId === lessonId && finalQuizId && data.blockId === finalQuizId) {
        setActiveQuizzes(prev => ({ ...prev, [data.blockId]: false }));
        setFinalQuizClosed(true);
      }
    });

    socketRef.current.on('answer_received', (data) => {
      const finalQuizId = finalQuizBlockIdRef.current;
      if (data.lessonId === lessonId && finalQuizId && data.blockId === finalQuizId) {
        // Update vote counts
        setQuizResults(prev => {
          const currentBlockResults = prev[data.blockId] || {};
          const currentCount = currentBlockResults[data.optionIndex] || 0;
          return {
            ...prev,
            [data.blockId]: {
              ...currentBlockResults,
              [data.optionIndex]: currentCount + 1
            }
          };
        });

        // Update competitive leaderboard
        if (data.score > 0 && data.userId) {
          setLeaderboard(prev => {
            const current = prev[data.userId] || { name: data.userName, score: 0, count: 0 };
            return {
              ...prev,
              [data.userId]: {
                ...current,
                score: current.score + data.score,
                count: current.count + 1
              }
            };
          });
        }
      }
    });

    // 2. Add socket listeners for chat lock/unlock
    socketRef.current.on('chat_locked', () => {
      setIsChatLocked(true);
    });

    socketRef.current.on('chat_unlocked', () => {
      setIsChatLocked(false);
    });

    socketRef.current.on('attendance_updated', (data) => {
      setStudentCount(data.count);
    });

    socketRef.current.on('start_final_quiz', () => {
      if (!finalQuizBlockIdRef.current) return;
      setQuizPhase('WAITING');
      // Auto-transition to competition after some hype?
      setTimeout(() => setQuizPhase('CONTENT'), 3000); 
    });

    socketRef.current.on('show_leaderboard', () => {
      if (!finalQuizBlockIdRef.current) return;
      setQuizPhase('RANKING');
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, [lessonId, user, navigate]);

  useEffect(() => {
    const socket = socketRef.current;
    const classId = lesson?.class_id;
    if (!socket || !classId || !user?.id) return undefined;

    const joinPayload = {
      classId,
      userId: user.id,
      role: user.role,
    };

    const handleConnect = () => {
      socket.emit('join_class_presence', joinPayload);
    };

    socket.on('connect', handleConnect);
    if (socket.connected) {
      handleConnect();
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.emit('leave_class_presence', {
        classId,
        userId: user.id,
      });
    };
  }, [lesson?.class_id, user?.id, user?.role]);

  // Recalculate understanding percent
  useEffect(() => {
    let totalAnswers = 0;
    let correctAnswers = 0;

    if (lesson && lesson.blocks) {
      lesson.blocks.forEach(block => {
        if (block.type === 'QUIZ' && quizResults[block.id]) {
          const qData = typeof block.content === 'string' ? JSON.parse(block.content) : block.content;
          const correctIdx = qData.options?.findIndex(o => o.isCorrect);
          
          Object.entries(quizResults[block.id]).forEach(([optIdx, count]) => {
            totalAnswers += count;
            if (parseInt(optIdx) === correctIdx) {
              correctAnswers += count;
            }
          });
        }
      });
    }

    if (totalAnswers > 0) {
      setUnderstandingPercent(Math.round((correctAnswers / totalAnswers) * 100));
    } else {
      setUnderstandingPercent(100);
    }
  }, [quizResults, lesson]);

  // Chat Actions
  const handleStopChatGeneration = () => {
    if (chatAbortControllerRef.current) {
      chatAbortControllerRef.current.abort();
      chatAbortControllerRef.current = null;
    }
  };

  const handleSendMessage = async (text) => {
    if (!text.trim() || !user || isChatLocked) return; // Prevent sending if chat is locked

    const msgData = {
      id: Date.now(),
      lessonId,
      sender: user.name,
      role: 'USER',
      text: text,
    };

    const updatedMessages = [...messages, msgData];
    const assistantMsgId = Date.now() + 1;
    
    setMessages([...updatedMessages, {
      id: assistantMsgId,
      sender: 'Atelier Assistant',
      role: 'ASSISTANT',
      text: '',
      isGenerating: true,
      status: 'Connecting...'
    }]);
    
    chatAbortControllerRef.current = new AbortController();

    try {
      const stream = chatService.sendMessageStream(lessonId, updatedMessages, { 
        signal: chatAbortControllerRef.current.signal 
      });
      
      for await (const chunk of stream) {
        if (chunk.type === 'status') {
          setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, status: chunk.message } : m));
        } else if (chunk.type === 'result') {
          setMessages(prev => prev.map(m => m.id === assistantMsgId ? { 
            ...m, 
            isGenerating: false, 
            status: null,
            text: chunk.text,
            usedWebContext: chunk.usedWebContext,
            webContext: chunk.webContext
          } : m));
        } else if (chunk.type === 'error') {
          throw new Error(chunk.message);
        }
      }
    } catch (err) {
      console.error('AI Chat Stream Error:', err);
      const isAbort = isRequestCanceled(err);
      const classified = classifyRequestError(err, {
        apiBaseUrl: API_BASE_URL,
        fallbackMessage: 'Sorry, the AI Assistant encountered an error.',
        timeoutMessage: 'Chat request timed out. Please retry.',
      });
      setMessages((prev) => prev.map(m => m.id === assistantMsgId ? {
        ...m,
        isGenerating: false,
        status: null,
        text: isAbort ? '(Generation stopped)' : classified.message
      } : m));
    } finally {
      chatAbortControllerRef.current = null;
    }
  };

  // Quiz Actions
  const handleStartQuiz = (blockId) => {
    if (!finalQuizBlockId || blockId !== finalQuizBlockId || finalQuizClosed) return;
    const block = lesson?.blocks.find(b => b.id === blockId);
    const qData = typeof block?.content === 'string' ? JSON.parse(block.content) : block?.content;
    const timeLimit = qData?.timeLimit || 30;

    socketRef.current.emit('start_quiz', { lessonId, blockId, timeLimit });
    setActiveQuizzes(prev => ({ ...prev, [blockId]: true }));
    setFinalQuizClosed(false);
  };

  const handleStopQuiz = (blockId) => {
    if (!finalQuizBlockId || blockId !== finalQuizBlockId) return;
    socketRef.current.emit('stop_quiz', { lessonId, blockId });
    setActiveQuizzes(prev => ({ ...prev, [blockId]: false }));
    setFinalQuizClosed(true);
  };

  const handleSubmitAnswer = (blockId, optionIndex) => {
    if (!finalQuizBlockId || blockId !== finalQuizBlockId || finalQuizClosed) return;
    socketRef.current.emit('submit_answer', { 
      lessonId, 
      blockId, 
      optionIndex, 
      userId: user.id, 
      userName: user.name 
    });
  };

  const handleLiveCodeChange = (blockId, nextContent) => {
    setLesson((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        blocks: (prev.blocks || []).map((block) =>
          block.id === blockId ? { ...block, content: nextContent } : block
        ),
      };
    });
  };

  const handlePersonalBlockChange = (blockId, nextContent) => {
    setPersonalBlocks((prev) =>
      prev.map((block) => (block.id === blockId ? { ...block, content: nextContent } : block))
    );
    setDirtyPersonalBlocks((prev) => ({ ...prev, [blockId]: true }));
  };

  const handleCreatePersonalBlock = async (type, afterBlockId = null) => {
    if (user?.role !== 'STUDENT') return;
    try {
      const siblingCount = personalBlocks.filter(
        (block) => (block.after_block_id || null) === (afterBlockId || null)
      ).length;
      const created = await lessonService.createPersonalBlock(lessonId, {
        type,
        content: getDefaultPersonalBlockContent(type),
        after_block_id: afterBlockId || null,
        order_index: siblingCount,
      });
      setPersonalBlocks((prev) => [...prev, normalizePersonalBlock(created)]);
    } catch (error) {
      console.error('Failed to create personal block:', error);
    }
  };

  const handleSavePersonalBlock = async (blockId) => {
    const block = personalBlocks.find((entry) => entry.id === blockId);
    if (!block) return;

    try {
      setSavingPersonalBlocks((prev) => ({ ...prev, [blockId]: true }));
      const updated = await lessonService.updatePersonalBlock(lessonId, blockId, {
        type: block.type,
        content: block.content,
        after_block_id: block.after_block_id || null,
        order_index: block.order_index || 0,
      });
      setPersonalBlocks((prev) =>
        prev.map((entry) =>
          entry.id === blockId ? normalizePersonalBlock(updated) : entry
        )
      );
      setDirtyPersonalBlocks((prev) => ({ ...prev, [blockId]: false }));
    } catch (error) {
      console.error('Failed to save personal block:', error);
    } finally {
      setSavingPersonalBlocks((prev) => ({ ...prev, [blockId]: false }));
    }
  };

  const handleDeletePersonalBlock = async (blockId) => {
    try {
      await lessonService.deletePersonalBlock(lessonId, blockId);
      setPersonalBlocks((prev) => prev.filter((entry) => entry.id !== blockId));
      setDirtyPersonalBlocks((prev) => {
        const next = { ...prev };
        delete next[blockId];
        return next;
      });
    } catch (error) {
      console.error('Failed to delete personal block:', error);
    }
  };

  const openPersonalAiRefineModal = (blockId) => {
    setPersonalAiTargetBlockId(blockId);
    setPersonalAiInstructions('');
    setPersonalAiReferenceImages([]);
    setPersonalAiReferenceImagesLoading(false);
    setPersonalAiReferenceDropActive(false);
    setPersonalAiError('');
  };

  const closePersonalAiRefineModal = () => {
    if (personalAiLoading) {
      personalAiAbortControllerRef.current?.abort();
      setPersonalAiLoading(false);
      setPersonalAiTimer(0);
    }
    setPersonalAiTargetBlockId(null);
    setPersonalAiInstructions('');
    setPersonalAiReferenceImages([]);
    setPersonalAiReferenceImagesLoading(false);
    setPersonalAiReferenceDropActive(false);
    setPersonalAiError('');
  };

  const ingestPersonalAiReferenceImages = async (incomingFiles) => {
    const selectedFiles = Array.from(incomingFiles || []).filter(Boolean);
    if (selectedFiles.length === 0) return;

    const imageFiles = selectedFiles.filter((file) => isImageLikeFile(file));
    if (imageFiles.length === 0) {
      setPersonalAiError('Only image files are supported for AI refine context.');
      return;
    }

    setPersonalAiError('');

    const existingKeys = new Set(personalAiReferenceImages.map((image) => buildImagePayloadKey(image)));
    const dedupedSelected = imageFiles.filter((file) => !existingKeys.has(buildImagePayloadKey(file)));
    if (dedupedSelected.length === 0) {
      setPersonalAiError('All selected images are already attached.');
      return;
    }

    if (personalAiReferenceImages.length + dedupedSelected.length > REFINE_MAX_IMAGES) {
      setPersonalAiError(`You can attach up to ${REFINE_MAX_IMAGES} images.`);
      return;
    }

    const oversized = dedupedSelected.find((file) => (Number(file?.size) || 0) > REFINE_MAX_IMAGE_BYTES);
    if (oversized) {
      setPersonalAiError(`"${oversized.name}" is too large. Maximum per image is ${formatBytes(REFINE_MAX_IMAGE_BYTES)}.`);
      return;
    }

    const currentTotalBytes = personalAiReferenceImages.reduce((sum, image) => sum + (Number(image?.size) || 0), 0);
    const selectedTotalBytes = dedupedSelected.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
    if (currentTotalBytes + selectedTotalBytes > REFINE_MAX_IMAGE_TOTAL_BYTES) {
      setPersonalAiError(`Total image size cannot exceed ${formatBytes(REFINE_MAX_IMAGE_TOTAL_BYTES)}.`);
      return;
    }

    setPersonalAiReferenceImagesLoading(true);
    try {
      const payloads = await Promise.all(dedupedSelected.map((file) => readImageFileAsBase64Payload(file)));
      setPersonalAiReferenceImages((previous) => [...previous, ...payloads]);
    } catch (error) {
      console.error('Failed to process personal AI refine reference images:', error);
      setPersonalAiError('Failed to read one or more images. Please try again.');
    } finally {
      setPersonalAiReferenceImagesLoading(false);
    }
  };

  const handlePersonalAiReferenceImagesSelected = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    await ingestPersonalAiReferenceImages(selectedFiles);
  };

  const handlePersonalAiReferenceImagePaste = async (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const pastedFiles = items
      .filter((item) => item?.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean)
      .filter((file) => isImageLikeFile(file));

    if (pastedFiles.length === 0) return;
    event.preventDefault();
    await ingestPersonalAiReferenceImages(pastedFiles);
  };

  const handlePersonalAiReferenceImageDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setPersonalAiReferenceDropActive(false);
    const droppedFiles = Array.from(event.dataTransfer?.files || []);
    await ingestPersonalAiReferenceImages(droppedFiles);
  };

  const handlePersonalAiReferenceImageDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!personalAiReferenceDropActive) {
      setPersonalAiReferenceDropActive(true);
    }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const handlePersonalAiReferenceImageDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nextTarget = event.relatedTarget;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setPersonalAiReferenceDropActive(false);
  };

  const handleRemovePersonalAiReferenceImage = (indexToRemove) => {
    setPersonalAiReferenceImages((previous) => previous.filter((_, index) => index !== indexToRemove));
  };

  const handlePersonalAiRefine = async (event) => {
    event.preventDefault();

    if (!personalAiTargetBlockId || user?.role !== 'STUDENT') return;
    if (personalAiReferenceImagesLoading) {
      setPersonalAiError('Attached images are still processing. Please wait a moment and retry.');
      return;
    }

    const targetBlock = personalBlocks.find((entry) => entry.id === personalAiTargetBlockId);
    if (!targetBlock) {
      setPersonalAiError('Selected block is no longer available.');
      return;
    }

    try {
      personalAiAbortControllerRef.current = new AbortController();
      setPersonalAiLoading(true);
      setPersonalAiError('');

      const result = await lessonService.refinePersonalBlockAi(lessonId, targetBlock.id, {
        instructions: personalAiInstructions,
        blockContent: targetBlock.content,
        referenceImages: personalAiReferenceImages,
      }, { signal: personalAiAbortControllerRef.current.signal });

      if (!Object.prototype.hasOwnProperty.call(result || {}, 'content')) {
        throw new Error('AI returned an invalid response for this block');
      }

      setPersonalBlocks((prev) =>
        prev.map((entry) =>
          entry.id === targetBlock.id ? { ...entry, content: result.content } : entry
        )
      );
      setDirtyPersonalBlocks((prev) => ({ ...prev, [targetBlock.id]: true }));

      setPersonalAiTargetBlockId(null);
      setPersonalAiInstructions('');
      setPersonalAiReferenceImages([]);
      setPersonalAiReferenceDropActive(false);
      setPersonalAiError('');
    } catch (error) {
      if (isRequestCanceled(error)) {
        return;
      }
      const classified = classifyRequestError(error, {
        apiBaseUrl: API_BASE_URL,
        fallbackMessage: 'Failed to refine this personal block with AI.',
        timeoutMessage: 'AI refinement timed out. Please retry with shorter instructions.',
      });
      if (classified.kind !== 'canceled') {
        setPersonalAiError(classified.message);
      }
    } finally {
      if (!personalAiAbortControllerRef.current?.signal.aborted) {
        setPersonalAiLoading(false);
      }
    }
  };

  const handleToggleNoteComposer = (blockId) => {
    setNoteComposerOpen((prev) => ({ ...prev, [blockId]: !prev[blockId] }));
  };

  const handleCreateNote = async (blockId) => {
    const contentValue = String(newNoteContentByBlock[blockId] || '').trim();
    if (!contentValue) return;

    try {
      const created = await notesService.create({
        lessonId,
        blockId,
        content: contentValue,
      });
      setNotesByBlock((prev) => {
        const existing = prev[blockId] || [];
        return {
          ...prev,
          [blockId]: [...existing, created],
        };
      });
      setNewNoteContentByBlock((prev) => ({ ...prev, [blockId]: '' }));
      setNoteComposerOpen((prev) => ({ ...prev, [blockId]: false }));
    } catch (error) {
      console.error('Failed to create note:', error);
    }
  };

  const handleUpdateNote = async (blockId, noteId, contentValue) => {
    try {
      const updated = await notesService.update(noteId, { content: contentValue });
      setNotesByBlock((prev) => ({
        ...prev,
        [blockId]: (prev[blockId] || []).map((note) => (note.id === noteId ? updated : note)),
      }));
    } catch (error) {
      console.error('Failed to update note:', error);
    }
  };

  const handleDeleteNote = async (blockId, noteId) => {
    try {
      await notesService.remove(noteId);
      setNotesByBlock((prev) => ({
        ...prev,
        [blockId]: (prev[blockId] || []).filter((note) => note.id !== noteId),
      }));
    } catch (error) {
      console.error('Failed to delete note:', error);
    }
  };

  // Code execution is handled inside CodeNotebookBlock via sandboxed iframe

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-surface text-on-surface">Opening lesson...</div>;
  }

  if (!lesson) {
    return <div className="min-h-screen flex items-center justify-center bg-surface text-on-surface">Lesson not found.</div>;
  }

  return (
    <div className="bg-background text-on-surface overflow-hidden h-screen flex flex-col">
      {/* TopNavBar */}
      <header className="fixed top-0 w-full z-50 bg-[#f8f9fa]/80 dark:bg-[#191c1d]/80 backdrop-blur-xl shadow-sm border-b border-outline-variant/20">
        <div className="flex justify-between items-center px-8 h-16 w-full">
          <div className="flex items-center gap-8">
            <Link to="/dashboard" className="text-xl font-bold text-[#191c1d] dark:text-white tracking-tight flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">school</span>
              Academic Atelier
            </Link>
            <div className="hidden md:flex gap-6 border-l border-outline-variant/30 pl-6 ml-2">
              {user?.role === 'TEACHER' ? (
                <Link to={`/lesson/edit?lessonId=${lesson?.id}`} className="font-['Inter'] font-medium text-sm tracking-tight text-[#727785] hover:text-error transition-colors flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">{hasLiveQuiz ? 'stop_circle' : 'arrow_back'}</span>
                  {hasLiveQuiz ? 'Stop Presenting' : 'Back to Editor'}
                </Link>
              ) : (
                <Link to={`/class/stream?classId=${lesson?.class_id}`} className="font-['Inter'] font-medium text-sm tracking-tight text-[#727785] hover:text-[#191c1d] transition-colors flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">arrow_back</span>
                  {hasLiveQuiz ? 'Exit Live Session' : 'Back to Class'}
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="w-8 h-8 rounded-full overflow-hidden bg-primary-container flex items-center justify-center text-primary font-bold">
               {user?.name?.charAt(0) || 'U'}
             </div>
          </div>
        </div>
      </header>
      
      {/* Main Layout Container */}
      <main className="flex-1 flex pt-16 h-full overflow-hidden">
        {/* Left Side: Scrollable Notebook Content */}
        <section className={`w-full flex flex-col h-full bg-surface flex-1 overflow-hidden ${user?.role === 'STUDENT' ? '' : 'mx-auto max-w-5xl border-r border-outline-variant/10'}`}>
          {/* Session Header Chip */}
          <div className="px-8 py-4 flex items-center justify-between border-b border-surface-container bg-surface-container-lowest">
            <div className="flex items-center gap-4">
              {hasLiveQuiz && (
                <div className="flex items-center gap-2 px-3 py-1 bg-error-container text-on-error-container rounded-full">
                  <span className="w-2 h-2 rounded-full bg-error animate-pulse"></span>
                  <span className="text-xs font-bold tracking-widest uppercase">Live</span>
                </div>
              )}
              <h1 className="text-2xl font-bold text-on-surface tracking-tight">{lesson.title}</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-[0.65rem] uppercase tracking-widest font-bold text-outline">You are</p>
                <p className="text-sm font-medium text-primary">{user?.role}</p>
              </div>
            </div>
          </div>
          
          {/* Notebook Canvas */}
          <div className="flex-1 overflow-y-auto px-8 md:px-12 lg:px-20 py-12 scroll-smooth" style={{ scrollbarWidth: 'thin' }}>
            <div className="max-w-3xl mx-auto space-y-12 pb-32">
              
              {visibleBlocks.length === 0 && (
                <div className="text-center text-outline-variant py-20 italic">
                  This lesson has no content blocks yet.
                </div>
              )}
              {visibleBlocks.length === 0 && user?.role === 'STUDENT' && (
                <div className="flex items-center justify-center gap-3 -mt-12 mb-8">
                  <button
                    type="button"
                    onClick={() => handleCreatePersonalBlock('TEXT')}
                    className="px-3 py-1.5 rounded-full border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/5"
                  >
                    Add My Text Block
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCreatePersonalBlock('CODE')}
                    className="px-3 py-1.5 rounded-full border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/5"
                  >
                    Add My Code Block
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCreatePersonalBlock('INTERACTIVE_SIMULATION')}
                    className="px-3 py-1.5 rounded-full border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/5"
                  >
                    Add My Simulation
                  </button>
                </div>
              )}

              {(visibleBlocks || []).map((block) => {
                const isPersonal = Boolean(block.isPersonal);
                const showEdited = Boolean(block.is_post_publish_addition);
                const isStudent = user?.role === 'STUDENT';
                const canManagePersonal = isStudent && isPersonal;
                const canUsePersonalAi =
                  canManagePersonal &&
                  (block.type === 'CODE' || block.type === 'INTERACTIVE_SIMULATION');
                const noteList = notesByBlock[block.id] || [];

                let blockNode = null;

                if (block.type === 'TEXT') {
                  blockNode = (
                    <article key={block.id} className="space-y-4">
                      <div className="flex items-center gap-2 mb-2 text-xs font-bold text-outline-variant tracking-widest uppercase">
                        <span className="material-symbols-outlined text-sm">subject</span> Explanation
                        {showEdited && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 text-[10px]">Edited</span>
                        )}
                        {isPersonal && (
                          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-300 text-[10px]">My Block</span>
                        )}
                      </div>
                      {canManagePersonal ? (
                        <div className="space-y-4">
                          <textarea
                            className="w-full text-lg text-on-surface-variant leading-relaxed whitespace-pre-wrap rounded-xl border border-outline-variant/30 bg-surface px-4 py-3 outline-none focus:border-primary resize-y"
                            rows={5}
                            value={String(block.content || '')}
                            onChange={(e) => handlePersonalBlockChange(block.id, e.target.value)}
                          />
                          <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3">
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-outline">
                              Textbook Preview
                            </p>
                            <TextbookContentBlock content={String(block.content || '')} />
                          </div>
                        </div>
                      ) : (
                        <TextbookContentBlock content={String(block.content || '')} />
                      )}
                    </article>
                  );
                } else if (block.type === 'CODE') {
                  const editableCode = (isPersonal && isStudent) || user?.role === 'TEACHER';
                  blockNode = (
                    <article key={block.id} className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-outline-variant tracking-widest uppercase">
                        {showEdited && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 text-[10px]">Edited</span>
                        )}
                        {isPersonal && (
                          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-300 text-[10px]">My Block</span>
                        )}
                      </div>
                      <CodeNotebookBlock
                        content={block.content}
                        onChange={(next) =>
                          isPersonal
                            ? handlePersonalBlockChange(block.id, next)
                            : handleLiveCodeChange(block.id, next)
                        }
                        editable={editableCode}
                        blockId={block.id}
                      />
                    </article>
                  );
                } else if (block.type === 'DISCUSSION') {
                  blockNode = (
                    <article key={block.id} className="bg-primary-fixed rounded-xl p-8 shadow-sm border border-primary/20">
                      <div className="flex items-center gap-2 mb-4 text-xs font-bold text-on-primary-fixed-variant tracking-widest uppercase">
                        <span className="material-symbols-outlined text-sm">forum</span> Discussion Prompt
                        {showEdited && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 text-[10px]">Edited</span>
                        )}
                      </div>
                      <div className="text-xl font-medium text-on-primary-fixed italic">
                        "{block.content}"
                      </div>
                    </article>
                  );
                } else if (block.type === 'EXERCISE') {
                  const exerciseData = typeof block.content === 'string' ? JSON.parse(block.content) : block.content;
                  const state = exerciseStates[block.id] || { selectedIndex: null, submitted: false };

                  blockNode = (
                    <article key={block.id} className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-8 shadow-sm space-y-6">
                      <div className="flex items-center gap-2 text-xs font-bold text-primary tracking-widest uppercase">
                        <span className="material-symbols-outlined text-sm">menu_book</span> Check for Understanding
                        {showEdited && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 text-[10px]">Edited</span>
                        )}
                      </div>
                      <p className="text-lg font-medium text-on-surface">{exerciseData?.question}</p>
                      <div className="grid grid-cols-1 gap-3">
                        {(exerciseData?.options || []).map((opt, idx) => {
                          const isSelected = state.selectedIndex === idx;
                          const showFeedback = state.submitted;
                          const isCorrect = opt.isCorrect;

                          return (
                            <button
                              key={idx}
                              onClick={() =>
                                !state.submitted &&
                                setExerciseStates((prev) => ({
                                  ...prev,
                                  [block.id]: { ...state, selectedIndex: idx },
                                }))
                              }
                              className={`p-4 rounded-xl border text-left transition-all ${
                                showFeedback
                                  ? isCorrect
                                    ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700'
                                    : isSelected
                                    ? 'bg-rose-500/10 border-rose-500 text-rose-700'
                                    : 'bg-surface border-outline-variant opacity-60'
                                  : isSelected
                                  ? 'bg-primary/5 border-primary ring-2 ring-primary/20'
                                  : 'bg-surface border-outline-variant hover:border-primary/50'
                              }`}
                            >
                              <div className="flex justify-between items-center">
                                <span className="text-sm font-medium">{opt.text}</span>
                                {showFeedback && isCorrect && (
                                  <span className="material-symbols-outlined text-emerald-500">check_circle</span>
                                )}
                                {showFeedback && isSelected && !isCorrect && (
                                  <span className="material-symbols-outlined text-rose-500">cancel</span>
                                )}
                              </div>
                              {showFeedback && isSelected && (
                                <div className="mt-2 text-xs opacity-80 italic animate-in slide-in-from-top-1">
                                  {opt.feedback || (isCorrect ? 'Correct!' : 'Try again.')}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {!state.submitted && (
                        <div className="flex justify-end">
                          <button
                            disabled={state.selectedIndex === null}
                            onClick={() =>
                              setExerciseStates((prev) => ({
                                ...prev,
                                [block.id]: { ...state, submitted: true },
                              }))
                            }
                            className="bg-primary text-white px-6 py-2 rounded-full text-sm font-bold disabled:opacity-30 transition-all hover:scale-105 active:scale-95 shadow-md"
                          >
                            CHECK ANSWER
                          </button>
                        </div>
                      )}
                    </article>
                  );
                } else if (block.type === 'QUIZ') {
                  const isLiveFinalQuiz = !isPersonal && finalQuizBlockId && block.id === finalQuizBlockId;
                  blockNode = (
                    <div className="space-y-2">
                      {(showEdited || isPersonal) && (
                        <div className="flex items-center gap-2 text-xs font-bold text-outline-variant tracking-widest uppercase pl-1">
                          {showEdited && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 text-[10px]">Edited</span>
                          )}
                          {isPersonal && (
                            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-300 text-[10px]">My Block</span>
                          )}
                        </div>
                      )}
                      <InteractiveQuiz
                        key={block.id}
                        block={block}
                        userRole={user?.role}
                        isActive={isLiveFinalQuiz ? activeQuizzes[block.id] || false : false}
                        onStart={handleStartQuiz}
                        onStop={handleStopQuiz}
                        onSubmit={handleSubmitAnswer}
                        results={quizResults[block.id] || {}}
                        liveEnabled={Boolean(isLiveFinalQuiz)}
                        isClosed={Boolean(isLiveFinalQuiz && finalQuizClosed)}
                      />
                    </div>
                  );
                } else if (block.type === 'WRITTEN_QUIZ') {
                  blockNode = (
                    <div className="space-y-2">
                      {(showEdited || isPersonal) && (
                        <div className="flex items-center gap-2 text-xs font-bold text-outline-variant tracking-widest uppercase pl-1">
                          {showEdited && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 text-[10px]">Edited</span>
                          )}
                          {isPersonal && (
                            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-300 text-[10px]">My Block</span>
                          )}
                        </div>
                      )}
                      <WrittenQuiz key={block.id} block={block} userRole={user?.role} />
                    </div>
                  );
                } else if (block.type === 'INTERACTIVE_SIMULATION') {
                  const simulationData = normalizeSimulationContent(block.content);
                  blockNode = (
                    <article key={block.id} className="space-y-4">
                      <div className="flex items-center gap-2 text-xs font-bold text-outline-variant tracking-widest uppercase">
                        {showEdited && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 text-[10px]">Edited</span>
                        )}
                        {isPersonal && (
                          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-300 text-[10px]">My Block</span>
                        )}
                      </div>
                      {canManagePersonal && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input
                            type="text"
                            className="w-full rounded-lg border border-outline-variant/30 bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                            value={simulationData.title || ''}
                            onChange={(e) =>
                              handlePersonalBlockChange(block.id, {
                                ...simulationData,
                                title: e.target.value,
                              })
                            }
                          />
                          <input
                            type="text"
                            className="w-full rounded-lg border border-outline-variant/30 bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                            value={simulationData.description || ''}
                            onChange={(e) =>
                              handlePersonalBlockChange(block.id, {
                                ...simulationData,
                                description: e.target.value,
                              })
                            }
                          />
                        </div>
                      )}
                      <InteractiveSimulationBlock block={{ ...block, content: simulationData }} />
                    </article>
                  );
                } else if (block.type === 'MERMAID_DIAGRAM') {
                  const mData = typeof block.content === 'object' ? block.content : { code: '' };
                  blockNode = (
                    <article key={block.id} className="space-y-4">
                      <div className="flex items-center gap-2 text-xs font-bold text-outline-variant tracking-widest uppercase">
                        <span className="material-symbols-outlined text-sm">account_tree</span> Mermaid Diagram
                        {showEdited && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 text-[10px]">Edited</span>
                        )}
                      </div>
                      <MermaidBlock code={mData.code} />
                    </article>
                  );
                } else if (block.type === 'STATIC_CHART') {
                  const cData = typeof block.content === 'object' ? block.content : { chartType: 'bar', title: '', dataKey: 'value', data: [] };
                  blockNode = (
                    <article key={block.id} className="space-y-4">
                      <div className="flex items-center gap-2 text-xs font-bold text-outline-variant tracking-widest uppercase">
                        <span className="material-symbols-outlined text-sm">bar_chart</span> Static Chart
                        {showEdited && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 text-[10px]">Edited</span>
                        )}
                      </div>
                      <StaticChartBlock {...cData} />
                    </article>
                  );
                }

                if (!blockNode) return null;

                return (
                  <div key={block.id} className="space-y-3">
                    {blockNode}

                    {canManagePersonal && (
                      <div className="flex items-center gap-2 justify-end">
                        {canUsePersonalAi && (
                          <button
                            type="button"
                            onClick={() => openPersonalAiRefineModal(block.id)}
                            disabled={personalAiLoading}
                            className="px-3 py-1.5 rounded-full text-xs font-semibold border border-secondary/30 text-secondary hover:bg-secondary/5 disabled:opacity-40"
                          >
                            {personalAiLoading && personalAiTargetBlockId === block.id
                              ? 'Refining...'
                              : 'Refine With AI'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeletePersonalBlock(block.id)}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50"
                        >
                          Delete My Block
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSavePersonalBlock(block.id)}
                          disabled={!dirtyPersonalBlocks[block.id] || savingPersonalBlocks[block.id]}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold border border-primary/30 text-primary hover:bg-primary/5 disabled:opacity-40"
                        >
                          {savingPersonalBlocks[block.id] ? 'Saving...' : 'Save My Block'}
                        </button>
                      </div>
                    )}

                    {isStudent && (
                      <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Personal Notes</p>
                          <button
                            type="button"
                            onClick={() => handleToggleNoteComposer(block.id)}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            Add Note
                          </button>
                        </div>

                        {(noteList || []).map((note) => (
                          <div key={note.id} className="rounded-lg border border-outline-variant/20 bg-surface px-3 py-2 space-y-2">
                            <textarea
                              className="w-full bg-transparent text-sm outline-none resize-y min-h-[52px]"
                              value={note.content || ''}
                              onChange={(e) =>
                                setNotesByBlock((prev) => ({
                                  ...prev,
                                  [block.id]: (prev[block.id] || []).map((entry) =>
                                    entry.id === note.id ? { ...entry, content: e.target.value } : entry
                                  ),
                                }))
                              }
                            />
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleDeleteNote(block.id, note.id)}
                                className="text-xs font-semibold text-red-600 hover:underline"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateNote(block.id, note.id, note.content || '')}
                                className="text-xs font-semibold text-primary hover:underline"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ))}

                        {noteComposerOpen[block.id] && (
                          <div className="space-y-2">
                            <textarea
                              className="w-full rounded-lg border border-outline-variant/20 bg-surface px-3 py-2 text-sm outline-none resize-y min-h-[64px]"
                              placeholder="Write a private note for this block..."
                              value={newNoteContentByBlock[block.id] || ''}
                              onChange={(e) =>
                                setNewNoteContentByBlock((prev) => ({
                                  ...prev,
                                  [block.id]: e.target.value,
                                }))
                              }
                            />
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setNoteComposerOpen((prev) => ({ ...prev, [block.id]: false }))
                                }
                                className="text-xs font-semibold text-outline hover:underline"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCreateNote(block.id)}
                                className="text-xs font-semibold text-primary hover:underline"
                              >
                                Save Note
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {isStudent && !isPersonal && (
                      <div className="flex items-center gap-2 pl-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-outline">Insert My Block</span>
                        <button
                          type="button"
                          onClick={() => handleCreatePersonalBlock('TEXT', block.id)}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          Text
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCreatePersonalBlock('CODE', block.id)}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          Code
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCreatePersonalBlock('INTERACTIVE_SIMULATION', block.id)}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          Simulation
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              
            </div>
          </div>
        </section>
        
        {/* Right Side: AI Assistant Chat Sidebar / Podium */}
        <div
          className="hidden lg:flex relative h-full flex-shrink-0"
          style={{ width: `${sidebarWidth}px`, minWidth: '280px' }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 active:bg-primary -ml-1 z-50 transition-colors"
            onMouseDown={handleSidebarMouseDown}
          />
          <aside className="w-full flex-col border-l border-surface-container-high bg-surface-container-low h-full flex">
            {hasLiveQuiz ? (
              <>
                <div className="flex bg-surface-container p-2 gap-2 border-b border-surface-container-high shrink-0 z-10 w-full">
                  <button
                    onClick={() => setShowLeaderboardSidebar(false)}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${!showLeaderboardSidebar ? 'bg-surface shadow text-primary font-black' : 'text-outline hover:bg-surface-container-highest'}`}
                  >
                    <span className="material-symbols-outlined text-[1rem]">forum</span> Chat
                  </button>
                  <button
                    onClick={() => setShowLeaderboardSidebar(true)}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${showLeaderboardSidebar ? 'bg-surface shadow text-amber-500 font-black' : 'text-outline hover:bg-surface-container-highest'}`}
                  >
                    <span className="material-symbols-outlined text-[1rem]">leaderboard</span> Podium
                  </button>
                </div>

                <div className="flex-1 overflow-hidden relative w-full h-full">
                  {showLeaderboardSidebar ? (
                    <div className="absolute inset-0 overflow-y-auto flex flex-col p-6 animate-in slide-in-from-right-4 duration-300">
                      <div className="flex items-center gap-3 mb-8">
                        <div className="p-2 bg-amber-500/10 rounded-xl">
                          <span className="material-symbols-outlined text-amber-500">trophy</span>
                        </div>
                        <div>
                          <h2 className="text-sm font-bold text-on-surface">Live Leaderboard</h2>
                          <p className="text-[10px] text-outline uppercase tracking-widest font-bold">Real-time Ranking</p>
                        </div>
                      </div>

                      <div className="space-y-4 pb-20">
                        {Object.values(leaderboard)
                          .sort((a, b) => b.score - a.score)
                          .map((entry, i) => (
                            <div key={i} className={`flex items-center gap-4 p-3 rounded-xl border transition-all ${i === 0 ? 'bg-amber-500/5 border-amber-500/20' : 'bg-surface border-transparent'}`}>
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                i === 0 ? 'bg-amber-500 text-white' :
                                i === 1 ? 'bg-slate-400 text-white' :
                                i === 2 ? 'bg-amber-700 text-white' : 'bg-surface-container-high text-outline'
                              }`}>
                                {i + 1}
                              </div>
                              <div className="flex-1">
                                <div className="text-xs font-bold text-on-surface">{entry.name}</div>
                                <div className="text-[10px] text-outline">{entry.count} Questions</div>
                              </div>
                              <div className="text-sm font-mono font-bold text-primary">
                                {entry.score.toLocaleString()}
                              </div>
                            </div>
                          ))}

                        {Object.keys(leaderboard).length === 0 && (
                          <div className="text-center py-20 text-outline-variant italic text-xs">
                            Waiting for first submissions...
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col animate-in slide-in-from-left-4 duration-300 h-full w-full">
                      <ChatAssistant
                        messages={messages}
                        onSendMessage={handleSendMessage}
                        onStopGeneration={handleStopChatGeneration}
                        user={user}
                        isLocked={isChatLocked}
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 overflow-hidden relative w-full h-full">
                <div className="absolute inset-0 flex flex-col h-full w-full">
                  <ChatAssistant
                    messages={messages}
                    onSendMessage={handleSendMessage}
                    onStopGeneration={handleStopChatGeneration}
                    user={user}
                    isLocked={isChatLocked}
                  />
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>

      {aiTargetPersonalBlock && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
          onClick={closePersonalAiRefineModal}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-outline-variant/25 bg-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-outline-variant/20">
              <div>
                <p className="text-xs uppercase tracking-widest font-bold text-secondary mb-1">
                  AI Personal Block Editor
                </p>
                <h3 className="text-xl font-bold text-on-surface">
                  Refine This {String(aiTargetPersonalBlock.type || '').replace('_', ' ')} Block
                </h3>
                <p className="text-sm text-outline mt-1">
                  AI will only use this block&apos;s current content for refinement.
                </p>
              </div>
              <button
                type="button"
                onClick={closePersonalAiRefineModal}
                disabled={personalAiLoading}
                className="text-on-surface-variant hover:text-on-surface disabled:opacity-50"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handlePersonalAiRefine} onPaste={handlePersonalAiReferenceImagePaste} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">
                  Optional Instructions
                </label>
                <textarea
                  rows={5}
                  value={personalAiInstructions}
                  onChange={(event) => setPersonalAiInstructions(event.target.value)}
                  placeholder="Example: Improve clarity, add a concise explanation comment, and ensure the output demonstrates the key concept."
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-3 text-sm outline-none focus:border-secondary resize-y"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">
                  Reference Images (Optional)
                </label>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => personalAiImageInputRef.current?.click()}
                  onDrop={handlePersonalAiReferenceImageDrop}
                  onDragOver={handlePersonalAiReferenceImageDragOver}
                  onDragLeave={handlePersonalAiReferenceImageDragLeave}
                  onPaste={handlePersonalAiReferenceImagePaste}
                  className={`rounded-xl border-2 border-dashed px-3 py-3 text-sm transition-colors ${
                    personalAiReferenceDropActive
                      ? 'border-secondary bg-secondary/5'
                      : 'border-outline-variant/50 bg-surface-container-low'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-on-surface-variant">
                      Drag and drop images here or paste from clipboard.
                    </p>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        personalAiImageInputRef.current?.click();
                      }}
                      className="shrink-0 px-3 py-1.5 rounded-full bg-secondary text-white text-xs font-semibold"
                    >
                      Select Images
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-outline">
                    Use screenshots/diagrams as extra context for AI refinement. Limit: {REFINE_MAX_IMAGES} images, {formatBytes(REFINE_MAX_IMAGE_BYTES)} each.
                  </p>
                  <input
                    ref={personalAiImageInputRef}
                    type="file"
                    accept={REFINE_IMAGE_ACCEPT}
                    multiple
                    onChange={handlePersonalAiReferenceImagesSelected}
                    className="hidden"
                  />
                </div>

                {personalAiReferenceImagesLoading && (
                  <p className="mt-2 text-xs text-outline">Processing attached images...</p>
                )}

                {personalAiReferenceImages.length > 0 && (
                  <div className="mt-2 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 space-y-1.5">
                    <p className="text-xs text-on-surface-variant">
                      Attached {personalAiReferenceImages.length} image(s) - {formatBytes(personalAiReferenceImages.reduce((sum, image) => sum + (Number(image?.size) || 0), 0))}
                    </p>
                    {personalAiReferenceImages.map((image, index) => (
                      <div key={`${buildImagePayloadKey(image)}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-on-surface truncate">{image.name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemovePersonalAiReferenceImage(index)}
                          className="text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {personalAiError && (
                <div className="rounded-lg border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-sm">
                  {personalAiError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closePersonalAiRefineModal}
                  className="px-4 py-2 rounded-full border border-outline-variant/40 text-on-surface font-semibold hover:bg-surface-container-low transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={personalAiLoading || personalAiReferenceImagesLoading}
                  className="px-5 py-2 rounded-full bg-secondary text-on-secondary font-semibold shadow-sm hover:brightness-95 transition-all disabled:opacity-50"
                >
                  {personalAiLoading ? `Refining... (${personalAiTimer}s)` : personalAiReferenceImagesLoading ? 'Processing images...' : 'Apply AI Refinement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {hasLiveQuiz && quizPhase === 'WAITING' && (
        <div className="fixed inset-0 z-[100] bg-primary flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
           <div className="text-center text-white">
             <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mb-8 mx-auto animate-pulse">
               <span className="material-symbols-outlined text-6xl">rocket_launch</span>
             </div>
             <h1 className="text-6xl font-black tracking-tighter mb-4">Get Ready!</h1>
             <p className="text-xl opacity-80 font-bold uppercase tracking-widest leading-relaxed">
               The final competition is about to begin.<br/>
               Check your speed, check your facts!
             </p>
           </div>
        </div>
      )}

      {/* Phase 6: Full-screen Overlays */}
      {hasLiveQuiz && quizPhase === 'RANKING' && (
        <div className="fixed inset-0 z-[100] bg-surface-container-lowest flex flex-col items-center justify-center p-8 animate-in fade-in zoom-in duration-500">
           <button 
             onClick={() => setQuizPhase('CONTENT')}
             className="absolute top-8 right-8 text-outline hover:text-primary transition-colors"
           >
             <span className="material-symbols-outlined text-4xl">close</span>
           </button>
           
           <div className="text-center mb-12">
             <div className="inline-block p-4 bg-amber-500/10 rounded-3xl mb-4">
               <span className="material-symbols-outlined text-amber-500 text-6xl">emoji_events</span>
             </div>
             <h1 className="text-5xl font-black text-on-surface tracking-tighter">Class Champions</h1>
             <p className="text-outline-variant font-bold uppercase tracking-[0.2em] mt-2">Live Session Leaderboard</p>
           </div>

           <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
             {/* 2nd Place */}
             <div className="order-2 md:order-1 h-64 bg-surface-container-high rounded-t-3xl p-6 flex flex-col items-center justify-end relative shadow-sm">
                <div className="absolute top-[-24px] w-12 h-12 rounded-full bg-slate-400 text-white flex items-center justify-center font-bold text-xl border-4 border-surface-container-high">2</div>
                <div className="text-center">
                  <p className="font-bold text-on-surface">{Object.values(leaderboard).sort((a,b)=>b.score-a.score)[1]?.name || '---'}</p>
                  <p className="text-primary font-mono font-black text-xl">{Object.values(leaderboard).sort((a,b)=>b.score-a.score)[1]?.score.toLocaleString() || 0}</p>
                </div>
             </div>
             {/* 1st Place */}
             <div className="order-1 md:order-2 h-80 bg-primary/10 border-2 border-primary/20 rounded-t-3xl p-6 flex flex-col items-center justify-end relative shadow-xl">
                <div className="absolute top-[-32px] w-16 h-16 rounded-full bg-amber-500 text-white flex items-center justify-center font-bold text-3xl border-4 border-surface-container-lowest animate-bounce">1</div>
                <div className="text-center mb-4">
                  <p className="font-black text-2xl text-on-surface">{Object.values(leaderboard).sort((a,b)=>b.score-a.score)[0]?.name || '---'}</p>
                  <p className="text-primary font-mono font-black text-4xl">{Object.values(leaderboard).sort((a,b)=>b.score-a.score)[0]?.score.toLocaleString() || 0}</p>
                </div>
             </div>
             {/* 3rd Place */}
             <div className="order-3 h-48 bg-surface-container-high rounded-t-3xl p-6 flex flex-col items-center justify-end relative shadow-sm">
                <div className="absolute top-[-20px] w-10 h-10 rounded-full bg-amber-700 text-white flex items-center justify-center font-bold text-lg border-4 border-surface-container-high">3</div>
                <div className="text-center">
                  <p className="font-bold text-on-surface">{Object.values(leaderboard).sort((a,b)=>b.score-a.score)[2]?.name || '---'}</p>
                  <p className="text-primary font-mono font-black text-lg">{Object.values(leaderboard).sort((a,b)=>b.score-a.score)[2]?.score.toLocaleString() || 0}</p>
                </div>
             </div>
           </div>

           <div className="w-full max-w-4xl mt-12 bg-surface-container-low rounded-2xl p-6 overflow-y-auto max-h-[30vh]">
             <table className="w-full">
               <thead className="text-left text-[10px] font-bold text-outline uppercase tracking-widest">
                 <tr>
                   <th className="pb-4">Rank</th>
                   <th className="pb-4">Student</th>
                   <th className="pb-4 text-right">Score</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-outline-variant/10 text-sm">
                 {Object.values(leaderboard).sort((a,b)=>b.score-a.score).slice(3).map((entry, i) => (
                   <tr key={i}>
                     <td className="py-3 font-bold text-outline">#{i + 4}</td>
                     <td className="py-3 font-bold text-on-surface">{entry.name}</td>
                     <td className="py-3 text-right font-mono font-bold text-primary">{entry.score.toLocaleString()}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        </div>
      )}


      {/* 3. Render TeacherControlPanel for teachers */}
      {user?.role === 'TEACHER' && hasLiveQuiz && (
        <TeacherControlPanel 
          lessonId={lessonId}
          socket={socketRef.current}
          isChatLocked={isChatLocked}
          onToggleChat={setIsChatLocked}
          onStartCompetition={() => setQuizPhase('WAITING')}
          onShowPodium={() => setQuizPhase('RANKING')}
          studentCount={studentCount}
          understandingPercent={understandingPercent}
        />
      )}

      {/* BottomNavBar (Mobile only) */}
      <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-6 py-4 bg-white/90 dark:bg-[#191c1d]/90 backdrop-blur-lg border-t border-[#f3f4f5] dark:border-[#2c2c2c] md:hidden rounded-t-3xl">
        <Link to={`/class/stream?classId=${lesson?.class_id}`} className="text-[#1a73e8] bg-[#1a73e8]/10 text-primary rounded-full p-3 transition-transform duration-200 flex flex-col items-center">
          <span className="material-symbols-outlined">logout</span>
          <span className="font-['Inter'] text-[10px] uppercase tracking-widest font-bold mt-1">Exit</span>
        </Link>
      </nav>
    </div>
  );
}
