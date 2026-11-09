import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { API_BASE_URL, lessonService } from '../services/api';
import useAuthStore from '../store/useAuthStore';
import InteractiveSimulationBlock from '../components/InteractiveSimulationBlock';
import CodeNotebookBlock from '../components/CodeNotebookBlock';
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

// Simple ID generator for local new blocks
const generateId = () => Math.random().toString(36).substr(2, 9);

const defaultSimulationContent = () => ({
  title: 'Interactive Simulation',
  description: 'Describe what this simulation teaches.',
  template: 'vanilla',
  hint: '',
  solutionText: '',
  html: '<div id="app"></div>',
  css: '',
  js: '// Simulation code - use context.app, context.input, context.helpers\nconst { app } = context;\napp.innerHTML = "<h3>Hello Simulation!</h3><p>Edit the code to build your visualization.</p>";',
  libs: [],
  height: 420,
  inputJson: '{}',
});

const BLOCK_TYPES_WITH_OBJECT_CONTENT = new Set([
  'QUIZ',
  'EXERCISE',
  'WRITTEN_QUIZ',
  'INTERACTIVE_SIMULATION',
  'MERMAID_DIAGRAM',
  'STATIC_CHART',
]);

const defaultQuizContent = () => ({
  question: '',
  options: [
    { text: '', isCorrect: true, feedback: '' },
    { text: '', isCorrect: false, feedback: '' },
  ],
  timeLimit: 30,
});

const defaultWrittenQuizContent = () => ({
  question: '',
  idealAnswer: '',
});

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

const normalizeSimulationContent = (raw) => {
  const base = defaultSimulationContent();
  const parsed = parseJsonObject(raw) || {};

  const sandpackFiles = sanitizeSimulationFiles(parsed.files);
  if (sandpackFiles) {
    const template = parsed.template === 'vanilla' ? 'vanilla' : 'react';
    const html =
      template === 'vanilla'
        ? sandpackFiles['/index.html'] || base.html
        : sandpackFiles['/index.html'] || '<div id="root"></div>';
    const css = sandpackFiles['/styles.css'] || base.css;
    const js =
      template === 'vanilla'
        ? sandpackFiles['/index.js'] || base.js
        : sandpackFiles['/App.js'] || sandpackFiles['/index.js'] || base.js;

    return {
      ...base,
      template,
      files: sandpackFiles,
      title: typeof parsed.title === 'string' ? parsed.title : base.title,
      description: typeof parsed.description === 'string' ? parsed.description : base.description,
      hint: typeof parsed.hint === 'string' ? parsed.hint : base.hint,
      solutionText: typeof parsed.solutionText === 'string' ? parsed.solutionText : base.solutionText,
      html,
      css,
      js,
    };
  }

  if (parsed.canvasSandbox && typeof parsed.canvasSandbox === 'object' && parsed.canvasSandbox.enabled) {
    const legacySandbox = parsed.canvasSandbox;
    return {
      ...base,
      title: typeof parsed.title === 'string' ? parsed.title : base.title,
      description: typeof parsed.description === 'string' ? parsed.description : base.description,
      hint: typeof parsed.hint === 'string' ? parsed.hint : base.hint,
      solutionText: typeof parsed.solutionText === 'string' ? parsed.solutionText : base.solutionText,
      html: typeof legacySandbox.html === 'string' ? legacySandbox.html : base.html,
      css: typeof legacySandbox.css === 'string' ? legacySandbox.css : base.css,
      js: typeof legacySandbox.js === 'string' ? legacySandbox.js : base.js,
      libs: Array.isArray(legacySandbox.libs) ? legacySandbox.libs : base.libs,
      height: Number(legacySandbox.height) > 0 ? Number(legacySandbox.height) : base.height,
      inputJson:
        typeof legacySandbox.inputJson === 'string'
          ? legacySandbox.inputJson
          : JSON.stringify(legacySandbox.inputJson ?? {}),
    };
  }

  return {
    ...base,
    title: typeof parsed.title === 'string' ? parsed.title : base.title,
    description: typeof parsed.description === 'string' ? parsed.description : base.description,
    hint: typeof parsed.hint === 'string' ? parsed.hint : base.hint,
    solutionText: typeof parsed.solutionText === 'string' ? parsed.solutionText : base.solutionText,
    html: typeof parsed.html === 'string' ? parsed.html : base.html,
    css: typeof parsed.css === 'string' ? parsed.css : base.css,
    js: typeof parsed.js === 'string' ? parsed.js : base.js,
    libs: Array.isArray(parsed.libs) ? parsed.libs.filter((v) => typeof v === 'string') : base.libs,
    height: Number(parsed.height) > 0 ? Number(parsed.height) : base.height,
    inputJson:
      typeof parsed.inputJson === 'string'
        ? parsed.inputJson
        : JSON.stringify(parsed.inputJson ?? {}),
  };
};

const getDefaultContentForType = (type) => {
  if (type === 'CODE') return { defaultLanguage: 'javascript', code: '' };
  if (type === 'QUIZ' || type === 'EXERCISE') return defaultQuizContent();
  if (type === 'WRITTEN_QUIZ') return defaultWrittenQuizContent();
  if (type === 'INTERACTIVE_SIMULATION') return defaultSimulationContent();
  if (type === 'MERMAID_DIAGRAM') return { code: 'graph TD;\n  A[Start] --> B[End];' };
  if (type === 'STATIC_CHART') return { chartType: 'bar', title: 'Sample Data', dataKey: 'value', data: [{ name: 'A', value: 10 }, { name: 'B', value: 20 }] };
  return '';
};

const normalizeCodeContent = (raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }

  if (typeof raw !== 'string') {
    return { defaultLanguage: 'javascript', code: '' };
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Keep legacy raw content as code text.
    }
  }

  return { defaultLanguage: 'javascript', code: raw };
};

const TEXT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/jpg,image/webp,image/gif,image/bmp,image/tiff,image/svg+xml';
const TEXT_IMAGE_MIN_CROP_PERCENT = 5;
const TEXT_IMAGE_DRAW_MIN_CROP_PERCENT = 1;
const TEXT_IMAGE_MAX_OUTPUT_DIMENSION = 1600;
const TEXT_IMAGE_MARKDOWN_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;

