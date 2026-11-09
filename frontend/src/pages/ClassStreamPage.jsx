import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import PdfWorkerInline from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  API_BASE_URL,
  announcementService,
  assignmentService,
  classService,
  lessonService,
  SOCKET_BASE_URL,
} from '../services/api';
import { classifyRequestError } from '../utils/requestError';
import useAuthStore from '../store/useAuthStore';
import TopNavBar from '../components/TopNavBar';
import Sidebar from '../components/Sidebar';
import TeacherCreateMenu from '../components/TeacherCreateMenu';

const SOCKET_URL = SOCKET_BASE_URL;
const DEFAULT_AI_ESTIMATE_SECONDS = 60;
const MAX_REFERENCE_FILES = 8;
const MAX_REFERENCE_FILE_BYTES = 6 * 1024 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 18 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 24;
const MAX_REFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_REFERENCE_IMAGE_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_PDF_SNAPSHOT_PAGES = 12;
const REFERENCE_FILE_ACCEPT =
  '.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.yaml,.yml,.html,.htm,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.swift,.kt,.m,.mm,.sql,.r,.ipynb,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.tif,.tiff,.heic,.heif,.mp3,.wav,.m4a,.aac,.ogg,.mp4,.mov,.avi,.mkv,.webm,.zip,.7z';

const estimateAiGenerationSeconds = (durationMinutes) => {
  const parsedMinutes = Number(durationMinutes);
  if (!Number.isFinite(parsedMinutes)) {
    return DEFAULT_AI_ESTIMATE_SECONDS;
  }

  return Math.max(25, Math.min(180, Math.round(18 + parsedMinutes * 1.4)));
};

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
};