const clampNumber = (value, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file?.name || 'image file'}`));
    reader.readAsDataURL(file);
  });

const loadImageFromDataUrl = (dataUrl) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image for cropping.'));
    img.src = String(dataUrl || '');
  });

const parseDataUrlMimeType = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:([^;,]+)[;,]/i);
  return match ? String(match[1] || '').toLowerCase() : '';
};

const toImageAltFallback = (fileName = '') =>
  String(fileName || '')
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Lesson image';

const escapeMarkdownInlineText = (value) =>
  String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .trim();

const escapeMarkdownTitleText = (value) =>
  String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, '\\"')
    .trim();

const buildMarkdownImageToken = ({ alt, url, title = '' }) => {
  const safeAlt = escapeMarkdownInlineText(alt) || 'Lesson image';
  const safeUrl = String(url || '').trim();
  const safeTitle = escapeMarkdownTitleText(title);
  if (!safeUrl) return '';
  return safeTitle
    ? `![${safeAlt}](${safeUrl} "${safeTitle}")`
    : `![${safeAlt}](${safeUrl})`;
};

const parseMarkdownImageTokens = (textValue) => {
  const content = String(textValue || '');
  const tokens = [];
  const re = new RegExp(TEXT_IMAGE_MARKDOWN_RE);
  let match;
  while ((match = re.exec(content)) !== null) {
    const full = match[0];
    tokens.push({
      markdown: full,
      alt: String(match[1] || ''),
      url: String(match[2] || ''),
      title: String(match[3] || ''),
      start: match.index,
      end: match.index + full.length,
    });
  }
  return tokens;
};

const insertImageMarkdownAtSelection = ({ content, snippet, start, end }) => {
  const safeContent = String(content || '');
  const safeSnippet = String(snippet || '').trim();
  const safeStart = clampNumber(start, 0, safeContent.length);
  const safeEnd = clampNumber(end, safeStart, safeContent.length);

  if (!safeSnippet) {
    return { nextContent: safeContent, cursorIndex: safeEnd };
  }

  const before = safeContent.slice(0, safeStart);
  const after = safeContent.slice(safeEnd);
  const needsLeadingBreak = before.length > 0 && !/\n\s*$/.test(before);
  const needsTrailingBreak = after.length > 0 && !/^\s*\n/.test(after);
  const prefix = needsLeadingBreak ? '\n\n' : '';
  const suffix = needsTrailingBreak ? '\n\n' : '';
  const inserted = `${prefix}${safeSnippet}${suffix}`;
  const nextContent = `${before}${inserted}${after}`;

  return {
    nextContent,
    cursorIndex: before.length + inserted.length,
  };
};

const removeImageMarkdownAtRange = ({ content, start, end }) => {
  const safeContent = String(content || '');
  const safeStart = clampNumber(start, 0, safeContent.length);
  const safeEnd = clampNumber(end, safeStart, safeContent.length);
  const nextContent = `${safeContent.slice(0, safeStart)}${safeContent.slice(safeEnd)}`
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return {
    nextContent,
    cursorIndex: safeStart,
  };
};

export default function LessonEditor() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const searchParams = new URLSearchParams(location.search);
  const lessonIdFromQuery = searchParams.get('lessonId');
  const [activeLessonId, setActiveLessonId] = useState(lessonIdFromQuery);

  const [lesson, setLesson] = useState(null);
  const [title, setTitle] = useState('Untitled Lesson');
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // AI Assistant menu toggle
  const [showAiMenu, setShowAiMenu] = useState(false);
  const [aiEditTargetId, setAiEditTargetId] = useState(null);
  const [aiEditInstructions, setAiEditInstructions] = useState('');
  const [aiEditLoading, setAiEditLoading] = useState(false);
  const [aiEditTimer, setAiEditTimer] = useState(0);
  const aiEditAbortControllerRef = useRef(null);
  const aiEditImageInputRef = useRef(null);
  const [aiEditReferenceImages, setAiEditReferenceImages] = useState([]);
  const [aiEditReferenceImagesLoading, setAiEditReferenceImagesLoading] = useState(false);
  const [aiEditReferenceDropActive, setAiEditReferenceDropActive] = useState(false);
  const [aiEditError, setAiEditError] = useState('');
  const textImageInputRef = useRef(null);
  const textAreaRefs = useRef(new Map());
  const textCropStageRef = useRef(null);
  const textCropImageRef = useRef(null);
  const textCropDragStateRef = useRef({
    active: false,
    mode: '',
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    originWidth: 100,
    originHeight: 100,
  });
  const [textImagePickerTarget, setTextImagePickerTarget] = useState(null);
  const [textImageActionError, setTextImageActionError] = useState('');
  const [textImageActionErrorBlockId, setTextImageActionErrorBlockId] = useState('');
  const [textImageCropModal, setTextImageCropModal] = useState({
    isOpen: false,
    mode: 'insert',
    blockLocalId: '',
    sourceDataUrl: '',
    sourceMimeType: '',
    sourceLabel: '',
    altText: '',
    titleText: '',
    selectionStart: 0,
    selectionEnd: 0,
    replaceStart: 0,
    replaceEnd: 0,
    naturalWidth: 0,
    naturalHeight: 0,
    cropX: 0,
    cropY: 0,
    cropWidth: 100,
    cropHeight: 100,
    interactionMode: 'draw',
    applying: false,
    error: '',
  });
  const isTeacher = user?.role === 'TEACHER';
  const shouldMarkNewBlocksAsEdited = lesson?.status === 'PUBLISHED';
  const hasQuizBlock = blocks.some((block) => block.type === 'QUIZ');
  const canPublishLesson = isTeacher && !lesson?.owner_student_id;
  const canRunLive = isTeacher && hasQuizBlock && !lesson?.owner_student_id;
  const canUseAiRefine = isTeacher;
  const isStudentGlobalLesson = user?.role === 'STUDENT' && !lesson?.owner_student_id;
  const isStudentPersonalLesson = user?.role === 'STUDENT' && lesson?.owner_student_id === user?.id;

  useEffect(() => {
    setActiveLessonId(lessonIdFromQuery);
  }, [lessonIdFromQuery]);

  useEffect(() => {
    let interval;
    if (aiEditLoading) {
      setAiEditTimer(0);
      interval = setInterval(() => {
        setAiEditTimer((prev) => prev + 1);
      }, 1000);
    } else {
      setAiEditTimer(0);
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [aiEditLoading]);

  const mapServerBlockToEditorBlock = (block) => {
    let parsedContent = block.content;

    if (BLOCK_TYPES_WITH_OBJECT_CONTENT.has(block.type)) {
      const parsed = parseJsonObject(block.content);
      if (block.type === 'INTERACTIVE_SIMULATION') {
        parsedContent = normalizeSimulationContent(parsed || block.content);
      } else {
        parsedContent = parsed || getDefaultContentForType(block.type);
      }
    } else if (block.type === 'CODE') {
      parsedContent = normalizeCodeContent(block.content);
    }

    return {
      ...block,
      id: block.id,
      localId: block.id || generateId(),
      content: parsedContent,
      isExisting: Boolean(block.id),
      is_post_publish_addition: Boolean(block.is_post_publish_addition),
    };
  };

  // Code execution is now handled inside CodeNotebookBlock (sandboxed iframe)

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (!activeLessonId) {
      navigate('/dashboard');
      return;
    }
    fetchLesson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLessonId, user, navigate]);

  const fetchLesson = async () => {
    try {
      setLoading(true);
      const data = await lessonService.getById(activeLessonId);
      setLesson(data);
      setTitle(data.title);

      if (data.blocks && data.blocks.length > 0) {
        setBlocks(data.blocks.map(mapServerBlockToEditorBlock));
      } else {
        // Init with one empty text block
        setBlocks([{ localId: generateId(), type: 'TEXT', content: '', isExisting: false, is_post_publish_addition: false }]);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load lesson');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (status = lesson?.status) => {
    setSaving(true);
    setError('');
    try {
      const sanitizedBlocks = blocks.map((b) => ({
        id: b.id,
        type: b.type,
        content: b.content,
        is_post_publish_addition: Boolean(b.is_post_publish_addition),
      }));

      const updatedLesson = await lessonService.update(activeLessonId, {
        title,
        status,
        blocks: sanitizedBlocks
      });

      if (updatedLesson?.id && updatedLesson.id !== activeLessonId) {
        setActiveLessonId(updatedLesson.id);
        navigate(`/lesson/edit?lessonId=${encodeURIComponent(updatedLesson.id)}`, { replace: true });
      }

      setLesson(updatedLesson);
      setTitle(updatedLesson.title);
      setBlocks((updatedLesson.blocks || []).map(mapServerBlockToEditorBlock));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save lesson');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const isBlockLocked = () => false;

  const updateBlock = (localId, newContent) => {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.localId !== localId) return b;
        if (isBlockLocked(b)) return b;
        return { ...b, content: newContent };
      })
    );
  };

  const registerTextAreaRef = (localId, node) => {
    if (!localId) return;
    if (node) {
      textAreaRefs.current.set(localId, node);
      return;
    }
    textAreaRefs.current.delete(localId);
  };

  const focusTextAreaAt = (localId, cursorIndex) => {
    window.setTimeout(() => {
      const input = textAreaRefs.current.get(localId);
      if (!input) return;
      const bounded = clampNumber(cursorIndex, 0, String(input.value || '').length);
      input.focus();
      input.setSelectionRange(bounded, bounded);
    }, 0);
  };

  const getTextSelectionForBlock = (localId, fallbackContent = '') => {
    const input = textAreaRefs.current.get(localId);
    const fallbackLength = String(fallbackContent || '').length;
    if (!input) {
      return { selectionStart: fallbackLength, selectionEnd: fallbackLength };
    }
    const selectionStart = clampNumber(input.selectionStart, 0, fallbackLength);
    const selectionEnd = clampNumber(input.selectionEnd, selectionStart, fallbackLength);
    return { selectionStart, selectionEnd };
  };

  const setTextImageErrorForBlock = (blockLocalId, message) => {
    setTextImageActionError(String(message || ''));
    setTextImageActionErrorBlockId(String(blockLocalId || ''));
  };

  const clearTextImageError = () => {
    setTextImageActionError('');
    setTextImageActionErrorBlockId('');
  };

  const closeTextImageCropModal = () => {
    textCropDragStateRef.current = {
      active: false,
      mode: '',
      pointerId: null,
      startX: 0,
      startY: 0,
      originX: 0,
      originY: 0,
      originWidth: 100,
      originHeight: 100,
    };
    setTextImageCropModal((previous) => ({
      ...previous,
      isOpen: false,
      applying: false,
      error: '',
    }));
  };

  const openTextImageCropModal = async ({
    blockLocalId,
    mode,
    sourceDataUrl,
    sourceMimeType,
    sourceLabel,
    altText,
    titleText,
    selectionStart,
    selectionEnd,
    replaceStart,
    replaceEnd,
  }) => {
    try {
      const image = await loadImageFromDataUrl(sourceDataUrl);
      setTextImageCropModal({
        isOpen: true,
        mode: mode === 'replace' ? 'replace' : 'insert',
        blockLocalId: String(blockLocalId || ''),
        sourceDataUrl: String(sourceDataUrl || ''),
        sourceMimeType: String(sourceMimeType || '').toLowerCase(),
        sourceLabel: String(sourceLabel || '').trim(),
        altText: String(altText || '').trim() || 'Lesson image',
        titleText: String(titleText || '').trim(),
        selectionStart: clampNumber(selectionStart, 0, Number.MAX_SAFE_INTEGER),
        selectionEnd: clampNumber(selectionEnd, 0, Number.MAX_SAFE_INTEGER),
        replaceStart: clampNumber(replaceStart, 0, Number.MAX_SAFE_INTEGER),
        replaceEnd: clampNumber(replaceEnd, 0, Number.MAX_SAFE_INTEGER),
        naturalWidth: Math.max(1, Math.round(image.naturalWidth || image.width || 1)),
        naturalHeight: Math.max(1, Math.round(image.naturalHeight || image.height || 1)),
        cropX: 0,
        cropY: 0,
        cropWidth: 100,
        cropHeight: 100,
        interactionMode: 'draw',
        applying: false,
        error: '',
      });
    } catch (err) {
      console.error('Failed to open text image crop modal:', err);
      setTextImageErrorForBlock(blockLocalId, 'Unable to read this image for cropping.');
    }
  };

  const openInsertImagePicker = (blockLocalId, blockContent) => {
    if (!isTeacher) return;
    const block = blocks.find((candidate) => candidate.localId === blockLocalId);
    if (!block || block.type !== 'TEXT' || isBlockLocked(block)) {
      return;
    }
    const { selectionStart, selectionEnd } = getTextSelectionForBlock(blockLocalId, blockContent);
    setTextImagePickerTarget({
      blockLocalId,
      selectionStart,
      selectionEnd,
    });
    clearTextImageError();
    textImageInputRef.current?.click();
  };

  const handleTextImageFileSelected = async (event) => {
    const selectedFile = Array.from(event.target.files || [])[0];
    event.target.value = '';

    if (!selectedFile) return;
    if (!textImagePickerTarget?.blockLocalId) return;

    if (!isImageLikeFile(selectedFile)) {
      setTextImageErrorForBlock(textImagePickerTarget.blockLocalId, 'Please choose an image file.');
      return;
    }

    try {
      clearTextImageError();
      const sourceDataUrl = await readFileAsDataUrl(selectedFile);
      const sourceMimeType = parseDataUrlMimeType(sourceDataUrl) || String(selectedFile.type || '').toLowerCase();
      await openTextImageCropModal({
        blockLocalId: textImagePickerTarget.blockLocalId,
        mode: 'insert',
        sourceDataUrl,
        sourceMimeType,
        sourceLabel: selectedFile.name,
        altText: toImageAltFallback(selectedFile.name),
        titleText: '',
        selectionStart: textImagePickerTarget.selectionStart,
        selectionEnd: textImagePickerTarget.selectionEnd,
        replaceStart: 0,
        replaceEnd: 0,
      });
    } catch (err) {
      console.error('Failed to process selected text image:', err);
      setTextImageErrorForBlock(
        textImagePickerTarget.blockLocalId,
        'Failed to load selected image. Please try another file.'
      );
    } finally {
      setTextImagePickerTarget(null);
    }
  };

  const handleCropExistingTextImage = async (blockLocalId, imageToken) => {
    if (!isTeacher) return;
    const block = blocks.find((candidate) => candidate.localId === blockLocalId);
    if (!block || block.type !== 'TEXT' || isBlockLocked(block)) return;

    const imageUrl = String(imageToken?.url || '').trim();
    if (!/^data:image\//i.test(imageUrl)) {
      setTextImageErrorForBlock(
        blockLocalId,
        'Only embedded images can be cropped. Reinsert this image as an upload to crop it.'
      );
      return;
    }

    clearTextImageError();
    await openTextImageCropModal({
      blockLocalId,
      mode: 'replace',
      sourceDataUrl: imageUrl,
      sourceMimeType: parseDataUrlMimeType(imageUrl),
      sourceLabel: imageToken?.alt || 'Inline image',
      altText: String(imageToken?.alt || '').trim() || 'Lesson image',
      titleText: String(imageToken?.title || '').trim(),
      selectionStart: 0,
      selectionEnd: 0,
      replaceStart: clampNumber(imageToken?.start, 0, Number.MAX_SAFE_INTEGER),
      replaceEnd: clampNumber(imageToken?.end, 0, Number.MAX_SAFE_INTEGER),
    });
  };

  const handleDeleteInlineTextImage = (blockLocalId, imageToken) => {
    if (!isTeacher) return;
    const block = blocks.find((candidate) => candidate.localId === blockLocalId);
    if (!block || block.type !== 'TEXT' || isBlockLocked(block)) return;

    const start = clampNumber(imageToken?.start, 0, Number.MAX_SAFE_INTEGER);
    const end = clampNumber(imageToken?.end, start, Number.MAX_SAFE_INTEGER);
    let nextCursorIndex = null;

    setBlocks((previousBlocks) =>
      previousBlocks.map((candidate) => {
        if (candidate.localId !== blockLocalId || candidate.type !== 'TEXT') {
          return candidate;
        }
        const removed = removeImageMarkdownAtRange({
          content: String(candidate.content || ''),
          start,
          end,
        });
        nextCursorIndex = removed.cursorIndex;
        return {
          ...candidate,
          content: removed.nextContent,
        };
      })
    );

    if (nextCursorIndex !== null) {
      focusTextAreaAt(blockLocalId, nextCursorIndex);
    }
    clearTextImageError();
  };

  const getPointerPercentInCropStage = (event) => {
    const stage = textCropStageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const clientX = Number(event?.clientX);
    const clientY = Number(event?.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

    const x = clampNumber(((clientX - rect.left) / rect.width) * 100, 0, 100);
    const y = clampNumber(((clientY - rect.top) / rect.height) * 100, 0, 100);
    return { x, y };
  };

  const handleTextCropStagePointerDown = (event) => {
    if (!textImageCropModal.isOpen || textImageCropModal.applying) return;
    if (event.button !== undefined && event.button !== 0) return;

    const point = getPointerPercentInCropStage(event);
    if (!point) return;

    const insideCurrentCrop =
      point.x >= textImageCropModal.cropX &&
      point.x <= textImageCropModal.cropX + textImageCropModal.cropWidth &&
      point.y >= textImageCropModal.cropY &&
      point.y <= textImageCropModal.cropY + textImageCropModal.cropHeight;

    const isNearlyFullImageCrop =
      textImageCropModal.cropWidth >= 99.5 && textImageCropModal.cropHeight >= 99.5;
    const requestedMode =
      textImageCropModal.interactionMode === 'move' && !isNearlyFullImageCrop
        ? 'move'
        : 'draw';
    const activeMode = requestedMode === 'move' && insideCurrentCrop ? 'move' : 'draw';

    textCropDragStateRef.current = {
      active: true,
      mode: activeMode,
      pointerId: Number.isFinite(Number(event.pointerId)) ? Number(event.pointerId) : null,
      startX: point.x,
      startY: point.y,
      originX: textImageCropModal.cropX,
      originY: textImageCropModal.cropY,
      originWidth: textImageCropModal.cropWidth,
      originHeight: textImageCropModal.cropHeight,
    };

    if (activeMode === 'draw') {
      setTextImageCropModal((previous) => ({
        ...previous,
        cropX: point.x,
        cropY: point.y,
        cropWidth: TEXT_IMAGE_DRAW_MIN_CROP_PERCENT,
        cropHeight: TEXT_IMAGE_DRAW_MIN_CROP_PERCENT,
        error: '',
      }));
    }

    const stage = textCropStageRef.current;
    if (stage?.setPointerCapture && event.pointerId !== undefined) {
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        // ignore pointer-capture failures
      }
    }
    event.preventDefault();
  };

  const handleTextCropStagePointerMove = (event) => {
    const drag = textCropDragStateRef.current;
    if (!drag.active) return;
    if (drag.pointerId !== null && event.pointerId !== undefined && drag.pointerId !== event.pointerId) {
      return;
    }

    const point = getPointerPercentInCropStage(event);
    if (!point) return;

    if (drag.mode === 'move') {
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      const nextX = clampNumber(drag.originX + dx, 0, 100 - drag.originWidth);
      const nextY = clampNumber(drag.originY + dy, 0, 100 - drag.originHeight);
      setTextImageCropModal((previous) => ({
        ...previous,
        cropX: nextX,
        cropY: nextY,
        error: '',
      }));
      event.preventDefault();
      return;
    }

    if (drag.mode === 'draw') {
      const left = Math.min(drag.startX, point.x);
      const top = Math.min(drag.startY, point.y);
      const right = Math.max(drag.startX, point.x);
      const bottom = Math.max(drag.startY, point.y);
      const width = clampNumber(right - left, TEXT_IMAGE_DRAW_MIN_CROP_PERCENT, 100 - left);
      const height = clampNumber(bottom - top, TEXT_IMAGE_DRAW_MIN_CROP_PERCENT, 100 - top);
      setTextImageCropModal((previous) => ({
        ...previous,
        cropX: left,
        cropY: top,
        cropWidth: width,
        cropHeight: height,
        error: '',
      }));
      event.preventDefault();
    }
  };

  const handleTextCropStagePointerUp = (event) => {
    const drag = textCropDragStateRef.current;
    if (!drag.active) return;
    if (drag.pointerId !== null && event.pointerId !== undefined && drag.pointerId !== event.pointerId) {
      return;
    }

    const stage = textCropStageRef.current;
    if (stage?.releasePointerCapture && event.pointerId !== undefined) {
      try {
        stage.releasePointerCapture(event.pointerId);
      } catch {
        // ignore pointer-capture failures
      }
    }

    if (drag.mode === 'draw') {
      setTextImageCropModal((previous) => {
        const cropWidth = clampNumber(previous.cropWidth, TEXT_IMAGE_MIN_CROP_PERCENT, 100);
        const cropHeight = clampNumber(previous.cropHeight, TEXT_IMAGE_MIN_CROP_PERCENT, 100);
        const cropX = clampNumber(previous.cropX, 0, 100 - cropWidth);
        const cropY = clampNumber(previous.cropY, 0, 100 - cropHeight);
        return {
          ...previous,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
          interactionMode: 'move',
          error: '',
        };
      });
    }

    textCropDragStateRef.current = {
      active: false,
      mode: '',
      pointerId: null,
      startX: 0,
      startY: 0,
      originX: 0,
      originY: 0,
      originWidth: 100,
      originHeight: 100,
    };
  };

  const handleResetTextImageCrop = () => {
    setTextImageCropModal((previous) => ({
      ...previous,
      cropX: 0,
      cropY: 0,
      cropWidth: 100,
      cropHeight: 100,
      interactionMode: 'draw',
      error: '',
    }));
  };

  const handleApplyTextImageCrop = async () => {
    if (!textImageCropModal.isOpen || textImageCropModal.applying) return;
    if (!textImageCropModal.blockLocalId) return;

    setTextImageCropModal((previous) => ({
      ...previous,
      applying: true,
      error: '',
    }));

    try {
      const previewImage = textCropImageRef.current;
      const image =
        previewImage && previewImage.naturalWidth > 0
          ? previewImage
          : await loadImageFromDataUrl(String(textImageCropModal.sourceDataUrl || ''));
      const sourceWidth = Math.max(1, Math.round(image.naturalWidth || image.width || 1));
      const sourceHeight = Math.max(1, Math.round(image.naturalHeight || image.height || 1));

      const sx = Math.floor((textImageCropModal.cropX / 100) * sourceWidth);
      const sy = Math.floor((textImageCropModal.cropY / 100) * sourceHeight);
      const sw = Math.max(
        1,
        Math.floor((textImageCropModal.cropWidth / 100) * sourceWidth)
      );
      const sh = Math.max(
        1,
        Math.floor((textImageCropModal.cropHeight / 100) * sourceHeight)
      );

      const boundedSw = Math.min(sw, sourceWidth - sx);
      const boundedSh = Math.min(sh, sourceHeight - sy);

      const outputScale = Math.min(
        1,
        TEXT_IMAGE_MAX_OUTPUT_DIMENSION / Math.max(1, boundedSw, boundedSh)
      );
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(boundedSw * outputScale));
      canvas.height = Math.max(1, Math.round(boundedSh * outputScale));
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) {
        throw new Error('Canvas context unavailable.');
      }

      ctx.drawImage(image, sx, sy, boundedSw, boundedSh, 0, 0, canvas.width, canvas.height);

      const sourceMime = String(textImageCropModal.sourceMimeType || '').toLowerCase();
      const outputMime = sourceMime === 'image/png' || sourceMime === 'image/webp' || sourceMime === 'image/gif'
        ? 'image/png'
        : 'image/jpeg';
      const croppedDataUrl = canvas.toDataURL(outputMime, outputMime === 'image/jpeg' ? 0.82 : undefined);

      const imageMarkdown = buildMarkdownImageToken({
        alt: textImageCropModal.altText,
        url: croppedDataUrl,
        title: textImageCropModal.titleText,
      });
      if (!imageMarkdown) {
        throw new Error('Failed to produce markdown image token.');
      }

      let nextCursorIndex = null;
      setBlocks((previousBlocks) =>
        previousBlocks.map((candidate) => {
          if (candidate.localId !== textImageCropModal.blockLocalId || candidate.type !== 'TEXT') {
            return candidate;
          }
          const content = String(candidate.content || '');

          if (textImageCropModal.mode === 'replace') {
            const replaceStart = clampNumber(textImageCropModal.replaceStart, 0, content.length);
            const replaceEnd = clampNumber(textImageCropModal.replaceEnd, replaceStart, content.length);
            const nextContent = `${content.slice(0, replaceStart)}${imageMarkdown}${content.slice(replaceEnd)}`;
            nextCursorIndex = replaceStart + imageMarkdown.length;
            return { ...candidate, content: nextContent };
          }

          const inserted = insertImageMarkdownAtSelection({
            content,
            snippet: imageMarkdown,
            start: textImageCropModal.selectionStart,
            end: textImageCropModal.selectionEnd,
          });
          nextCursorIndex = inserted.cursorIndex;
          return { ...candidate, content: inserted.nextContent };
        })
      );

      if (nextCursorIndex !== null) {
        focusTextAreaAt(textImageCropModal.blockLocalId, nextCursorIndex);
      }

      closeTextImageCropModal();
      clearTextImageError();
    } catch (err) {
      console.error('Failed to apply text image crop:', err);
      setTextImageCropModal((previous) => ({
        ...previous,
        applying: false,
        error: String(err?.message || 'Failed to crop image.'),
      }));
      return;
    }

    setTextImageCropModal((previous) => ({
      ...previous,
      applying: false,
    }));
  };

  const addBlock = (type, insertAfterIndex = null) => {
    const newBlock = {
      localId: generateId(),
      type,
      content: getDefaultContentForType(type),
      isExisting: false,
      is_post_publish_addition: shouldMarkNewBlocksAsEdited,
    };
    setBlocks((prev) => {
      if (insertAfterIndex === null || insertAfterIndex < 0 || insertAfterIndex >= prev.length) {
        return [...prev, newBlock];
      }
      const next = [...prev];
      next.splice(insertAfterIndex + 1, 0, newBlock);
      return next;
    });
    setShowAiMenu(false);
  };

  const deleteBlock = (localId) => {
    setBlocks((prev) => {
      const target = prev.find((b) => b.localId === localId);
      if (!target || isBlockLocked(target)) {
        return prev;
      }
      return prev.filter((b) => b.localId !== localId);
    });
  };

  const openAiRefineModal = (localId) => {
    const target = blocks.find((b) => b.localId === localId);
    if (!target || isBlockLocked(target)) {
      return;
    }
    setAiEditTargetId(localId);
    setAiEditInstructions('');
    setAiEditReferenceImages([]);
    setAiEditReferenceImagesLoading(false);
    setAiEditReferenceDropActive(false);
    setAiEditError('');
  };

  const closeAiRefineModal = () => {
    if (aiEditLoading) {
      aiEditAbortControllerRef.current?.abort();
      setAiEditLoading(false);
      setAiEditTimer(0);
    }
    setAiEditTargetId(null);
    setAiEditInstructions('');
    setAiEditReferenceImages([]);
    setAiEditReferenceImagesLoading(false);
    setAiEditReferenceDropActive(false);
    setAiEditError('');
  };

  const ingestAiEditReferenceImages = async (incomingFiles) => {
    const selectedFiles = Array.from(incomingFiles || []).filter(Boolean);
    if (selectedFiles.length === 0) return;

    const imageFiles = selectedFiles.filter((file) => isImageLikeFile(file));
    if (imageFiles.length === 0) {
      setAiEditError('Only image files are supported for AI refine context.');
      return;
    }

    setAiEditError('');

    const existingKeys = new Set(aiEditReferenceImages.map((image) => buildImagePayloadKey(image)));
    const dedupedSelected = imageFiles.filter((file) => !existingKeys.has(buildImagePayloadKey(file)));
    if (dedupedSelected.length === 0) {
      setAiEditError('All selected images are already attached.');
      return;
    }

    if (aiEditReferenceImages.length + dedupedSelected.length > REFINE_MAX_IMAGES) {
      setAiEditError(`You can attach up to ${REFINE_MAX_IMAGES} images.`);
      return;
    }

    const oversized = dedupedSelected.find((file) => (Number(file?.size) || 0) > REFINE_MAX_IMAGE_BYTES);
    if (oversized) {
      setAiEditError(`"${oversized.name}" is too large. Maximum per image is ${formatBytes(REFINE_MAX_IMAGE_BYTES)}.`);
      return;
    }

    const currentTotalBytes = aiEditReferenceImages.reduce((sum, image) => sum + (Number(image?.size) || 0), 0);
    const selectedTotalBytes = dedupedSelected.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
    if (currentTotalBytes + selectedTotalBytes > REFINE_MAX_IMAGE_TOTAL_BYTES) {
      setAiEditError(`Total image size cannot exceed ${formatBytes(REFINE_MAX_IMAGE_TOTAL_BYTES)}.`);
      return;
    }

    setAiEditReferenceImagesLoading(true);
    try {
      const payloads = await Promise.all(dedupedSelected.map((file) => readImageFileAsBase64Payload(file)));
      setAiEditReferenceImages((previous) => [...previous, ...payloads]);
    } catch (err) {
      console.error('Failed to process AI refine reference images:', err);
      setAiEditError('Failed to read one or more images. Please try again.');
    } finally {
      setAiEditReferenceImagesLoading(false);
    }
  };

  const handleAiEditReferenceImagesSelected = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    await ingestAiEditReferenceImages(selectedFiles);
  };

  const handleAiEditReferenceImagePaste = async (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const pastedFiles = items
      .filter((item) => item?.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean)
      .filter((file) => isImageLikeFile(file));

    if (pastedFiles.length === 0) return;
    event.preventDefault();
    await ingestAiEditReferenceImages(pastedFiles);
  };

  const handleAiEditReferenceImageDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setAiEditReferenceDropActive(false);
    const droppedFiles = Array.from(event.dataTransfer?.files || []);
    await ingestAiEditReferenceImages(droppedFiles);
  };

  const handleAiEditReferenceImageDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!aiEditReferenceDropActive) {
      setAiEditReferenceDropActive(true);
    }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleAiEditReferenceImageDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nextTarget = event.relatedTarget;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setAiEditReferenceDropActive(false);
  };

  const handleRemoveAiEditReferenceImage = (indexToRemove) => {
    setAiEditReferenceImages((previous) => previous.filter((_, index) => index !== indexToRemove));
  };

  const handleAiRefineBlock = async (e) => {
    e.preventDefault();
    if (!aiEditTargetId || !activeLessonId) return;
    if (aiEditReferenceImagesLoading) {
      setAiEditError('Attached images are still processing. Please wait a moment and retry.');
      return;
    }

    const targetBlock = blocks.find((b) => b.localId === aiEditTargetId);
    if (!targetBlock) {
      setAiEditError('Selected block is no longer available.');
      return;
    }

    try {
      aiEditAbortControllerRef.current = new AbortController();
      setAiEditLoading(true);
      setAiEditError('');

      const result = await lessonService.refineBlockAi(activeLessonId, {
        blockType: targetBlock.type,
        blockContent: targetBlock.content,
        instructions: aiEditInstructions,
        referenceImages: aiEditReferenceImages,
      }, { signal: aiEditAbortControllerRef.current.signal });

      if (!Object.prototype.hasOwnProperty.call(result || {}, 'content')) {
        throw new Error('AI returned an invalid response for this block');
      }

      updateBlock(targetBlock.localId, result.content);
      setAiEditTargetId(null);
      setAiEditInstructions('');
      setAiEditReferenceImages([]);
      setAiEditReferenceDropActive(false);
      setAiEditError('');
    } catch (err) {
      if (isRequestCanceled(err)) {
        return;
      }
      const classified = classifyRequestError(err, {
        apiBaseUrl: API_BASE_URL,
        fallbackMessage: 'Failed to refine this block with AI.',
        timeoutMessage: 'AI refinement timed out. Please retry with shorter instructions.',
      });
      if (classified.kind !== 'canceled') {
        setAiEditError(classified.message);
      }
    } finally {
      if (!aiEditAbortControllerRef.current?.signal.aborted) {
        setAiEditLoading(false);
      }
    }
  };

  const moveBlock = (index, direction) => {
    if (direction === -1 && index === 0) return;
    if (direction === 1 && index === blocks.length - 1) return;

    const newBlocks = [...blocks];
    const temp = newBlocks[index];
    newBlocks[index] = newBlocks[index + direction];
    newBlocks[index + direction] = temp;
    setBlocks(newBlocks);
  };

  const renderEditedBadge = (block) =>
    block?.is_post_publish_addition ? (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-amber-100 text-amber-700 border border-amber-300">
        Edited
      </span>
    ) : null;

  // UI rendering helpers for blocks
  const renderBlock = (block, index) => {
    const locked = isBlockLocked(block);

    if (block.type === 'TEXT') {
      const textContent = String(block.content || '');
      const inlineImages = parseMarkdownImageTokens(textContent);
      return (
        <section key={block.localId} className="group relative bg-surface-container-lowest rounded-xl p-8 transition-all hover:shadow-lg notebook-line border-l-2 border-transparent hover:border-l-primary mb-8">
          <BlockControls index={index} localId={block.localId} locked={locked} />
          <div className="flex items-center gap-2 mb-4 text-xs font-bold text-outline tracking-widest uppercase">
            <span className="material-symbols-outlined text-sm">subject</span> Explanation
            {renderEditedBadge(block)}
          </div>
          {isTeacher && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openInsertImagePicker(block.localId, textContent)}
                disabled={locked}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-semibold hover:bg-primary/10 transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">add_photo_alternate</span>
                Add Image At Cursor
              </button>
              <p className="text-[11px] text-outline">
                Place the cursor where you want the image, then insert and optionally crop.
              </p>
            </div>
          )}
          <textarea
            ref={(node) => registerTextAreaRef(block.localId, node)}
            className="w-full text-lg leading-relaxed text-on-surface bg-transparent resize-y outline-none border-b border-transparent focus:border-primary/30 transition-colors disabled:opacity-80"
            placeholder="Type explanation here..."
            rows={4}
            value={textContent}
            readOnly={locked}
            disabled={locked}
            onChange={(e) => updateBlock(block.localId, e.target.value)}
          />
          {textImageActionError && textImageActionErrorBlockId === block.localId && (
            <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {textImageActionError}
            </div>
          )}
          {isTeacher && inlineImages.length > 0 && (
            <div className="mt-4 rounded-xl border border-outline-variant/20 bg-surface-container-low px-3 py-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-outline">Inline Images</p>
              <div className="space-y-2">
                {inlineImages.map((imageToken, imageIndex) => {
                  const imageUrl = String(imageToken.url || '').trim();
                  const canPreview = /^data:image\//i.test(imageUrl) || /^https:\/\//i.test(imageUrl);
                  const canCrop = /^data:image\//i.test(imageUrl);
                  return (
                    <div
                      key={`${block.localId}-${imageToken.start}-${imageIndex}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-2 py-2"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        {canPreview ? (
                          <img
                            src={imageUrl}
                            alt={imageToken.alt || `Image ${imageIndex + 1}`}
                            className="h-10 w-12 rounded object-cover border border-outline-variant/30 bg-white"
                          />
                        ) : (
                          <div className="h-10 w-12 rounded border border-outline-variant/30 bg-surface-container flex items-center justify-center text-outline">
                            <span className="material-symbols-outlined text-sm">image</span>
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-on-surface">
                            {imageToken.alt || `Image ${imageIndex + 1}`}
                          </p>
                          <p className="truncate text-[11px] text-outline">
                            {canCrop ? 'Embedded image' : 'External image'}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleCropExistingTextImage(block.localId, imageToken)}
                          disabled={locked || !canCrop}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-outline-variant/40 text-xs font-semibold text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-40"
                          title={canCrop ? 'Crop this image' : 'Only embedded images can be cropped'}
                        >
                          <span className="material-symbols-outlined text-sm">crop</span>
                          Crop
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteInlineTextImage(block.localId, imageToken)}
                          disabled={locked}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-red-300/60 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors disabled:opacity-40"
                          title="Delete this image from text"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="mt-5 rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-outline">Textbook Preview</p>
            <TextbookContentBlock content={textContent} />
          </div>
        </section>
      );
    }

    if (block.type === 'CODE') {
      return (
        <section key={block.localId} className="group relative mb-8">
          <BlockControls index={index} localId={block.localId} dark locked={locked} />
          <div className="mb-2 ml-3">{renderEditedBadge(block)}</div>
          <CodeNotebookBlock
            content={block.content}
            onChange={(v) => updateBlock(block.localId, v)}
            editable={!locked}
            blockId={block.localId}
          />
        </section>
      );
    }

    if (block.type === 'DISCUSSION') {
      return (
        <section key={block.localId} className="group relative bg-primary-fixed rounded-xl p-8 transition-all hover:shadow-lg notebook-line border-l-2 border-transparent hover:border-l-primary mb-8">
          <BlockControls index={index} localId={block.localId} locked={locked} />
          <div className="flex items-center gap-2 mb-4 text-xs font-bold text-on-primary-fixed-variant tracking-widest uppercase">
            <span className="material-symbols-outlined text-sm">forum</span> Discussion Prompt
            {renderEditedBadge(block)}
          </div>
          <textarea
            className="w-full text-xl font-medium text-on-primary-fixed bg-transparent resize-y outline-none"
            placeholder="What should students discuss?"
            rows={3}
            value={block.content}
            readOnly={locked}
            disabled={locked}
            onChange={(e) => updateBlock(block.localId, e.target.value)}
          />
        </section>
      );
    }

    if (block.type === 'QUIZ' || block.type === 'EXERCISE') {
      const qData = typeof block.content === 'object' ? block.content : { question: '', options: [], timeLimit: 30 };
      return (
        <section key={block.localId} className="group relative bg-surface-container-lowest rounded-xl p-8 transition-all hover:shadow-lg notebook-line border-l-2 border-transparent hover:border-l-primary mb-8">
          <BlockControls index={index} localId={block.localId} locked={locked} />
          <div className={`flex items-center gap-2 mb-6 text-xs font-bold tracking-widest uppercase ${block.type === 'EXERCISE' ? 'text-primary' : 'text-secondary'}`}>
            <span className="material-symbols-outlined text-sm">{block.type === 'EXERCISE' ? 'menu_book' : 'quiz'}</span> {block.type === 'EXERCISE' ? 'Check for Understanding' : 'MCQ Block'}
            {renderEditedBadge(block)}
          </div>
          {block.type === 'QUIZ' && (
            <div className="mb-6 flex items-center gap-4">
              <label className="text-sm font-semibold text-outline-variant">Time Limit (seconds):</label>
              <input
                type="number"
                min="10"
                className="w-24 bg-surface-container-low border border-outline-variant rounded-md px-3 py-1 text-on-surface outline-none focus:border-primary"
                value={qData.timeLimit === undefined ? 30 : qData.timeLimit}
                disabled={locked}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    updateBlock(block.localId, { ...qData, timeLimit: 0 });
                  } else {
                    const parsed = parseInt(val, 10);
                    if (!isNaN(parsed)) {
                      updateBlock(block.localId, { ...qData, timeLimit: parsed });
                    }
                  }
                }}
                onBlur={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (isNaN(val) || val < 10) {
                    updateBlock(block.localId, { ...qData, timeLimit: 10 });
                  }
                }}
              />
            </div>
          )}
          <input
            type="text"
            className="w-full text-xl font-semibold mb-6 bg-transparent outline-none border-b border-outline-variant focus:border-primary pb-2"
            placeholder="Question goes here..."
            value={qData.question || ''}
            disabled={locked}
            onChange={(e) => updateBlock(block.localId, { ...qData, question: e.target.value })}
          />
          <div className="space-y-3">
            {(qData.options || []).map((opt, optIndex) => (
              <div key={optIndex} className={`flex items-center p-4 rounded-lg bg-surface-container-low border transition-all ${opt.isCorrect ? 'border-primary bg-primary/5' : 'border-transparent'}`}>
                <button
                  onClick={() => {
                    if (locked) return;
                    const newOpts = [...qData.options];
                    newOpts.forEach(o => o.isCorrect = false);
                    newOpts[optIndex].isCorrect = true;
                    updateBlock(block.localId, { ...qData, options: newOpts });
                  }}
                  className={`w-5 h-5 rounded-full border-2 mr-4 flex items-center justify-center flex-shrink-0 ${opt.isCorrect ? 'border-primary' : 'border-outline hover:border-primary'}`}
                >
                  {opt.isCorrect && <div className="w-2.5 h-2.5 bg-primary rounded-full"></div>}
                </button>
                <input
                  type="text"
                  className={`w-full bg-transparent outline-none font-medium ${opt.isCorrect ? 'text-primary' : 'text-on-surface'}`}
                  placeholder={`Option ${optIndex + 1}`}
                  value={opt.text}
                  disabled={locked}
                  onChange={(e) => {
                    const newOpts = [...qData.options];
                    newOpts[optIndex].text = e.target.value;
                    updateBlock(block.localId, { ...qData, options: newOpts });
                  }}
                />
                {block.type === 'EXERCISE' && (
                  <input
                    type="text"
                    className="w-full bg-transparent outline-none font-medium ml-4 text-xs text-outline-variant italic border-l pl-4"
                    placeholder={`Feedback ${optIndex + 1}`}
                    value={opt.feedback || ''}
                    disabled={locked}
                    onChange={(e) => {
                      const newOpts = [...qData.options];
                      newOpts[optIndex].feedback = e.target.value;
                      updateBlock(block.localId, { ...qData, options: newOpts });
                    }}
                  />
                )}
                <button onClick={() => {
                  if (locked) return;
                  const newOpts = qData.options.filter((_, i) => i !== optIndex);
                  updateBlock(block.localId, { ...qData, options: newOpts });
                }} className="text-outline hover:text-error ml-2 disabled:opacity-40" type="button" disabled={locked}>
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                if (locked) return;
                updateBlock(block.localId, { ...qData, options: [...(qData.options || []), { text: '', isCorrect: false, feedback: '' }] });
              }}
              className="mt-4 text-sm font-semibold text-primary hover:bg-primary/5 px-4 py-2 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40"
              disabled={locked}
            >
              <span className="material-symbols-outlined text-sm">add</span> Add Option
            </button>
          </div>
        </section>
      );
    }
    if (block.type === 'WRITTEN_QUIZ') {
      const qData = typeof block.content === 'object' ? block.content : { question: '', idealAnswer: '' };
      return (
        <section key={block.localId} className="group relative bg-surface-container-lowest rounded-xl p-8 transition-all hover:shadow-lg notebook-line border-l-2 border-transparent hover:border-l-primary mb-8">
          <BlockControls index={index} localId={block.localId} locked={locked} />
          <div className="flex items-center gap-2 mb-6 text-xs font-bold tracking-widest uppercase text-amber-600">
            <span className="material-symbols-outlined text-sm">edit_document</span> Written Question Block
            {renderEditedBadge(block)}
          </div>
          <input
            type="text"
            className="w-full text-xl font-semibold mb-6 bg-transparent outline-none border-b border-outline-variant focus:border-primary pb-2"
            placeholder="Question goes here..."
            value={qData.question || ''}
            disabled={locked}
            onChange={(e) => updateBlock(block.localId, { ...qData, question: e.target.value })}
          />
          <textarea
            className="w-full text-base leading-relaxed text-on-surface bg-surface-container-low rounded-lg p-4 resize-y outline-none border border-outline-variant focus:border-primary transition-colors"
            placeholder="Write the ideal answer here. AI will use this to evaluate students' answers..."
            rows={4}
            value={qData.idealAnswer || ''}
            disabled={locked}
            onChange={(e) => updateBlock(block.localId, { ...qData, idealAnswer: e.target.value })}
          />
        </section>
      );
    }

    if (block.type === 'INTERACTIVE_SIMULATION') {
      const simData = normalizeSimulationContent(block.content);
      const appendTagIfMissing = (html, regex, tagMarkup) => {
        if (regex.test(html)) return html;
        if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tagMarkup}\n</body>`);
        return `${html}\n${tagMarkup}`;
      };
      const normalizeHtmlForVanilla = (rawHtml) => {
        const html =
          typeof rawHtml === 'string' && rawHtml.trim() ? rawHtml : '<main id="app"></main>';
        if (!/<html[\s>]/i.test(html)) {
          return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    ${html}
    <script src="/index.js"></script>
  </body>
</html>`;
        }
        let result = appendTagIfMissing(
          html,
          /<link[^>]+href=["']\/styles\.css["']/i,
          '<link rel="stylesheet" href="/styles.css" />'
        );
        result = appendTagIfMissing(
          result,
          /<script[^>]+src=["']\/index\.js["']/i,
          '<script src="/index.js"></script>'
        );
        return result;
      };
      const buildSandpackFiles = (nextData) => {
        const template = nextData.template === 'vanilla' ? 'vanilla' : 'react';
        if (template === 'react') {
          return {
            '/App.js': typeof nextData.js === 'string' ? nextData.js : '',
            '/styles.css': typeof nextData.css === 'string' ? nextData.css : '',
          };
        }
        return {
          '/index.html': normalizeHtmlForVanilla(nextData.html),
          '/index.js': typeof nextData.js === 'string' ? nextData.js : '',
          '/styles.css': typeof nextData.css === 'string' ? nextData.css : '',
        };
      };
      const updateSimulation = (changes) => {
        const nextData = { ...simData, ...changes };
        const touchedCodeField =
          Object.prototype.hasOwnProperty.call(changes, 'template') ||
          Object.prototype.hasOwnProperty.call(changes, 'html') ||
          Object.prototype.hasOwnProperty.call(changes, 'css') ||
          Object.prototype.hasOwnProperty.call(changes, 'js');
        if (touchedCodeField || !nextData.files || typeof nextData.files !== 'object') {
          nextData.files = buildSandpackFiles(nextData);
        }
        updateBlock(block.localId, nextData);
      };
      const libsToText = (libs) => (Array.isArray(libs) ? libs.join('\n') : '');
      const parseLibsText = (text) =>
        text
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => /^https?:\/\/\S+$/i.test(s));

      return (
        <section key={block.localId} className="group relative bg-surface-container-lowest rounded-xl p-8 transition-all hover:shadow-lg notebook-line border-l-2 border-transparent hover:border-l-primary mb-8">
          <BlockControls index={index} localId={block.localId} locked={locked} />
          <div className="flex items-center gap-2 mb-6 text-xs font-bold tracking-widest uppercase text-primary">
            <span className="material-symbols-outlined text-sm">experiment</span> Interactive Simulation
            {renderEditedBadge(block)}
          </div>

          {/* Title & Height */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-2">Title</label>
              <input type="text" disabled={locked} className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-80" value={simData.title || ''} onChange={(e) => updateSimulation({ title: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-2">Height (px)</label>
              <input type="number" min={280} disabled={locked} className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-80" value={Number(simData.height) > 0 ? Number(simData.height) : 420} onChange={(e) => updateSimulation({ height: Number(e.target.value) || 420 })} />
            </div>
          </div>

          {/* Description, Hint, Solution */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-2">Description</label>
              <textarea rows={2} disabled={locked} className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary resize-y disabled:opacity-80" value={simData.description || ''} onChange={(e) => updateSimulation({ description: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-2">Hint</label>
              <input type="text" disabled={locked} className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-80" value={simData.hint || ''} onChange={(e) => updateSimulation({ hint: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-2">Solution Text</label>
              <textarea rows={2} disabled={locked} className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary resize-y disabled:opacity-80" value={simData.solutionText || ''} onChange={(e) => updateSimulation({ solutionText: e.target.value })} />
            </div>
          </div>

          {/* Canvas Code Editors */}
          <div className="rounded-xl border border-outline-variant/25 bg-surface-container-low p-4 space-y-4 mb-6">
            <p className="text-[10px] font-bold uppercase tracking-widest text-outline">Canvas Code</p>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-2">HTML Markup</label>
              <textarea rows={5} disabled={locked} className="w-full bg-white border border-outline-variant/40 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-primary resize-y disabled:opacity-80" value={typeof simData.html === 'string' ? simData.html : ''} onChange={(e) => updateSimulation({ html: e.target.value })} spellCheck={false} />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-2">CSS Styles</label>
              <textarea rows={5} disabled={locked} className="w-full bg-[#1c1f21] text-slate-100 border border-outline-variant/40 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-primary resize-y disabled:opacity-80" value={typeof simData.css === 'string' ? simData.css : ''} onChange={(e) => updateSimulation({ css: e.target.value })} spellCheck={false} />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-2">JavaScript</label>
              <textarea rows={12} disabled={locked} className="w-full bg-[#1c1f21] text-slate-100 border border-outline-variant/40 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-primary resize-y disabled:opacity-80" value={typeof simData.js === 'string' ? simData.js : ''} onChange={(e) => updateSimulation({ js: e.target.value })} spellCheck={false} />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-2">External Libraries (one URL per line)</label>
              <textarea rows={2} disabled={locked} className="w-full bg-white border border-outline-variant/40 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-primary resize-y disabled:opacity-80" placeholder="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js" value={libsToText(simData.libs)} onChange={(e) => updateSimulation({ libs: parseLibsText(e.target.value) })} />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-2">Input JSON</label>
              <textarea
                rows={3}
                disabled={locked}
                className="w-full bg-white border border-outline-variant/40 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-primary resize-y disabled:opacity-80"
                placeholder='{"value":10,"speed":2}'
                value={typeof simData.inputJson === 'string' ? simData.inputJson : JSON.stringify(simData.inputJson ?? {}, null, 2)}
                onChange={(e) => updateSimulation({ inputJson: e.target.value })}
              />
            </div>
            <p className="text-[11px] text-outline">
              Use <code>context.app</code>, <code>context.input</code>, and <code>context.helpers</code> in your JavaScript.
            </p>
          </div>

          {/* Preview */}
          <div className="rounded-xl border border-outline-variant/20 p-4 bg-surface-container-low">
            <p className="text-[10px] font-bold uppercase tracking-widest text-outline mb-3">Preview</p>
            <InteractiveSimulationBlock block={{ ...block, content: simData }} compact />
          </div>
        </section>
      );
    }
    if (block.type === 'MERMAID_DIAGRAM') {
      const mData = typeof block.content === 'object' ? block.content : { code: '' };
      return (
        <section key={block.localId} className="group relative bg-surface-container-lowest rounded-xl p-8 transition-all hover:shadow-lg notebook-line border-l-2 border-transparent hover:border-l-primary mb-8">
          <BlockControls index={index} localId={block.localId} locked={locked} />
          <div className="flex items-center gap-2 mb-4 text-xs font-bold text-outline tracking-widest uppercase">
            <span className="material-symbols-outlined text-sm">account_tree</span> Mermaid Diagram
            {renderEditedBadge(block)}
          </div>
          <textarea
            className="w-full bg-[#1c1f21] text-slate-100 border border-outline-variant/40 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-primary resize-y mb-4 disabled:opacity-80"
            placeholder="graph TD;\n  A[Start] --> B[End];"
            rows={6}
            value={mData.code || ''}
            readOnly={locked}
            disabled={locked}
            onChange={(e) => updateBlock(block.localId, { ...mData, code: e.target.value })}
            spellCheck={false}
          />
          <MermaidBlock code={mData.code} />
        </section>
      );
    }

    if (block.type === 'STATIC_CHART') {
      const cData = typeof block.content === 'object' ? block.content : { chartType: 'bar', title: '', dataKey: 'value', data: [] };
      return (
        <section key={block.localId} className="group relative bg-surface-container-lowest rounded-xl p-8 transition-all hover:shadow-lg notebook-line border-l-2 border-transparent hover:border-l-primary mb-8">
          <BlockControls index={index} localId={block.localId} locked={locked} />
          <div className="flex items-center gap-2 mb-4 text-xs font-bold text-outline tracking-widest uppercase">
            <span className="material-symbols-outlined text-sm">bar_chart</span> Static Chart
            {renderEditedBadge(block)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-1">Chart Type</label>
              <select
                className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-80"
                value={cData.chartType || 'bar'}
                disabled={locked}
                onChange={(e) => updateBlock(block.localId, { ...cData, chartType: e.target.value })}
              >
                <option value="bar">Bar</option>
                <option value="line">Line</option>
                <option value="pie">Pie</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-1">Title</label>
              <input type="text" disabled={locked} className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-80" value={cData.title || ''} onChange={(e) => updateBlock(block.localId, { ...cData, title: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-1">Data Key</label>
              <input type="text" disabled={locked} className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-80" value={cData.dataKey || 'value'} onChange={(e) => updateBlock(block.localId, { ...cData, dataKey: e.target.value })} />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-outline mb-1">Data (JSON Array)</label>
            <textarea
              className="w-full bg-[#1c1f21] text-slate-100 border border-outline-variant/40 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-primary resize-y disabled:opacity-80"
              rows={4}
              value={JSON.stringify(cData.data || [], null, 2)}
              readOnly={locked}
              disabled={locked}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  if (Array.isArray(parsed)) updateBlock(block.localId, { ...cData, data: parsed });
                } catch { /* allow typing invalid JSON temporarily */ }
              }}
              spellCheck={false}
            />
          </div>
          <StaticChartBlock {...cData} />
        </section>
      );
    }

    return null;
  };

  const BlockControls = ({ index, localId, dark = false, locked = false }) => (
    <div className={`absolute -left-12 top-1/2 -translate-y-1/2 flex flex-col gap-0 opacity-0 group-hover:opacity-100 transition-opacity bg-surface p-1 rounded-full shadow-sm border border-outline-variant/30 ${dark ? 'bg-[#2c2c2c] border-white/10' : ''}`}>
      <button onClick={() => moveBlock(index, -1)} disabled={index === 0 || locked} className={`p-1.5 rounded-full hover:bg-primary/10 transition-colors disabled:opacity-30 ${dark ? 'text-white' : 'text-on-surface'}`}><span className="material-symbols-outlined text-[1rem]">arrow_upward</span></button>
      {canUseAiRefine && (
        <button onClick={() => openAiRefineModal(localId)} disabled={locked} className="p-1.5 rounded-full hover:bg-secondary/10 hover:text-secondary text-on-surface-variant transition-colors disabled:opacity-30" title="Refine this block with AI"><span className="material-symbols-outlined text-[1rem]">auto_fix_high</span></button>
      )}
      <button onClick={() => deleteBlock(localId)} disabled={locked} className="p-1.5 rounded-full hover:bg-error/10 hover:text-error text-on-surface-variant transition-colors disabled:opacity-30"><span className="material-symbols-outlined text-[1rem]">delete</span></button>
      <button onClick={() => moveBlock(index, 1)} disabled={index === blocks.length - 1 || locked} className={`p-1.5 rounded-full hover:bg-primary/10 transition-colors disabled:opacity-30 ${dark ? 'text-white' : 'text-on-surface'}`}><span className="material-symbols-outlined text-[1rem]">arrow_downward</span></button>
    </div>
  );
  const aiTargetBlock = aiEditTargetId ? blocks.find((b) => b.localId === aiEditTargetId) : null;

  if (loading) {
    return <div className="bg-surface text-on-surface min-h-screen flex items-center justify-center">Loading editor...</div>;
  }

  return (
    <div className="bg-surface text-on-surface overflow-hidden min-h-screen flex flex-col">
      {/* TopNavBar */}
      <nav className="fixed top-0 w-full z-50 bg-[#f8f9fa]/80 dark:bg-[#191c1d]/80 backdrop-blur-xl shadow-sm border-b border-outline-variant/20 flex justify-between items-center px-8 h-16 w-full">
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="text-xl font-bold text-[#191c1d] dark:text-white tracking-tight flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">school</span>
            Academic Atelier
          </Link>
          <div className="hidden md:flex gap-6 border-l border-outline-variant/30 pl-6 ml-2">
            <Link to={`/class/stream?classId=${lesson?.class_id}`} className="font-['Inter'] font-medium text-sm tracking-tight text-[#727785] hover:text-[#191c1d] transition-colors flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              Back to Class
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:block mr-2 text-sm text-outline font-medium">
            {saving ? 'Saving...' : 'All changes saved locally'}
          </div>
          <button
            data-testid="lesson-save-button"
            onClick={() => handleSave(lesson.status)}
            disabled={saving}
            className="flex items-center gap-2 bg-surface text-primary border border-primary px-4 py-1.5 rounded-full font-semibold hover:bg-primary/5 transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-sm">save</span>
            Save
          </button>
          {canPublishLesson && (
            <button
              data-testid="lesson-publish-button"
              onClick={() => handleSave('PUBLISHED')}
              disabled={saving || lesson.status === 'PUBLISHED'}
              className="bg-secondary text-white px-5 py-1.5 rounded-full font-semibold shadow-md active:scale-95 transition-all disabled:opacity-50"
            >
              {lesson.status === 'PUBLISHED' ? 'Published' : 'Publish'}
            </button>
          )}
          {canRunLive && (
            <Link
              to={`/lesson/live?lessonId=${encodeURIComponent(activeLessonId)}`}
              className="flex items-center gap-1 bg-emerald-500 text-white px-5 py-1.5 rounded-full font-semibold shadow-md active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-sm">present_to_all</span>
              Run Quiz Live
            </Link>
          )}
        </div>
      </nav>

      <div className="flex flex-1 pt-16 overflow-hidden">
        {/* Main Content Area (Editor Canvas) */}
        <main className="flex-1 overflow-y-auto bg-surface-container-low px-4 md:px-12 py-12 scroll-smooth">
          <div className="max-w-3xl mx-auto min-h-full pb-32">
            {error && (
              <div className="mb-6 p-4 bg-error-container text-on-error-container rounded-lg flex items-center gap-2 font-medium">
                <span className="material-symbols-outlined">error</span>
                {error}
              </div>
            )}

            {/* Lesson Header */}
            <div className="mb-12">
              <span className="text-label-md uppercase tracking-[0.2em] text-primary font-bold mb-4 block">Interactive Notebook - {lesson?.class?.name || 'Class'}</span>
              <input
                data-testid="lesson-title-input"
                className="w-full text-[3rem] font-bold text-on-surface leading-tight tracking-tight mb-4 outline-none bg-transparent placeholder-outline-variant"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Lesson Title"
              />
              {isStudentGlobalLesson && (
                <p className="text-sm text-outline-variant">
                  First save will automatically create your private lesson copy.
                </p>
              )}
              {isStudentPersonalLesson && (
                <p className="text-sm text-outline-variant">
                  You are editing your personal lesson copy. Teacher lessons remain unchanged.
                </p>
              )}
            </div>

            {/* Interactive Blocks Container */}
            <div className="space-y-4">
              {blocks.map((block, index) => (
                <React.Fragment key={block.localId}>
                  {renderBlock(block, index)}
                </React.Fragment>
              ))}
            </div>

            {/* Inline Add Block Actions */}
              <div className="mt-8 pt-8 border-t border-dashed border-outline-variant/40 flex justify-center gap-2">
                <button onClick={() => addBlock('TEXT')} className="px-4 py-2 rounded-full border border-outline-variant/50 hover:bg-surface hover:text-primary hover:border-primary transition-all text-sm font-medium flex items-center gap-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[1.2rem]">subject</span> Text
                </button>
                <button onClick={() => addBlock('CODE')} className="px-4 py-2 rounded-full border border-outline-variant/50 hover:bg-surface hover:text-primary hover:border-primary transition-all text-sm font-medium flex items-center gap-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[1.2rem]">code</span> Code
                </button>
                <button onClick={() => addBlock('EXERCISE')} className="px-4 py-2 rounded-full border border-outline-variant/50 hover:bg-surface hover:text-primary hover:border-primary transition-all text-sm font-medium flex items-center gap-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[1.2rem]">menu_book</span> Exercise
                </button>
                <button onClick={() => addBlock('DISCUSSION')} className="px-4 py-2 rounded-full border border-outline-variant/50 hover:bg-surface hover:text-primary hover:border-primary transition-all text-sm font-medium flex items-center gap-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[1.2rem]">forum</span> Prompt
                </button>
                <button onClick={() => addBlock('WRITTEN_QUIZ')} className="px-4 py-2 rounded-full border border-outline-variant/50 hover:bg-surface hover:text-primary hover:border-primary transition-all text-sm font-medium flex items-center gap-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[1.2rem]">edit_document</span> Written Question Block
                </button>
                <button onClick={() => addBlock('INTERACTIVE_SIMULATION')} className="px-4 py-2 rounded-full border border-outline-variant/50 hover:bg-surface hover:text-primary hover:border-primary transition-all text-sm font-medium flex items-center gap-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[1.2rem]">experiment</span> Simulation
                </button>
                <button onClick={() => addBlock('MERMAID_DIAGRAM')} className="px-4 py-2 rounded-full border border-outline-variant/50 hover:bg-surface hover:text-primary hover:border-primary transition-all text-sm font-medium flex items-center gap-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[1.2rem]">account_tree</span> Diagram
                </button>
                <button onClick={() => addBlock('STATIC_CHART')} className="px-4 py-2 rounded-full border border-outline-variant/50 hover:bg-surface hover:text-primary hover:border-primary transition-all text-sm font-medium flex items-center gap-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[1.2rem]">bar_chart</span> Chart
                </button>
              </div>
          </div>
        </main>
      </div>

      {isTeacher && (
        <input
          ref={textImageInputRef}
          type="file"
          accept={TEXT_IMAGE_ACCEPT}
          onChange={handleTextImageFileSelected}
          className="hidden"
        />
      )}

      {isTeacher && textImageCropModal.isOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={closeTextImageCropModal}
        >
          <div
            className="w-full max-w-3xl mx-4 rounded-2xl border border-outline-variant/20 bg-white shadow-2xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-widest font-bold text-secondary mb-1">
                  Text Image Editor
                </p>
                <h3 className="text-xl font-bold text-on-surface">
                  {textImageCropModal.mode === 'replace' ? 'Crop Existing Image' : 'Insert New Image'}
                </h3>
                <p className="text-sm text-on-surface-variant mt-1">
                  Move the crop frame, then apply to update the image inside this text block.
                </p>
              </div>
              <button
                type="button"
                onClick={closeTextImageCropModal}
                disabled={textImageCropModal.applying}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="mt-4">
              <div className="flex justify-center">
                <div
                  ref={textCropStageRef}
                  className="relative inline-block max-w-full touch-none select-none"
                  onPointerDown={handleTextCropStagePointerDown}
                  onPointerMove={handleTextCropStagePointerMove}
                  onPointerUp={handleTextCropStagePointerUp}
                  onPointerCancel={handleTextCropStagePointerUp}
                >
                  <img
                    ref={textCropImageRef}
                    src={textImageCropModal.sourceDataUrl}
                    alt={textImageCropModal.altText || 'Crop preview'}
                    className="max-h-[52vh] max-w-full rounded-xl border border-outline-variant/20 bg-surface-container-low"
                    draggable={false}
                  />
                  <div className="absolute inset-0 rounded-xl overflow-hidden cursor-crosshair">
                    <div
                      className="absolute border-2 border-secondary rounded-sm pointer-events-none"
                      style={{
                        left: `${textImageCropModal.cropX}%`,
                        top: `${textImageCropModal.cropY}%`,
                        width: `${textImageCropModal.cropWidth}%`,
                        height: `${textImageCropModal.cropHeight}%`,
                        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.35)',
                      }}
                    >
                      <div className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full bg-secondary border border-white/80" />
                      <div className="absolute -right-1.5 -top-1.5 h-3 w-3 rounded-full bg-secondary border border-white/80" />
                      <div className="absolute -left-1.5 -bottom-1.5 h-3 w-3 rounded-full bg-secondary border border-white/80" />
                      <div className="absolute -right-1.5 -bottom-1.5 h-3 w-3 rounded-full bg-secondary border border-white/80" />
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs text-outline">
                Source: {textImageCropModal.sourceLabel || 'Uploaded image'} - {textImageCropModal.naturalWidth} x {textImageCropModal.naturalHeight}px
              </p>
              <p className="mt-1 text-xs text-outline">
                Drag on the image to draw a crop area. Drag inside the crop box to move it.
              </p>
            </div>
            <div className="mt-4 rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setTextImageCropModal((previous) => ({ ...previous, interactionMode: 'draw' }))
                  }
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    textImageCropModal.interactionMode === 'draw'
                      ? 'border-secondary bg-secondary text-white'
                      : 'border-outline-variant/40 text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  Draw Area
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setTextImageCropModal((previous) => ({ ...previous, interactionMode: 'move' }))
                  }
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    textImageCropModal.interactionMode === 'move'
                      ? 'border-secondary bg-secondary text-white'
                      : 'border-outline-variant/40 text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  Move Box
                </button>
                <div className="ml-auto text-[11px] text-outline">
                  x: {Math.round(textImageCropModal.cropX)}% y: {Math.round(textImageCropModal.cropY)}% w: {Math.round(textImageCropModal.cropWidth)}% h: {Math.round(textImageCropModal.cropHeight)}%
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-outline mb-1">Alt Text</label>
                <input
                  type="text"
                  value={textImageCropModal.altText}
                  onChange={(event) =>
                    setTextImageCropModal((previous) => ({
                      ...previous,
                      altText: event.target.value,
                    }))
                  }
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 text-sm outline-none focus:border-secondary"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-outline mb-1">Caption (Optional)</label>
                <input
                  type="text"
                  value={textImageCropModal.titleText}
                  onChange={(event) =>
                    setTextImageCropModal((previous) => ({
                      ...previous,
                      titleText: event.target.value,
                    }))
                  }
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 text-sm outline-none focus:border-secondary"
                  placeholder="Shown as figure caption"
                />
              </div>
            </div>

            {textImageCropModal.error && (
              <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {textImageCropModal.error}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleResetTextImageCrop}
                disabled={textImageCropModal.applying}
                className="px-4 py-2 rounded-full border border-secondary/30 text-secondary font-semibold hover:bg-secondary/10 transition-colors disabled:opacity-50"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={closeTextImageCropModal}
                disabled={textImageCropModal.applying}
                className="px-4 py-2 rounded-full border border-outline-variant/40 text-on-surface font-semibold hover:bg-surface-container-low transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyTextImageCrop}
                disabled={textImageCropModal.applying}
                className="px-5 py-2 rounded-full bg-secondary text-white font-semibold shadow hover:shadow-md transition-all active:scale-95 disabled:opacity-50"
              >
                {textImageCropModal.applying ? 'Applying...' : 'Apply Crop'}
              </button>
            </div>
          </div>
        </div>
      )}

      {aiTargetBlock && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 backdrop-blur-sm" onClick={closeAiRefineModal}>
          <div className="w-full max-w-xl mx-4 rounded-2xl bg-white shadow-2xl border border-outline-variant/20 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-xs uppercase tracking-widest font-bold text-secondary mb-1">AI Block Editor</p>
                <h3 className="text-xl font-bold text-on-surface">Refine This {aiTargetBlock.type} Block</h3>
                <p className="text-sm text-on-surface-variant mt-1">
                  AI will only edit this block. Other blocks stay unchanged.
                </p>
              </div>
              <button type="button" onClick={closeAiRefineModal} disabled={aiEditLoading} className="text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleAiRefineBlock} onPaste={handleAiEditReferenceImagePaste} className="space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-outline mb-2">
                  What should improve?
                </label>
                <textarea
                  value={aiEditInstructions}
                  onChange={(e) => setAiEditInstructions(e.target.value)}
                  placeholder="Example: Make this simpler for grade 8, add one practical example, keep it short."
                  rows={5}
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-3 text-sm outline-none focus:border-secondary resize-y"
                />
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-outline mb-2">
                  Reference Images (Optional)
                </label>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => aiEditImageInputRef.current?.click()}
                  onDrop={handleAiEditReferenceImageDrop}
                  onDragOver={handleAiEditReferenceImageDragOver}
                  onDragLeave={handleAiEditReferenceImageDragLeave}
                  onPaste={handleAiEditReferenceImagePaste}
                  className={`rounded-xl border-2 border-dashed px-3 py-3 text-sm transition-colors ${
                    aiEditReferenceDropActive
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
                        aiEditImageInputRef.current?.click();
                      }}
                      className="shrink-0 px-3 py-1.5 rounded-full bg-secondary text-white text-xs font-semibold"
                    >
                      Select Images
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-outline">
                    Helps AI align visual refinements for Simulation and Mermaid Diagram blocks. Limit: {REFINE_MAX_IMAGES} images, {formatBytes(REFINE_MAX_IMAGE_BYTES)} each.
                  </p>
                  <input
                    ref={aiEditImageInputRef}
                    type="file"
                    accept={REFINE_IMAGE_ACCEPT}
                    multiple
                    onChange={handleAiEditReferenceImagesSelected}
                    className="hidden"
                  />
                </div>

                {aiEditReferenceImagesLoading && (
                  <p className="mt-2 text-xs text-outline">Processing attached images...</p>
                )}

                {aiEditReferenceImages.length > 0 && (
                  <div className="mt-2 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 space-y-1.5">
                    <p className="text-xs text-on-surface-variant">
                      Attached {aiEditReferenceImages.length} image(s) - {formatBytes(aiEditReferenceImages.reduce((sum, image) => sum + (Number(image?.size) || 0), 0))}
                    </p>
                    {aiEditReferenceImages.map((image, index) => (
                      <div key={`${buildImagePayloadKey(image)}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-on-surface truncate">{image.name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveAiEditReferenceImage(index)}
                          className="text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {aiEditError && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {aiEditError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeAiRefineModal}
                  className="px-4 py-2 rounded-full border border-outline-variant/40 text-on-surface font-semibold hover:bg-surface-container-low transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={aiEditLoading || aiEditReferenceImagesLoading}
                  className="px-5 py-2 rounded-full bg-secondary text-white font-semibold shadow hover:shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  {aiEditLoading ? `Refining... (${aiEditTimer}s)` : aiEditReferenceImagesLoading ? 'Processing images...' : 'Apply AI Refinement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Assistant Floating Menu */}
        <div className="fixed bottom-8 right-8 flex flex-col items-end z-[60]">
          {showAiMenu && (
            <div className="bg-surface shadow-2xl rounded-2xl p-4 w-64 border border-outline-variant/20 mb-4 animate-in slide-in-from-bottom-2">
              <p className="text-xs font-bold text-primary mb-2">ADD BLOCK</p>
              <div className="grid grid-cols-1 gap-2">
                <button onClick={() => addBlock('TEXT')} className="text-sm text-left px-3 py-2 rounded-lg bg-surface-container hover:bg-primary/10 transition-colors font-medium flex items-center gap-2"><span className="material-symbols-outlined text-sm">subject</span> Explanation</button>
                <button onClick={() => addBlock('CODE')} className="text-sm text-left px-3 py-2 rounded-lg bg-surface-container hover:bg-primary/10 transition-colors font-medium flex items-center gap-2"><span className="material-symbols-outlined text-sm">code</span> Code Cell</button>
                <button onClick={() => addBlock('EXERCISE')} className="text-sm text-left px-3 py-2 rounded-lg bg-surface-container hover:bg-primary/10 transition-colors font-medium flex items-center gap-2"><span className="material-symbols-outlined text-sm">menu_book</span> Exercise MCQ</button>
                <button onClick={() => addBlock('WRITTEN_QUIZ')} className="text-sm text-left px-3 py-2 rounded-lg bg-surface-container hover:bg-primary/10 transition-colors font-medium flex items-center gap-2"><span className="material-symbols-outlined text-sm">edit_document</span> Written Question Block</button>
                <button onClick={() => addBlock('DISCUSSION')} className="text-sm text-left px-3 py-2 rounded-lg bg-surface-container hover:bg-primary/10 transition-colors font-medium flex items-center gap-2"><span className="material-symbols-outlined text-sm">forum</span> Discussion Prompt</button>
                <button onClick={() => addBlock('INTERACTIVE_SIMULATION')} className="text-sm text-left px-3 py-2 rounded-lg bg-surface-container hover:bg-primary/10 transition-colors font-medium flex items-center gap-2"><span className="material-symbols-outlined text-sm">experiment</span> Interactive Simulation</button>
                <button onClick={() => addBlock('MERMAID_DIAGRAM')} className="text-sm text-left px-3 py-2 rounded-lg bg-surface-container hover:bg-primary/10 transition-colors font-medium flex items-center gap-2"><span className="material-symbols-outlined text-sm">account_tree</span> Mermaid Diagram</button>
                <button onClick={() => addBlock('STATIC_CHART')} className="text-sm text-left px-3 py-2 rounded-lg bg-surface-container hover:bg-primary/10 transition-colors font-medium flex items-center gap-2"><span className="material-symbols-outlined text-sm">bar_chart</span> Static Chart</button>
              </div>
            </div>
          )}
          <button
            onClick={() => setShowAiMenu(!showAiMenu)}
            className="bg-gradient-to-br from-primary to-primary-container text-white w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
          >
            <span className="material-symbols-outlined text-2xl">{showAiMenu ? 'close' : 'add'}</span>
          </button>
        </div>
    </div>
  );
}