const formatBytes = (bytes) => {
  const safe = Math.max(0, Number(bytes) || 0);
  if (safe >= 1024 * 1024) {
    return `${(safe / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (safe >= 1024) {
    return `${Math.round(safe / 1024)} KB`;
  }
  return `${safe} B`;
};

const guessMimeTypeFromFileName = (fileName) => {
  const name = String(fileName || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (name.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (name.endsWith('.doc')) return 'application/msword';
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (name.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.bmp')) return 'image/bmp';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.csv')) return 'text/csv';
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.xml')) return 'application/xml';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'text/markdown';
  if (name.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
};

const readFileAsBase64Payload = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const raw = String(reader.result || '');
      const commaIndex = raw.indexOf(',');
      const base64 = commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw;
      resolve({
        name: file.name,
        mimeType: file.type || guessMimeTypeFromFileName(file.name),
        size: file.size || 0,
        base64,
      });
    };

    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });

const isPdfReferenceFile = (file) => {
  const mimeType = String(file?.type || '').toLowerCase();
  const fileName = String(file?.name || '').toLowerCase();
  return mimeType === 'application/pdf' || fileName.endsWith('.pdf');
};

const isPdfReferencePayload = (payload) => {
  const mimeType = String(payload?.mimeType || payload?.type || '').toLowerCase();
  const fileName = String(payload?.name || '').toLowerCase();
  return mimeType === 'application/pdf' || fileName.endsWith('.pdf');
};

const isImageReferenceFile = (file) => {
  const mimeType = String(file?.type || '').toLowerCase();
  const fileName = String(file?.name || '').toLowerCase();
  if (mimeType.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|heic|heif|avif)$/i.test(fileName);
};

const estimateBase64SizeBytes = (base64) => {
  const sanitized = String(base64 || '').replace(/\s+/g, '');
  if (!sanitized) return 0;
  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((sanitized.length * 3) / 4) - padding);
};

let pdfJsModulePromise = null;
let pdfWorkerConfigured = false;
let pdfWorkerPort = null;

const loadPdfJsModule = async () => {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = (async () => {
      try {
        return await import('pdfjs-dist/legacy/build/pdf.mjs');
      } catch {
        return import('pdfjs-dist/build/pdf.mjs');
      }
    })();
  }

  try {
    return await pdfJsModulePromise;
  } catch (error) {
    // Reset cache so a future attempt can retry module loading.
    pdfJsModulePromise = null;
    throw error;
  }
};

const configurePdfWorker = (pdfjs) => {
  if (pdfWorkerConfigured) return;
  if (!pdfjs?.GlobalWorkerOptions) return;

  try {
    if (!pdfWorkerPort && typeof PdfWorkerInline === 'function') {
      pdfWorkerPort = new PdfWorkerInline({ type: 'module' });
    }
    if (pdfWorkerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = pdfWorkerPort;
      pdfWorkerConfigured = true;
      return;
    }
  } catch {
    // Continue to URL-based fallback below.
  }

  try {
    pdfjs.GlobalWorkerOptions.workerSrc = String(pdfWorkerUrl || '').trim();
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      throw new Error('Bundled PDF worker URL was empty.');
    }
    pdfWorkerConfigured = true;
    return;
  } catch {
    // Continue to legacy fallback below.
  }

  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
    pdfWorkerConfigured = true;
  } catch {
    // Worker may still be disabled in fallback mode.
  }
};

const pickPdfSnapshotPageNumbers = (totalPages, maxPages) => {
  const safeTotal = Math.max(1, Number(totalPages) || 1);
  const limit = Math.min(Math.max(1, Number(maxPages) || 1), safeTotal);

  if (limit >= safeTotal) {
    return Array.from({ length: safeTotal }, (_, index) => index + 1);
  }

  const selected = new Set();
  for (let index = 0; index < limit; index += 1) {
    const ratio = limit > 1 ? index / (limit - 1) : 0;
    const page = Math.round(1 + ratio * (safeTotal - 1));
    selected.add(Math.max(1, Math.min(safeTotal, page)));
  }

  if (safeTotal >= 3) {
    selected.add(2);
  }

  return [...selected]
    .sort((left, right) => left - right)
    .slice(0, limit);
};

const buildPdfSnapshotReferenceImages = async (file, maxPages = MAX_PDF_SNAPSHOT_PAGES) => {
  const pdfjs = await loadPdfJsModule();
  configurePdfWorker(pdfjs);

  const fileBuffer = await file.arrayBuffer();
  const fileData = new Uint8Array(fileBuffer);
  let loadingTask = null;
  const loadDocument = async (options = {}) => {
    const disableWorker = !!options.disableWorker;
    loadingTask = pdfjs.getDocument({
      data: fileData,
      disableWorker,
      useWorkerFetch: !disableWorker,
      stopAtErrors: false,
      disableAutoFetch: !!options.disableAutoFetch,
      disableStream: !!options.disableStream,
      disableRange: !!options.disableRange,
      isEvalSupported: false,
    });
    return loadingTask.promise;
  };
  const destroyLoadingTaskQuietly = async () => {
    if (!loadingTask?.destroy) return;
    try {
      await loadingTask.destroy();
    } catch {
      // Ignore cleanup failures during fallback.
    }
  };
  const loadAttempts = [
    { disableWorker: false, disableAutoFetch: false, disableStream: false, disableRange: false },
    { disableWorker: true, disableAutoFetch: true, disableStream: true, disableRange: true },
    { disableWorker: true, disableAutoFetch: false, disableStream: false, disableRange: true },
  ];
  let lastLoadError = null;
  let pdfDoc = null;
  for (const attempt of loadAttempts) {
    try {
      pdfDoc = await loadDocument(attempt);
      break;
    } catch (loadError) {
      lastLoadError = loadError;
      console.warn('PDF snapshot extraction load attempt failed:', loadError);
      await destroyLoadingTaskQuietly();
    }
  }
  if (!pdfDoc) {
    const reason = String(lastLoadError?.message || 'Unknown PDF parsing error');
    throw new Error(`Unable to parse PDF for snapshots: ${reason}`);
  }

  const pageNumbers = pickPdfSnapshotPageNumbers(pdfDoc.numPages, maxPages);
  const snapshots = [];

  for (const pageNumber of pageNumbers) {
    try {
      const page = await pdfDoc.getPage(pageNumber);
      const initialViewport = page.getViewport({ scale: 1 });
      const targetWidth = 1100;
      const scale = Math.max(0.85, targetWidth / Math.max(1, initialViewport.width));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) continue;

      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));

      await page.render({ canvasContext: context, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      const base64 = String(dataUrl).split(',')[1] || '';
      const estimatedSize = estimateBase64SizeBytes(base64);

      snapshots.push({
        name: `${file.name} (Page ${pageNumber})`,
        mimeType: 'image/jpeg',
        size: estimatedSize,
        base64,
        source: 'pdf_snapshot',
        sourceFile: file.name,
        sourcePage: pageNumber,
      });
    } catch (pageError) {
      console.warn(`Skipped PDF page ${pageNumber} during snapshot extraction:`, pageError);
    }
  }

  await destroyLoadingTaskQuietly();
  if (snapshots.length === 0) {
    throw new Error('No readable PDF pages were found for snapshot extraction.');
  }
  return snapshots;
};

const buildReferenceImageKey = (image) => [
  String(image?.name || '').toLowerCase(),
  String(image?.source || '').toLowerCase(),
  String(image?.sourceFile || '').toLowerCase(),
  Number(image?.sourcePage) || 0,
  Number(image?.size) || 0,
].join('::');

const createDefaultQuizBlock = () => ({
  type: 'QUIZ',
  content: {
    question: '',
    options: [
      { text: '', isCorrect: true, feedback: '' },
      { text: '', isCorrect: false, feedback: '' },
    ],
    timeLimit: 30,
  },
});

const createDefaultExerciseBlock = () => ({
  type: 'EXERCISE',
  content: {
    question: '',
    options: [
      { text: '', isCorrect: true, feedback: '' },
      { text: '', isCorrect: false, feedback: '' },
    ],
  },
});

const QUIZ_BLOCK_TYPES = new Set(['QUIZ', 'WRITTEN_QUIZ']);
const STUDENT_VISIBLE_LESSON_STATUSES = new Set(['PUBLISHED', 'LIVE']);

const detectLessonStreamItemType = (blocks) => {
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

export default function ClassStreamPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const classId = searchParams.get('classId');
  const action = searchParams.get('action');
  const { user } = useAuthStore();
  const [assignments, setAssignments] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [classInfo, setClassInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  // Create announcement modal
  const [showCreateAnnouncement, setShowCreateAnnouncement] = useState(false);
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [announcementCreateError, setAnnouncementCreateError] = useState('');
  const [announcementCreateLoading, setAnnouncementCreateLoading] = useState(false);

  // Create assignment modal
  const [showCreateAssignment, setShowCreateAssignment] = useState(false);
  const [assignTitle, setAssignTitle] = useState('');
  const [assignDesc, setAssignDesc] = useState('');
  const [assignDue, setAssignDue] = useState('');
  const [createError, setCreateError] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // Create lesson modal
  const [showCreateLesson, setShowCreateLesson] = useState(false);
  const [createContentType, setCreateContentType] = useState('lesson');
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonCreateError, setLessonCreateError] = useState('');
  const [lessonCreateLoading, setLessonCreateLoading] = useState(false);

  // Generate AI lesson modal
  const [showGenerateAi, setShowGenerateAi] = useState(false);
  const [generateContentType, setGenerateContentType] = useState('lesson');
  const [aiTopic, setAiTopic] = useState('');
  const [aiGrade, setAiGrade] = useState('High School');
  const [aiDuration, setAiDuration] = useState('30');
  const [aiReferenceContent, setAiReferenceContent] = useState('');
  const [aiReferenceFiles, setAiReferenceFiles] = useState([]);
  const [aiReferenceImages, setAiReferenceImages] = useState([]);
  const [aiReferenceFilesLoading, setAiReferenceFilesLoading] = useState(false);
  const [referenceDropActive, setReferenceDropActive] = useState(false);
  const [aiInteractivity, setAiInteractivity] = useState(50);
  const [aiDefaultCodeLanguage, setAiDefaultCodeLanguage] = useState('javascript');
  const [aiError, setAiError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiEstimateSeconds, setAiEstimateSeconds] = useState(DEFAULT_AI_ESTIMATE_SECONDS);
  const [aiElapsedSeconds, setAiElapsedSeconds] = useState(0);
  const [deletingAnnouncementId, setDeletingAnnouncementId] = useState(null);
  const [deletingAssignmentId, setDeletingAssignmentId] = useState(null);
  const [deletingLessonId, setDeletingLessonId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [showClassInfo, setShowClassInfo] = useState(false);
  const presenceSocketRef = useRef(null);
  const aiAbortRef = useRef(null);
  const referenceFileInputRef = useRef(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (!classId) {
      navigate('/dashboard');
      return;
    }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, user, navigate]);

  useEffect(() => {
    if (!classId || !user?.id) return undefined;

    const socket = io(SOCKET_URL);
    presenceSocketRef.current = socket;

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
      socket.disconnect();
      presenceSocketRef.current = null;
    };
  }, [classId, user?.id, user?.role]);

  useEffect(() => {
    if (!aiLoading) {
      setAiElapsedSeconds(0);
      return undefined;
    }

    const timer = setInterval(() => {
      setAiElapsedSeconds((previous) => previous + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [aiLoading]);

  const isAnyModalOpen =
    showCreateAnnouncement ||
    showCreateAssignment ||
    showCreateLesson ||
    showGenerateAi ||
    showClassInfo;

  useEffect(() => {
    if (!isAnyModalOpen) return undefined;

    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, [isAnyModalOpen]);

  const hydrateLessonStreamTypes = async (rawLessons) => {
    const lessonsList = Array.isArray(rawLessons) ? rawLessons : [];
    if (lessonsList.length === 0) return [];

    const hydrated = await Promise.all(
      lessonsList.map(async (lesson) => {
        try {
          const lessonDetail = await lessonService.getById(lesson.id);
          return {
            ...lesson,
            stream_item_type: detectLessonStreamItemType(lessonDetail?.blocks),
          };
        } catch {
          return {
            ...lesson,
            stream_item_type: 'LESSON',
          };
        }
      })
    );

    return hydrated;
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const [announceResult, assignResult, lessonResult, classResult] = await Promise.allSettled([
        announcementService.getByClass(classId),
        assignmentService.getByClass(classId),
        lessonService.getByClass(classId),
        classService.getById(classId),
      ]);

      if (announceResult.status === 'fulfilled') {
        setAnnouncements(announceResult.value);
      } else {
        console.error('Failed to fetch announcements:', announceResult.reason);
        setAnnouncements([]);
      }

      if (assignResult.status === 'fulfilled') {
        setAssignments(assignResult.value);
      } else {
        console.error('Failed to fetch assignments:', assignResult.reason);
        setAssignments([]);
      }

      if (lessonResult.status === 'fulfilled') {
        const typedLessons = await hydrateLessonStreamTypes(lessonResult.value);
        setLessons(typedLessons);
      } else {
        console.error('Failed to fetch lessons:', lessonResult.reason);
        setLessons([]);
      }

      if (classResult.status === 'fulfilled') {
        setClassInfo(classResult.value);
      } else {
        console.error('Failed to fetch class details:', classResult.reason);
        setClassInfo(null);
        setLoadError('Some class details could not be loaded. Existing assignments and lessons are still shown.');
      }
      setActionError('');
    } catch (err) {
      console.error('Failed to fetch class data:', err);
      setLoadError('Failed to load class data');
    } finally {
      setLoading(false);
    }
  };

  const clearActionQuery = () => {
    if (!action) return;
    navigate(`/class/stream?classId=${classId}`, { replace: true });
  };

  const handleCreateAnnouncement = async (e) => {
    e.preventDefault();
    setAnnouncementCreateError('');
    setAnnouncementCreateLoading(true);
    if (isArchivedClass) {
      setAnnouncementCreateError('Cannot create announcements in an archived class. Restore the class first.');
      setAnnouncementCreateLoading(false);
      return;
    }

    const trimmedMessage = String(announcementMessage || '').trim();
    if (!trimmedMessage) {
      setAnnouncementCreateError('Announcement message is required.');
      setAnnouncementCreateLoading(false);
      return;
    }

    try {
      await announcementService.create(classId, { message: trimmedMessage });
      setShowCreateAnnouncement(false);
      setAnnouncementMessage('');
      await fetchData();
    } catch (err) {
      setAnnouncementCreateError(err.response?.data?.error || 'Failed to create announcement');
    } finally {
      setAnnouncementCreateLoading(false);
    }
  };

  const handleCreateAssignment = async (e) => {
    e.preventDefault();
    setCreateError('');
    setCreateLoading(true);
    if (isArchivedClass) {
      setCreateError('Cannot create assignments in an archived class. Restore the class first.');
      setCreateLoading(false);
      return;
    }
    try {
      await assignmentService.create({
        class_id: classId,
        title: assignTitle,
        description: assignDesc,
        due_date: assignDue || null
      });
      setShowCreateAssignment(false);
      setAssignTitle('');
      setAssignDesc('');
      setAssignDue('');
      await fetchData();
    } catch (err) {
      setCreateError(err.response?.data?.error || 'Failed to create assignment');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCreateLesson = async (e) => {
    e.preventDefault();
    const isQuizMode = createContentType === 'quiz';
    const contentLabel = isQuizMode ? 'quiz' : 'lesson';
    const contentLabelPlural = isQuizMode ? 'quizzes' : 'lessons';
    setLessonCreateError('');
    setLessonCreateLoading(true);
    if (isArchivedClass) {
      setLessonCreateError(`Cannot create ${contentLabelPlural} in an archived class. Restore the class first.`);
      setLessonCreateLoading(false);
      return;
    }
    try {
      const newLesson = await lessonService.create({
        class_id: classId,
        title: lessonTitle
      });

      if (isQuizMode) {
        await lessonService.update(newLesson.id, {
          status: 'DRAFT',
          blocks: [createDefaultQuizBlock()],
        });
      }

      setShowCreateLesson(false);
      setCreateContentType('lesson');
      setLessonTitle('');
      await fetchData();

      if (isQuizMode) {
        navigate(`/lesson/edit?lessonId=${newLesson.id}`);
      }
    } catch (err) {
      setLessonCreateError(err.response?.data?.error || `Failed to create ${contentLabel}`);
    } finally {
      setLessonCreateLoading(false);
    }
  };

  const ingestReferenceFiles = async (incomingFiles) => {
    const selectedFiles = Array.from(incomingFiles || []).filter(Boolean);
    if (selectedFiles.length === 0) return;

    setAiError('');

    const existingKeys = new Set(
      aiReferenceFiles.map((file) => `${String(file?.name || '').toLowerCase()}::${Number(file?.size) || 0}`)
    );
    const dedupedSelected = selectedFiles.filter(
      (file) => !existingKeys.has(`${String(file?.name || '').toLowerCase()}::${Number(file?.size) || 0}`)
    );

    if (dedupedSelected.length === 0) {
      setAiError('All selected files are already attached.');
      return;
    }

    const currentTotalBytes = aiReferenceFiles.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
    const selectedTotalBytes = dedupedSelected.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
    const nextFileCount = aiReferenceFiles.length + dedupedSelected.length;

    if (nextFileCount > MAX_REFERENCE_FILES) {
      setAiError(`You can attach up to ${MAX_REFERENCE_FILES} reference files.`);
      return;
    }

    const oversized = dedupedSelected.find((file) => (Number(file?.size) || 0) > MAX_REFERENCE_FILE_BYTES);
    if (oversized) {
      setAiError(`"${oversized.name}" is too large. Maximum per file is ${formatBytes(MAX_REFERENCE_FILE_BYTES)}.`);
      return;
    }

    if (currentTotalBytes + selectedTotalBytes > MAX_REFERENCE_TOTAL_BYTES) {
      setAiError(`Total attached file size cannot exceed ${formatBytes(MAX_REFERENCE_TOTAL_BYTES)}.`);
      return;
    }

    setAiReferenceFilesLoading(true);
    try {
      const converted = await Promise.all(dedupedSelected.map((file) => readFileAsBase64Payload(file)));
      setAiReferenceFiles((previous) => [...previous, ...converted]);

      const directImageReferences = converted
        .map((payload, index) => ({
          payload,
          sourceFile: dedupedSelected[index],
        }))
        .filter(({ sourceFile }) => isImageReferenceFile(sourceFile))
        .map(({ payload }) => ({
          name: payload.name,
          mimeType: payload.mimeType,
          size: Number(payload.size) || estimateBase64SizeBytes(payload.base64),
          base64: payload.base64,
          source: 'uploaded_image',
          sourceFile: payload.name,
          sourcePage: null,
        }));

      const pdfFiles = dedupedSelected.filter((file) => isPdfReferenceFile(file));
      const pdfSnapshotNested = await Promise.all(
        pdfFiles.map(async (pdfFile) => {
          try {
            return await buildPdfSnapshotReferenceImages(pdfFile, MAX_PDF_SNAPSHOT_PAGES);
          } catch (snapshotError) {
            console.error(`Failed to extract PDF snapshots for ${pdfFile.name}:`, snapshotError);
            const rawReason = String(snapshotError?.message || 'Unknown error');
            const compactReason = rawReason.replace(/\s+/g, ' ').slice(0, 160);
            setAiError(
              `Failed to extract page snapshots from "${pdfFile.name}" (${compactReason}). Generation is blocked until at least one PDF snapshot is available.`
            );
            return [];
          }
        })
      );
      const pdfSnapshots = pdfSnapshotNested.flat();
      const incomingImagePayloads = [...directImageReferences, ...pdfSnapshots];

      if (incomingImagePayloads.length > 0) {
        let imageWarnings = [];
        setAiReferenceImages((previous) => {
          const merged = [...previous];
          const existingKeys = new Set(merged.map((image) => buildReferenceImageKey(image)));
          let runningTotalBytes = merged.reduce((sum, image) => sum + (Number(image?.size) || 0), 0);

          incomingImagePayloads.forEach((image) => {
            const normalizedSize = Number(image?.size) || estimateBase64SizeBytes(image?.base64);
            const normalized = { ...image, size: normalizedSize };
            const key = buildReferenceImageKey(normalized);
            if (existingKeys.has(key)) return;

            if (normalizedSize > MAX_REFERENCE_IMAGE_BYTES) {
              imageWarnings.push(`Skipped "${normalized.name}" because it exceeds ${formatBytes(MAX_REFERENCE_IMAGE_BYTES)}.`);
              return;
            }

            if (merged.length >= MAX_REFERENCE_IMAGES) {
              imageWarnings.push(`Only ${MAX_REFERENCE_IMAGES} reference images are allowed per generation.`);
              return;
            }

            if (runningTotalBytes + normalizedSize > MAX_REFERENCE_IMAGE_TOTAL_BYTES) {
              imageWarnings.push(
                `Skipped "${normalized.name}" because total reference image size exceeds ${formatBytes(MAX_REFERENCE_IMAGE_TOTAL_BYTES)}.`
              );
              return;
            }

            existingKeys.add(key);
            merged.push(normalized);
            runningTotalBytes += normalizedSize;
          });

          return merged;
        });

        if (imageWarnings.length > 0) {
          setAiError(imageWarnings.join(' '));
        }
      }
    } catch (err) {
      console.error('Failed to process reference files:', err);
      setAiError('Failed to read one or more reference files. Please try again.');
    } finally {
      setAiReferenceFilesLoading(false);
    }
  };

  const handleReferenceFilesSelected = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    await ingestReferenceFiles(selectedFiles);
  };

  const handleReferencePaste = async (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const pastedFiles = items
      .filter((item) => item?.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean);

    if (pastedFiles.length === 0) return;

    event.preventDefault();
    await ingestReferenceFiles(pastedFiles);
  };

  const handleReferenceDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setReferenceDropActive(false);
    const droppedFiles = Array.from(event.dataTransfer?.files || []);
    await ingestReferenceFiles(droppedFiles);
  };

  const handleReferenceDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!referenceDropActive) {
      setReferenceDropActive(true);
    }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleReferenceDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nextTarget = event.relatedTarget;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setReferenceDropActive(false);
  };

  const handleRemoveReferenceFile = (indexToRemove) => {
    const removed = aiReferenceFiles[indexToRemove];
    setAiReferenceFiles((previous) => previous.filter((_, index) => index !== indexToRemove));
    if (!removed?.name) return;

    setAiReferenceImages((previous) =>
      previous.filter((image) => {
        const sourceFile = String(image?.sourceFile || '');
        if (!sourceFile) return true;
        if (sourceFile !== removed.name) return true;
        return false;
      })
    );
  };

  const handleRemoveReferenceImage = (indexToRemove) => {
    setAiReferenceImages((previous) => previous.filter((_, index) => index !== indexToRemove));
  };

  const handleGenerateAILesson = async (e) => {
    e.preventDefault();
    const isQuizMode = generateContentType === 'quiz';
    const contentLabelPlural = isQuizMode ? 'quizzes' : 'lessons';
    setAiError('');
    setAiEstimateSeconds(estimateAiGenerationSeconds(aiDuration));
    setAiElapsedSeconds(0);
    setAiLoading(true);
    if (isArchivedClass) {
      setAiError(`Cannot generate ${contentLabelPlural} in an archived class. Restore the class first.`);
      setAiLoading(false);
      return;
    }

    if (aiReferenceFilesLoading) {
      setAiError('Reference files are still being processed. Please wait a moment and try again.');
      setAiLoading(false);
      return;
    }

    if (requiresPdfSnapshots) {
      setAiError('Generation is blocked because PDFs are attached but no PDF snapshots were extracted.');
      setAiLoading(false);
      return;
    }

    const abortController = new AbortController();
    aiAbortRef.current = abortController;

    try {
      const quizPromptInstruction =
        generateContentType === 'quiz'
          ? 'Generate a quiz-focused lesson. Return only QUIZ and optional WRITTEN_QUIZ blocks. Do not return TEXT, CODE, or DISCUSSION blocks.'
          : '';
      const mergedReferenceContent = [aiReferenceContent, quizPromptInstruction]
        .filter(Boolean)
        .join('\n\n');

      // 1. Ask OpenRouter to draft the lesson JSON
      const generatedData = await lessonService.generateAi({
        classId,
        topic: aiTopic,
        gradeLevel: aiGrade,
        targetDuration: aiDuration,
        referenceContent: mergedReferenceContent,
        referenceFiles: aiReferenceFiles,
        referenceImages: aiReferenceImages,
        interactivityLevel: aiInteractivity,
        defaultCodeLanguage: aiDefaultCodeLanguage,
      }, { signal: abortController.signal });

      const generatedBlocks = Array.isArray(generatedData.blocks) ? generatedData.blocks : [];
      const filteredBlocks =
        generateContentType === 'quiz'
          ? generatedBlocks.filter((block) => block?.type === 'QUIZ' || block?.type === 'WRITTEN_QUIZ')
          : generatedBlocks.filter((block) => block?.type !== 'QUIZ' && block?.type !== 'WRITTEN_QUIZ');
      const blocksToSave =
        filteredBlocks.length > 0
          ? filteredBlocks
          : [generateContentType === 'quiz' ? createDefaultQuizBlock() : createDefaultExerciseBlock()];

      // 2. Create the empty lesson record in the DB to get an ID
      const newLesson = await lessonService.create({
        class_id: classId,
        title: generatedData.title || `${generateContentType === 'quiz' ? 'Quiz' : 'Lesson'} on ${aiTopic}`
      });

      // 3. Update the lesson with the generated blocks
      await lessonService.update(newLesson.id, {
        status: 'DRAFT',
        blocks: blocksToSave
      });

      setShowGenerateAi(false);
      setGenerateContentType('lesson');
      setAiTopic('');
      setAiDefaultCodeLanguage('javascript');
      setAiReferenceFiles([]);
      setAiReferenceImages([]);
      await fetchData();
      
      // Navigate to the editor so the teacher can review the AI generated content
      navigate(`/lesson/edit?lessonId=${newLesson.id}`);
    } catch (err) {
      // Silently ignore user-initiated cancellation
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || abortController.signal.aborted) {
        return;
      }

      if (Number(err?.response?.status) === 413) {
        setAiError('Reference uploads are too large. Reduce file size/count and try again.');
        return;
      }
      if (
        Number(err?.response?.status) === 400 &&
        String(err?.response?.data?.reason || '').toUpperCase() === 'PDF_SNAPSHOTS_REQUIRED'
      ) {
        setAiError('PDF snapshots are required when PDFs are attached. Re-attach the PDF or add teacher images.');
        return;
      }

      const classified = classifyRequestError(err, {
        apiBaseUrl: API_BASE_URL,
        fallbackMessage: generateContentType === 'quiz' ? 'Failed to generate AI quiz.' : 'Failed to generate AI lesson.',
        timeoutMessage:
          generateContentType === 'quiz'
            ? 'Quiz generation timed out on the server. Please try again with shorter duration or lower interactivity.'
            : 'Lesson generation timed out on the server. Please try again with shorter duration or lower interactivity.',
      });
      if (classified.kind !== 'canceled') {
        setAiError(classified.message);
      }
    } finally {
      aiAbortRef.current = null;
      setAiLoading(false);
    }
  };

  const handleDeleteAssignment = async (e, assignment) => {
    e.preventDefault();
    e.stopPropagation();

    const confirmed = window.confirm(`Delete assignment "${assignment.title}"? This also deletes all submissions.`);
    if (!confirmed) {
      return;
    }

    try {
      setActionError('');
      setDeletingAssignmentId(assignment.id);
      await assignmentService.remove(assignment.id);
      setAssignments((prev) => prev.filter((item) => item.id !== assignment.id));
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to delete assignment');
    } finally {
      setDeletingAssignmentId(null);
    }
  };

  const handleDeleteAnnouncement = async (e, announcement) => {
    e.preventDefault();
    e.stopPropagation();

    const preview = String(announcement?.message || '').trim();
    const snippet = preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;
    const confirmed = window.confirm(`Delete announcement "${snippet}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setActionError('');
      setDeletingAnnouncementId(announcement.id);
      await announcementService.remove(announcement.id);
      setAnnouncements((prev) => prev.filter((item) => item.id !== announcement.id));
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to delete announcement');
    } finally {
      setDeletingAnnouncementId(null);
    }
  };

  const handleDeleteLesson = async (e, lesson) => {
    e.preventDefault();
    e.stopPropagation();

    const confirmed = window.confirm(`Delete lesson "${lesson.title}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    try {
      setActionError('');
      setDeletingLessonId(lesson.id);
      await lessonService.remove(lesson.id);
      setLessons((prev) => prev.filter((item) => item.id !== lesson.id));
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to delete lesson');
    } finally {
      setDeletingLessonId(null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const isArchivedClass = Boolean(classInfo?.is_archived);
  const visibleLessons =
    user?.role === 'STUDENT'
      ? lessons.filter((lesson) =>
          STUDENT_VISIBLE_LESSON_STATUSES.has(String(lesson?.status || '').toUpperCase())
        )
      : lessons;
  const streamItems = [
    ...announcements.map((announcement) => ({
      id: announcement.id,
      itemType: 'ANNOUNCEMENT',
      createdAt: announcement.created_at || null,
      payload: announcement,
    })),
    ...assignments.map((assignment) => ({
      id: assignment.id,
      itemType: 'ASSIGNMENT',
      createdAt: assignment.created_at || assignment.updated_at || assignment.due_date || null,
      payload: assignment,
    })),
    ...visibleLessons.map((lesson) => ({
      id: lesson.id,
      itemType: lesson.stream_item_type === 'QUIZ' ? 'QUIZ' : 'LESSON',
      createdAt: lesson.created_at || lesson.updated_at || null,
      payload: lesson,
    })),
  ].sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return rightTime - leftTime;
  });
  const aiReferenceTotalBytes = aiReferenceFiles.reduce(
    (sum, file) => sum + (Number(file?.size) || 0),
    0
  );
  const aiReferenceImageTotalBytes = aiReferenceImages.reduce(
    (sum, image) => sum + (Number(image?.size) || 0),
    0
  );
  const attachedPdfReferenceNames = [...new Set(
    aiReferenceFiles
      .filter((file) => isPdfReferencePayload(file))
      .map((file) => String(file?.name || '').trim())
      .filter(Boolean)
  )];
  const pdfSnapshotSourceNames = new Set(
    aiReferenceImages
      .filter((image) => String(image?.source || '').toLowerCase() === 'pdf_snapshot')
      .map((image) => String(image?.sourceFile || '').trim())
      .filter(Boolean)
  );
  const pdfsWithSnapshotsCount = attachedPdfReferenceNames.reduce(
    (count, name) => (pdfSnapshotSourceNames.has(name) ? count + 1 : count),
    0
  );
  const hasAttachedPdfs = attachedPdfReferenceNames.length > 0;
  const hasAnyPdfSnapshots = aiReferenceImages.some(
    (image) => String(image?.source || '').toLowerCase() === 'pdf_snapshot'
  );
  const requiresPdfSnapshots = hasAttachedPdfs && !hasAnyPdfSnapshots;
  const pdfSnapshotStatusLine = hasAttachedPdfs
    ? `PDF snapshots: ${pdfsWithSnapshotsCount}/${attachedPdfReferenceNames.length} PDFs produced snapshots.`
    : '';
  const pdfSnapshotBlockingMessage = requiresPdfSnapshots
    ? 'Generation is blocked because PDF snapshots are required when PDFs are attached.'
    : '';
  const isGenerateBlocked =
    aiLoading ||
    aiReferenceFilesLoading ||
    requiresPdfSnapshots;
  const createModeLabel = createContentType === 'quiz' ? 'Quiz' : 'Lesson';
  const generateModeLabel = generateContentType === 'quiz' ? 'Quiz' : 'Lesson';

  useEffect(() => {
    if (loading || !action) return;
    if (!classId || user?.role !== 'TEACHER') {
      clearActionQuery();
      return;
    }
    if (isArchivedClass) {
      clearActionQuery();
      return;
    }

    if (action === 'create-announcement') {
      setAnnouncementCreateError('');
      setShowCreateAnnouncement(true);
    } else if (action === 'create-assignment') {
      setCreateError('');
      setShowCreateAssignment(true);
    } else if (action === 'create-lesson-manual') {
      setCreateContentType('lesson');
      setLessonCreateError('');
      setShowCreateLesson(true);
    } else if (action === 'create-lesson-ai') {
      setGenerateContentType('lesson');
      setAiError('');
      setShowGenerateAi(true);
    } else if (action === 'create-quiz-manual') {
      setCreateContentType('quiz');
      setLessonCreateError('');
      setShowCreateLesson(true);
    } else if (action === 'create-quiz-ai') {
      setGenerateContentType('quiz');
      setAiError('');
      setShowGenerateAi(true);
    }

    clearActionQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, action, classId, user?.role, isArchivedClass]);

  const openCreateAnnouncementFromMenu = () => {
    setAnnouncementCreateError('');
    setShowCreateAnnouncement(true);
  };

  const openCreateAssignmentFromMenu = () => {
    setCreateError('');
    setShowCreateAssignment(true);
  };

  const openCreateManualLessonFromMenu = () => {
    setCreateContentType('lesson');
    setLessonCreateError('');
    setShowCreateLesson(true);
  };

  const openCreateAiLessonFromMenu = () => {
    setGenerateContentType('lesson');
    setAiError('');
    setShowGenerateAi(true);
  };

  const openCreateManualQuizFromMenu = () => {
    setCreateContentType('quiz');
    setLessonCreateError('');
    setShowCreateLesson(true);
  };

  const openCreateAiQuizFromMenu = () => {
    setGenerateContentType('quiz');
    setAiError('');
    setShowGenerateAi(true);
  };

  const closeCreateLessonModal = () => {
    setShowCreateLesson(false);
    setCreateContentType('lesson');
  };

  const closeGenerateAiModal = () => {
    if (aiLoading) return;
    setShowGenerateAi(false);
    setGenerateContentType('lesson');
    setAiReferenceFiles([]);
    setAiReferenceImages([]);
    setAiError('');
  };

  if (loading) {
    return (
      <div className="bg-background text-on-background min-h-screen">
        <TopNavBar />
        <div className="flex">
          <Sidebar />
          <main className="pt-16 lg:pl-64 min-h-screen flex items-center justify-center w-full">
            <p className="text-on-surface-variant text-lg">Loading class data...</p>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background text-on-background min-h-screen">
      <TopNavBar />
      
      <div className="flex">
        <Sidebar />
      
      {/* Main Content Area */}
      <main className="pt-16 lg:pl-64 min-h-screen w-full">
        <div className="max-w-[1400px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Hero Banner */}
          <section className="relative h-64 sm:h-72 rounded-xl overflow-hidden mb-8 shadow-sm group">
            <div className="absolute inset-0 bg-secondary">
              <img alt="Class Banner" className="w-full h-full object-cover mix-blend-overlay opacity-40" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDGNr4QwSQkx9fnLMJDGQ1e2oiUrchCxbWdeFB_e6OsdIMlIQTEQO0Q__FHEepLna6OC9SFvDmB_Gu0dMJoy4o8obaajklKyNvXsKK1CDiFFUJBxZoigblHzvC2uEOQQHA0RwQoHbwQgqS8QjOiTPpJDLNN0I3aYx9kOZnY0NGXv7IR6f9TH2RYg5dLNgECIZd7LBmGGrrPcQtYNncF93l3GImp7OlA93KJiM7F1F2csG4nd4eBC0uJ_OlsBoUm-d9dbyj3QeZFBQY" />
            </div>
            <div className="absolute bottom-6 left-6 text-white">
              <h2 className="text-4xl font-bold tracking-tight">{classInfo?.name || 'Class Stream'}</h2>
              <p className="text-xl opacity-90">Class Stream</p>
              {isArchivedClass && (
                <p className="inline-flex mt-2 items-center gap-1 text-xs font-bold uppercase tracking-wider bg-black/30 rounded-full px-2 py-1">
                  <span className="material-symbols-outlined text-sm">archive</span>
                  Archived
                </p>
              )}
            </div>
            <button
              className="absolute top-4 right-4 bg-white/20 backdrop-blur-md p-2 rounded-full text-white hover:bg-white/30 transition-colors"
              type="button"
              onClick={() => setShowClassInfo(true)}
              title="Class details"
            >
              <span className="material-symbols-outlined">info</span>
            </button>
          </section>

          {isArchivedClass && (
            <section className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800">
                This class is archived. New stream creations are disabled until it is restored from Archived Classes.
              </p>
            </section>
          )}

          {loadError && (
            <section className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800">{loadError}</p>
            </section>
          )}

          {actionError && (
            <section className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
              <p className="text-sm font-semibold text-red-700">{actionError}</p>
            </section>
          )}
          
          <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-6 lg:gap-8 items-start">
            {/* Left Column: Upcoming */}
            <aside className="space-y-4 xl:sticky xl:top-24">
              {user?.role === 'TEACHER' && classInfo?.class_code && (
                <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-slate-100/10">
                  <h3 className="text-sm font-semibold text-on-surface uppercase tracking-wider mb-2">Class Code</h3>
                  <p className="text-3xl font-semibold tracking-wide text-primary">{classInfo.class_code}</p>
                  <p className="text-xs text-slate-500 mt-2">Share this code to invite students.</p>
                </div>
              )}
              <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-slate-100/10">
                <h3 className="text-sm font-semibold text-on-surface uppercase tracking-wider mb-4">Upcoming</h3>
                <div className="space-y-4">
                  {assignments.filter(a => a.due_date && new Date(a.due_date) > new Date()).slice(0, 3).map(a => (
                    <div key={a.id} className="group cursor-pointer">
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-xs font-bold text-tertiary">Due {formatDate(a.due_date)}</span>
                        {user?.role === 'STUDENT' && a.completed && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                            <span className="material-symbols-outlined text-xs">check_circle</span>
                            Complete
                          </span>
                        )}
                        {user?.role === 'TEACHER' && (
                          <Link 
                            to={`/assignment/${a.id}/grade`}
                            className="text-[10px] font-bold uppercase tracking-widest text-primary hover:bg-primary/5 px-2 py-1 rounded border border-primary/20 transition-colors"
                          >
                            Grade Submissions
                          </Link>
                        )}
                      </div>
                      <Link to={`/assignment/${a.id}`} className="text-sm text-slate-700 font-medium group-hover:text-primary transition-colors block">{a.title}</Link>
                    </div>
                  ))}
                  {assignments.filter(a => a.due_date && new Date(a.due_date) > new Date()).length === 0 && (
                    <p className="text-sm text-slate-400 italic">No upcoming deadlines</p>
                  )}
                </div>
              </div>
            </aside>
            
            {/* Center Column: Stream Feed */}
            <div className="space-y-6">
              {user?.role === 'TEACHER' && (
                <div className="flex items-center justify-between gap-3">
                  <TeacherCreateMenu
                    onCreateAnnouncement={openCreateAnnouncementFromMenu}
                    onCreateAssignment={openCreateAssignmentFromMenu}
                    onCreateManualLesson={openCreateManualLessonFromMenu}
                    onCreateAiLesson={openCreateAiLessonFromMenu}
                    onCreateManualQuiz={openCreateManualQuizFromMenu}
                    onCreateAiQuiz={openCreateAiQuizFromMenu}
                    disabled={isArchivedClass}
                  />
                  <p className="hidden sm:block text-sm text-slate-500">
                    {streamItems.length} {streamItems.length === 1 ? 'post' : 'posts'}
                  </p>
                </div>
              )}

              <div className="space-y-4">
                {streamItems.length > 0 ? streamItems.map((item) => {
                  if (item.itemType === 'ASSIGNMENT') {
                    const assignment = item.payload;
                    return (
                      <article
                        key={`assignment-${assignment.id}`}
                        data-testid={`assignment-link-${assignment.id}`}
                        role="link"
                        tabIndex={0}
                        onClick={() => navigate(`/assignment/${assignment.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`/assignment/${assignment.id}`);
                          }
                        }}
                        className="block bg-surface-container-lowest rounded-xl shadow-sm border border-slate-100/10 p-6 hover:shadow-md transition-all cursor-pointer group focus:outline-none focus:ring-2 focus:ring-primary/60"
                      >
                        <div data-testid={`assignment-card-${assignment.id}`} className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white">
                            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>assignment</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center flex-wrap gap-2 mb-1">
                              <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-primary border border-primary/20">
                                Assignment
                              </span>
                              {assignment.due_date && (
                                <span className="text-xs text-slate-500">Due {formatDate(assignment.due_date)}</span>
                              )}
                            </div>
                            <p className="text-sm font-bold text-slate-900 group-hover:text-primary transition-colors truncate">{assignment.title}</p>
                            {assignment.description && (
                              <p className="text-xs text-slate-500 mt-1 truncate">{assignment.description}</p>
                            )}
                          </div>
                          {user?.role === 'TEACHER' && (
                            <div className="flex items-center gap-2">
                              <Link
                                to={`/assignment/${assignment.id}/grade`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-[10px] font-bold uppercase tracking-widest text-primary hover:bg-primary/5 px-2 py-1 rounded-full border border-primary/20 transition-colors"
                              >
                                Grade
                              </Link>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteAssignment(e, assignment)}
                                disabled={deletingAssignmentId === assignment.id}
                                className="text-[10px] font-bold uppercase tracking-widest text-red-600 hover:bg-red-50 px-2 py-1 rounded-full border border-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {deletingAssignmentId === assignment.id ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>
                          )}
                          <span className="material-symbols-outlined text-slate-300 group-hover:text-primary transition-colors">chevron_right</span>
                        </div>
                      </article>
                    );
                  }

                  if (item.itemType === 'ANNOUNCEMENT') {
                    const announcement = item.payload;
                    return (
                      <article
                        key={`announcement-${announcement.id}`}
                        className="bg-surface-container-lowest rounded-xl shadow-sm border border-slate-100/10 p-6 hover:shadow-md transition-all group"
                      >
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-full bg-tertiary flex items-center justify-center text-white shrink-0">
                            <span className="material-symbols-outlined">campaign</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center flex-wrap gap-2 mb-1">
                              <span className="inline-flex items-center rounded-full bg-tertiary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-tertiary border border-tertiary/20">
                                Announcement
                              </span>
                              <span className="text-xs text-slate-500">{formatDate(announcement.created_at)}</span>
                            </div>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                              {announcement.message}
                            </p>
                          </div>
                          {user?.role === 'TEACHER' && (
                            <button
                              type="button"
                              onClick={(e) => handleDeleteAnnouncement(e, announcement)}
                              disabled={deletingAnnouncementId === announcement.id}
                              className="text-[10px] font-bold uppercase tracking-widest text-red-600 hover:bg-red-50 px-2 py-1 rounded-full border border-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {deletingAnnouncementId === announcement.id ? 'Deleting...' : 'Delete'}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  }

                  const lesson = item.payload;
                  const isQuiz = item.itemType === 'QUIZ';
                  const lessonDestination =
                    user?.role === 'TEACHER'
                      ? `/lesson/edit?lessonId=${lesson.id}`
                      : `/lesson/live?lessonId=${lesson.id}`;
                  const accentColorClass = isQuiz ? 'group-hover:text-amber-600' : 'group-hover:text-secondary';
                  const iconContainerClass = isQuiz ? 'bg-amber-500' : 'bg-secondary';
                  const tagClass = isQuiz
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-secondary/10 text-secondary border-secondary/20';

                  return (
                    <article
                      key={`lesson-${lesson.id}`}
                      data-testid={`lesson-link-${lesson.id}`}
                      role="link"
                      tabIndex={0}
                      onClick={() => navigate(lessonDestination)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(lessonDestination);
                        }
                      }}
                      className="bg-surface-container-lowest rounded-xl shadow-sm border border-slate-100/10 p-6 hover:shadow-md transition-all cursor-pointer group focus:outline-none focus:ring-2 focus:ring-secondary/50"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full ${iconContainerClass} flex items-center justify-center text-white`}>
                          <span className="material-symbols-outlined">{isQuiz ? 'quiz' : 'auto_stories'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center flex-wrap gap-2 mb-1">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest border ${tagClass}`}>
                              {isQuiz ? 'Quiz' : 'Lesson'}
                            </span>
                            <span className="text-xs text-slate-500" data-testid={`lesson-status-${lesson.id}`}>
                              {lesson.status === 'DRAFT' && <span className="text-slate-400">Draft</span>}
                              {lesson.status === 'PUBLISHED' && <span className="text-secondary">Published</span>}
                              {lesson.status && ` | ${formatDate(lesson.created_at)}`}
                            </span>
                          </div>
                          <p className={`text-sm font-bold text-slate-900 transition-colors truncate ${accentColorClass}`}>
                            {lesson.title}
                          </p>
                        </div>
                        {user?.role === 'TEACHER' && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteLesson(e, lesson)}
                            disabled={deletingLessonId === lesson.id}
                            className="text-[10px] font-bold uppercase tracking-widest text-red-600 hover:bg-red-50 px-2 py-1 rounded-full border border-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {deletingLessonId === lesson.id ? 'Deleting...' : 'Delete'}
                          </button>
                        )}
                        <span className={`material-symbols-outlined text-slate-300 transition-colors ${accentColorClass}`}>chevron_right</span>
                      </div>
                    </article>
                  );
                }) : (
                  <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-slate-100/10 p-8 text-center">
                    <span className="material-symbols-outlined text-4xl text-slate-300 mb-2 block">inbox</span>
                    <p className="text-slate-400 text-sm">No stream posts yet</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      </div>
      
      {/* FAB for Teachers */}
      {user?.role === 'TEACHER' && (
        <button
          onClick={() => { setCreateError(''); setShowCreateAssignment(true); }}
          disabled={isArchivedClass}
          className="fixed bottom-8 right-8 w-14 h-14 bg-primary text-white rounded-full shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center z-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-3xl">add</span>
        </button>
      )}

      {/* Create Announcement Modal */}
      {showCreateAnnouncement && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCreateAnnouncement(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-8" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-on-surface mb-2">Create Announcement</h2>
            <p className="text-sm text-on-surface-variant mb-6">Post an announcement to everyone in this class stream.</p>
            {announcementCreateError && (
              <div className="text-error text-sm mb-4 bg-error-container/30 p-3 rounded-lg">{announcementCreateError}</div>
            )}
            <form onSubmit={handleCreateAnnouncement} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Message *
                </label>
                <textarea
                  data-testid="create-announcement-message-input"
                  value={announcementMessage}
                  onChange={(e) => setAnnouncementMessage(e.target.value)}
                  required
                  rows={5}
                  placeholder="Share an update, reminder, or instruction..."
                  className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface rounded-t-lg resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateAnnouncement(false)}
                  className="flex-1 py-3 rounded-full border-2 border-outline/30 text-on-surface font-semibold hover:bg-surface-container-high transition-colors"
                >
                  Cancel
                </button>
                <button
                  data-testid="create-announcement-submit"
                  type="submit"
                  disabled={announcementCreateLoading}
                  className="flex-1 py-3 rounded-full bg-tertiary text-white font-semibold shadow-lg hover:shadow-xl transition-all active:scale-95 disabled:opacity-50"
                >
                  {announcementCreateLoading ? 'Posting...' : 'Post'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Assignment Modal */}
      {showCreateAssignment && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCreateAssignment(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-8" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-on-surface mb-2">Create Assignment</h2>
            <p className="text-sm text-on-surface-variant mb-6">Add a new assignment for your class.</p>
            {createError && <div className="text-error text-sm mb-4 bg-error-container/30 p-3 rounded-lg">{createError}</div>}
            <form onSubmit={handleCreateAssignment} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Title *</label>
                <input
                  data-testid="create-assignment-title-input"
                  type="text"
                  value={assignTitle}
                  onChange={(e) => setAssignTitle(e.target.value)}
                  required
                  placeholder="e.g., Chapter 3 Review"
                  className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface rounded-t-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Description</label>
                <textarea
                  data-testid="create-assignment-description-input"
                  value={assignDesc}
                  onChange={(e) => setAssignDesc(e.target.value)}
                  placeholder="Assignment instructions..."
                  rows={3}
                  className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface rounded-t-lg resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Due Date</label>
                <input
                  type="datetime-local"
                  value={assignDue}
                  onChange={(e) => setAssignDue(e.target.value)}
                  className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface rounded-t-lg"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreateAssignment(false)} className="flex-1 py-3 rounded-full border-2 border-outline/30 text-on-surface font-semibold hover:bg-surface-container-high transition-colors">Cancel</button>
                <button data-testid="create-assignment-submit" type="submit" disabled={createLoading} className="flex-1 py-3 rounded-full signature-gradient text-white font-semibold shadow-lg hover:shadow-xl transition-all active:scale-95 disabled:opacity-50">
                  {createLoading ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Lesson Modal */}
      {showCreateLesson && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={closeCreateLessonModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-8" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-on-surface mb-2">Create {createModeLabel}</h2>
            <p className="text-sm text-on-surface-variant mb-6">
              {createContentType === 'quiz'
                ? 'Create a new quiz and open it in the editor.'
                : 'Create a new interactive lesson for your class.'}
            </p>
            {lessonCreateError && <div className="text-error text-sm mb-4 bg-error-container/30 p-3 rounded-lg">{lessonCreateError}</div>}
            <form onSubmit={handleCreateLesson} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">{createModeLabel} Title *</label>
                <input
                  data-testid="create-lesson-title-input"
                  type="text"
                  value={lessonTitle}
                  onChange={(e) => setLessonTitle(e.target.value)}
                  required
                  placeholder={createContentType === 'quiz' ? 'e.g., Unit 2 Quiz' : 'e.g., Introduction to Neural Networks'}
                  className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface rounded-t-lg"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeCreateLessonModal} className="flex-1 py-3 rounded-full border-2 border-outline/30 text-on-surface font-semibold hover:bg-surface-container-high transition-colors">Cancel</button>
                <button data-testid="create-lesson-submit" type="submit" disabled={lessonCreateLoading} className="flex-1 py-3 rounded-full bg-secondary text-white font-semibold shadow-lg hover:shadow-xl transition-all active:scale-95 disabled:opacity-50">
                  {lessonCreateLoading ? 'Creating...' : `Create ${createModeLabel}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Generate AI Lesson Modal */}
      {showGenerateAi && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto p-4 sm:p-6" onClick={closeGenerateAiModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 sm:p-8 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full signature-gradient flex items-center justify-center text-white">
                <span className="material-symbols-outlined">magic_button</span>
              </div>
              <h2 className="text-2xl font-bold text-on-surface">Generate {generateModeLabel}</h2>
            </div>
            <p className="text-sm text-on-surface-variant mb-6">
              {generateContentType === 'quiz'
                ? 'Let the AI draft a ready-to-edit quiz for this class.'
                : 'Let the AI draft a complete interactive notebook for you.'}
            </p>
            {aiError && <div className="text-error text-sm mb-4 bg-error-container/30 p-3 rounded-lg overflow-y-auto max-h-32 whitespace-pre-wrap">{aiError}</div>}
            
            {aiLoading ? (() => {
              const stageThresholds = [0.28, 0.62, 1.0];
              const progress = aiEstimateSeconds > 0 ? aiElapsedSeconds / aiEstimateSeconds : 0;
              const currentStage = progress < stageThresholds[0] ? 0 : progress < stageThresholds[1] ? 1 : 2;
              const safeTopic = aiTopic || 'this topic';

              const stages = [
                {
                  header: 'Structural Strategy',
                  subtitle: `Outlining pedagogical flow and mapping learning objectives for ${safeTopic}...`,
                },
                {
                  header: 'Interactivity Scaling',
                  subtitle: `Optimizing block ratio (${aiInteractivity}%) and selecting topic-aware interactive elements...`,
                },
                {
                  header: 'Content Synthesis',
                  subtitle:
                    generateContentType === 'quiz'
                      ? 'Finalizing quiz blocks and answer structure for classroom delivery...'
                      : 'Finalizing interactive simulations and notebook-style blocks for university-level delivery...',
                },
              ];

              return (
                <div className="py-6 space-y-5">
                  <div className="space-y-0">
                    {stages.map((stage, i) => {
                      const isActive = i === currentStage;
                      const isDone = i < currentStage;
                      const isFuture = i > currentStage;

                      return (
                        <div key={i} className="flex items-start gap-3 relative">
                          {/* Vertical connector line */}
                          <div className="flex flex-col items-center">
                            {/* Indicator dot */}
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-500 ${
                              isDone
                                ? 'bg-primary'
                                : isActive
                                ? 'bg-primary/20 ring-[3px] ring-primary/40 animate-pulse'
                                : 'bg-outline-variant/30'
                            }`}>
                              {isDone ? (
                                <span className="material-symbols-outlined text-white text-xs" style={{ fontSize: '14px' }}>check</span>
                              ) : isActive ? (
                                <div className="w-2 h-2 rounded-full bg-primary" />
                              ) : (
                                <div className="w-1.5 h-1.5 rounded-full bg-outline-variant/50" />
                              )}
                            </div>
                            {/* Connector */}
                            {i < stages.length - 1 && (
                              <div className={`w-0.5 h-8 transition-colors duration-500 ${isDone ? 'bg-primary/40' : 'bg-outline-variant/20'}`} />
                            )}
                          </div>

                          {/* Text content */}
                          <div className={`pt-0 pb-3 transition-opacity duration-500 ${isFuture ? 'opacity-35' : 'opacity-100'}`}>
                            <p className={`text-sm font-bold tracking-tight leading-tight ${
                              isActive ? 'text-on-surface' : isDone ? 'text-on-surface/70' : 'text-on-surface-variant'
                            }`}>
                              {stage.header}
                            </p>
                            <p className={`text-xs leading-relaxed mt-0.5 ${
                              isActive ? 'text-on-surface-variant' : 'text-on-surface-variant/60'
                            }`}>
                              {stage.subtitle}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Elapsed time */}
                  <p className="text-[11px] text-on-surface-variant/60 text-center tabular-nums tracking-wide">
                    {formatDuration(aiElapsedSeconds)} elapsed
                    {aiElapsedSeconds > aiEstimateSeconds && (
                      <span className="text-tertiary font-medium"> - taking longer than usual</span>
                    )}
                  </p>

                  <button
                    type="button"
                    onClick={() => { if (aiAbortRef.current) aiAbortRef.current.abort(); }}
                    className="w-full py-2.5 rounded-full border border-outline/20 text-on-surface-variant font-medium text-sm hover:bg-surface-container-high transition-colors active:scale-[0.98]"
                  >
                    Cancel Generation
                  </button>
                </div>
              );
            })() : (
              <form onSubmit={handleGenerateAILesson} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">{generateModeLabel} Topic *</label>
                  <input
                    type="text"
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value)}
                    required
                    placeholder={generateContentType === 'quiz' ? 'e.g., Algebra - Linear Equations' : 'e.g., The Photoelectric Effect'}
                    className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface rounded-t-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Reference Content (Optional)</label>
                  <textarea
                    value={aiReferenceContent}
                    onChange={(e) => setAiReferenceContent(e.target.value)}
                    onPaste={handleReferencePaste}
                    placeholder="Paste notes, text, or specific concepts for the AI to follow..."
                    className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface rounded-t-lg min-h-[100px] resize-none"
                  ></textarea>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Reference Files (Optional)</label>
                  <div
                    onDragOver={handleReferenceDragOver}
                    onDragLeave={handleReferenceDragLeave}
                    onDrop={handleReferenceDrop}
                    className={`rounded-xl border-2 border-dashed px-3 py-3 transition-colors ${
                      referenceDropActive
                        ? 'border-primary bg-primary/5'
                        : 'border-outline/40 bg-surface-container-low'
                    }`}
                  >
                    <input
                      ref={referenceFileInputRef}
                      type="file"
                      multiple
                      accept={REFERENCE_FILE_ACCEPT}
                      onChange={handleReferenceFilesSelected}
                      className="hidden"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-on-surface-variant">
                        Drag and drop files here, paste from clipboard, or attach manually.
                      </p>
                      <button
                        type="button"
                        onClick={() => referenceFileInputRef.current?.click()}
                        className="inline-flex items-center justify-center rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-on hover:brightness-95 active:scale-[0.98]"
                      >
                        Select Files
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-on-surface-variant/80">
                    You can attach PDFs, PowerPoint, images, docs, spreadsheets, text/code files, and other model-supported formats. Limit: {MAX_REFERENCE_FILES} files, {formatBytes(MAX_REFERENCE_FILE_BYTES)} each, {formatBytes(MAX_REFERENCE_TOTAL_BYTES)} total.
                  </p>
                  {aiReferenceFilesLoading && (
                    <p className="mt-2 text-xs text-primary">Processing selected files...</p>
                  )}
                  {aiReferenceFiles.length > 0 && (
                    <div className="mt-2 border border-outline/20 rounded-lg p-2 max-h-32 overflow-y-auto bg-surface-container-low">
                      <p className="text-[11px] text-on-surface-variant mb-2">
                        Attached {aiReferenceFiles.length} file(s) - {formatBytes(aiReferenceTotalBytes)}
                      </p>
                      <div className="space-y-1">
                        {aiReferenceFiles.map((file, index) => (
                          <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 text-xs">
                            <span className="truncate text-on-surface">{file.name}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveReferenceFile(index)}
                              className="text-error hover:underline shrink-0"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {hasAttachedPdfs && (
                    <div className={`mt-2 rounded-lg border px-2 py-2 ${
                      requiresPdfSnapshots
                        ? 'border-error/40 bg-error/10'
                        : 'border-primary/30 bg-primary/10'
                    }`}>
                      <p className={`text-[11px] ${
                        requiresPdfSnapshots ? 'text-error' : 'text-primary'
                      }`}>
                        {pdfSnapshotStatusLine}
                      </p>
                      {requiresPdfSnapshots && (
                        <p className="mt-1 text-[11px] text-error">
                          {pdfSnapshotBlockingMessage}
                        </p>
                      )}
                    </div>
                  )}
                  {aiReferenceImages.length > 0 && (
                    <div className="mt-2 border border-primary/20 rounded-lg p-2 max-h-36 overflow-y-auto bg-primary/5">
                      <p className="text-[11px] text-on-surface-variant mb-2">
                        Visual references prepared: {aiReferenceImages.length} image(s) - {formatBytes(aiReferenceImageTotalBytes)}
                      </p>
                      <p className="text-[10px] text-on-surface-variant/80 mb-2">
                        Includes uploaded images and PDF page snapshots (up to {MAX_PDF_SNAPSHOT_PAGES} sampled pages per PDF). Limit: {MAX_REFERENCE_IMAGES} images, {formatBytes(MAX_REFERENCE_IMAGE_BYTES)} each, {formatBytes(MAX_REFERENCE_IMAGE_TOTAL_BYTES)} total.
                      </p>
                      <div className="space-y-1">
                        {aiReferenceImages.map((image, index) => (
                          <div key={`${buildReferenceImageKey(image)}-${index}`} className="flex items-center justify-between gap-2 text-xs">
                            <span className="truncate text-on-surface">
                              {image.name}
                              {image.source === 'pdf_snapshot' && image.sourcePage ? ` (p.${image.sourcePage})` : ''}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveReferenceImage(index)}
                              className="text-error hover:underline shrink-0"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Target Audience</label>
                    <select
                      value={aiGrade}
                      onChange={(e) => setAiGrade(e.target.value)}
                      className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface rounded-t-lg"
                    >
                      <option value="Middle School">Middle School</option>
                      <option value="High School">High School</option>
                      <option value="College Undergraduate">College</option>
                      <option value="Professional / Advanced">Advanced</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Duration (mins)</label>
                    <input
                      type="number"
                      value={aiDuration}
                      onChange={(e) => setAiDuration(e.target.value)}
                      min="5" max="120"
                      className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface rounded-t-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Default Code Runtime</label>
                  <select
                    value={aiDefaultCodeLanguage}
                    onChange={(e) => setAiDefaultCodeLanguage(e.target.value)}
                    className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-3 py-3 transition-colors outline-none text-on-surface rounded-t-lg"
                  >
                    <option value="javascript">JavaScript</option>
                    <option value="python">Python</option>
                    <option value="c">C</option>
                    <option value="cpp">C++</option>
                    <option value="java">Java</option>
                    <option value="php">PHP</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Interactivity Level - {aiInteractivity}%</label>
                  <input
                    type="range"
                    min="0" max="100" step="5"
                    value={aiInteractivity}
                    onChange={(e) => setAiInteractivity(Number(e.target.value))}
                    className="w-full accent-primary cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-on-surface-variant mt-1 font-medium">
                    <span>Lecture-heavy</span>
                    <span>Balanced</span>
                    <span>Hands-on</span>
                  </div>
                </div>
                <div className="flex gap-3 pt-4 sticky bottom-0 bg-white pb-1">
                  <button type="button" onClick={closeGenerateAiModal} className="flex-1 py-3 rounded-full border-2 border-outline/30 text-on-surface font-semibold hover:bg-surface-container-high transition-colors">Cancel</button>
                  <button
                    type="submit"
                    disabled={isGenerateBlocked}
                    className={`flex-1 py-3 rounded-full font-semibold shadow-lg transition-all ${
                      isGenerateBlocked
                        ? 'bg-outline/40 text-on-surface-variant cursor-not-allowed shadow-none'
                        : 'signature-gradient text-white hover:shadow-xl active:scale-95'
                    }`}
                  >
                    {`Generate ${generateModeLabel}`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {showClassInfo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowClassInfo(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-8" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-on-surface mb-2">Class Information</h2>
            <p className="text-sm text-on-surface-variant mb-6">Quick summary of this class stream.</p>
            <div className="space-y-3 text-sm">
              <p><span className="font-semibold">Class ID:</span> <span className="font-mono">{classId}</span></p>
              <p><span className="font-semibold">Assignments:</span> {assignments.length}</p>
              <p><span className="font-semibold">Lessons:</span> {lessons.length}</p>
              <p><span className="font-semibold">Role:</span> {user?.role}</p>
              <p><span className="font-semibold">Status:</span> {isArchivedClass ? 'Archived' : 'Active'}</p>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowClassInfo(false)}
                className="px-5 py-2 rounded-full signature-gradient text-white font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

