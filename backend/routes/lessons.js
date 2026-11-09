const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('redis');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireTeacher } = require('../middleware/authMiddleware');
const { hasUsableAIConfig, callOpenRouter, callOpenRouterForJson, getModel } = require('../services/openrouter');
const {
  normalizeSimulationBlockContent,
} = require('../schemas/simulationBlockSchema');

const prisma = new PrismaClient();
const JSON_CONTENT_BLOCK_TYPES = new Set([
  'QUIZ',
  'EXERCISE',
  'WRITTEN_QUIZ',
  'INTERACTIVE_SIMULATION',
  'MERMAID_DIAGRAM',
  'STATIC_CHART',
]);

const ALLOWED_BLOCK_TYPES = new Set([
  'TEXT',
  'CODE',
  'EXERCISE',
  'QUIZ',
  'DISCUSSION',
  'WRITTEN_QUIZ',
  'INTERACTIVE_SIMULATION',
  'MERMAID_DIAGRAM',
  'STATIC_CHART',
]);

const MIN_BLOCKS_PER_SECTION = 3;
const MAX_BLOCKS_PER_SECTION = 6;

const SUPPORTED_CODE_LANGUAGES = new Set([
  'javascript',
  'python',
  'c',
  'cpp',
  'java',
  'php',
]);

const CODE_LANGUAGE_ALIASES = {
  javascript: 'javascript',
  js: 'javascript',
  python: 'python',
  py: 'python',
  c: 'c',
  'c++': 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  java: 'java',
  php: 'php',
};

const PERSONAL_BLOCK_TYPES = new Set(['TEXT', 'CODE', 'INTERACTIVE_SIMULATION']);
const STUDENT_PERSONAL_AI_BLOCK_TYPES = new Set(['CODE', 'INTERACTIVE_SIMULATION']);
const LESSON_STATUSES = new Set(['DRAFT', 'PUBLISHED', 'LIVE']);
const STUDENT_VISIBLE_LESSON_STATUSES = new Set(['PUBLISHED', 'LIVE']);

const normalizeLessonStatus = (value) => String(value || '').trim().toUpperCase();
const isStudentVisibleLessonStatus = (value) =>
  STUDENT_VISIBLE_LESSON_STATUSES.has(normalizeLessonStatus(value));
const isPersonalLesson = (lesson) =>
  Boolean(lesson && typeof lesson === 'object' && lesson.owner_student_id);
const isGlobalLesson = (lesson) => !isPersonalLesson(lesson);

const authorizeClassAccess = async ({ classId, userId, role }) => {
  const targetClass = await prisma.class.findUnique({
    where: { id: classId },
    select: { id: true, teacher_id: true },
  });

  if (!targetClass) {
    return { notFound: true, allowed: false };
  }

  if (role === 'TEACHER') {
    return { notFound: false, allowed: targetClass.teacher_id === userId };
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      class_id: classId,
      user_id: userId,
    },
    select: { id: true },
  });

  return { notFound: false, allowed: Boolean(enrollment) };
};

const tryParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const extractBalancedJsonCandidate = (text, startIndex) => {
  const startChar = text[startIndex];
  if (startChar !== '{' && startChar !== '[') {
    return null;
  }

  const closeToOpen = { '}': '{', ']': '[' };
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }

    if (ch === '}' || ch === ']') {
      const expectedOpen = closeToOpen[ch];
      const lastOpen = stack[stack.length - 1];
      if (lastOpen !== expectedOpen) {
        return null;
      }
      stack.pop();
      if (stack.length === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }

  return null;
};

const parseJsonFromText = (rawText) => {
  const cleaned = String(rawText || '').replace(/^\uFEFF/, '').trim();
  if (!cleaned) return null;

  const direct = tryParseJson(cleaned);
  if (direct !== null) {
    return direct;
  }

  const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fencedMatch = fencedRegex.exec(cleaned);
  while (fencedMatch) {
    const candidate = parseJsonFromText(fencedMatch[1]);
    if (candidate !== null) {
      return candidate;
    }
    fencedMatch = fencedRegex.exec(cleaned);
  }

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch !== '{' && ch !== '[') continue;

    const candidate = extractBalancedJsonCandidate(cleaned, i);
    if (!candidate) continue;

    const parsed = tryParseJson(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const extractJsonPayload = (rawText) => {
  return parseJsonFromText(rawText);
};

const parsePossiblyJson = (value) => {
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

const normalizeCodeLanguage = (value) => {
  const alias = CODE_LANGUAGE_ALIASES[String(value || '').trim().toLowerCase()];
  return alias && SUPPORTED_CODE_LANGUAGES.has(alias) ? alias : 'javascript';
};

const getCodeCellSeparator = (language) =>
  normalizeCodeLanguage(language) === 'python' ? '# %%' : '// %%';

const getDefaultCodeSnippet = (language) => {
  const normalized = normalizeCodeLanguage(language);
  if (normalized === 'python') {
    return '# %%\nprint("Example output for this lesson topic")';
  }
  if (normalized === 'c') {
    return [
      '#include <stdio.h>',
      '',
      'int main(void) {',
      '  printf("Example output for this lesson topic\\n");',
      '  return 0;',
      '}',
    ].join('\n');
  }
  if (normalized === 'cpp') {
    return [
      '#include <iostream>',
      '',
      'int main() {',
      '  std::cout << "Example output for this lesson topic" << std::endl;',
      '  return 0;',
      '}',
    ].join('\n');
  }
  if (normalized === 'java') {
    return [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    System.out.println("Example output for this lesson topic");',
      '  }',
      '}',
    ].join('\n');
  }
  if (normalized === 'php') {
    return '<?php\necho "Example output for this lesson topic\\n";';
  }
  return '// %%\nconsole.log("Example output for this lesson topic");';
};

const splitCodeIntoCells = (source) => {
  const text = String(source || '');
  if (!text.trim()) {
    return [{ id: 'cell-1', title: 'Cell 1', code: '' }];
  }

  const lines = text.split(/\r?\n/);
  const chunks = [''];

  lines.forEach((line) => {
    if (/^\s*(\/\/|#)\s*%%/.test(line)) {
      chunks.push('');
      return;
    }

    const current = chunks[chunks.length - 1];
    chunks[chunks.length - 1] = current ? `${current}\n${line}` : line;
  });

  return chunks.map((chunk, index) => ({
    id: `cell-${index + 1}`,
    title: `Cell ${index + 1}`,
    code: chunk,
  }));
};

const combineCellsToCode = (cells, language = 'javascript') => {
  if (!Array.isArray(cells) || cells.length === 0) {
    return '';
  }

  const separator = getCodeCellSeparator(language);
  return cells
    .map((cell) => String(cell?.code || ''))
    .join(`\n\n${separator}\n\n`);
};

const buildCodeNotebookFromCode = (rawCode, defaultLanguage = 'javascript') => {
  const safeCode = typeof rawCode === 'string' ? rawCode : String(rawCode || '');
  return {
    version: 1,
    language: 'javascript',
    runtime: 'browser-js',
    defaultLanguage: normalizeCodeLanguage(defaultLanguage),
    code: safeCode,
    cells: splitCodeIntoCells(safeCode),
  };
};

const normalizeCodeNotebook = (candidate) => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }

  const defaultLanguage = normalizeCodeLanguage(candidate.defaultLanguage || candidate.language);

  if (typeof candidate.code === 'string' && !Array.isArray(candidate.cells)) {
    return buildCodeNotebookFromCode(candidate.code, defaultLanguage);
  }

  if (!Array.isArray(candidate.cells)) {
    return null;
  }

  const normalizedCells = candidate.cells.map((cell, index) => ({
    id:
      typeof cell?.id === 'string' && cell.id.trim()
        ? cell.id.trim()
        : `cell-${index + 1}`,
    title:
      typeof cell?.title === 'string' && cell.title.trim()
        ? cell.title.trim()
        : `Cell ${index + 1}`,
    code: typeof cell?.code === 'string' ? cell.code : '',
  }));

  const safeCells =
    normalizedCells.length > 0 ? normalizedCells : [{ id: 'cell-1', title: 'Cell 1', code: '' }];

  const code =
    typeof candidate.code === 'string' && candidate.code.trim()
      ? candidate.code
      : combineCellsToCode(safeCells, defaultLanguage);

  return {
    version: Number(candidate.version) || 1,
    language: 'javascript',
    runtime: 'browser-js',
    defaultLanguage,
    code,
    cells: safeCells,
  };
};

const normalizeRefinedContent = (blockType, originalContent, candidate, options = {}) => {
  if (blockType === 'CODE') {
    const originalAsNotebook = parsePossiblyJson(originalContent);
    const originalWasNotebook = Boolean(
      originalAsNotebook &&
      (Array.isArray(originalAsNotebook.cells) || typeof originalAsNotebook.code === 'string')
    );
    const originalLanguage = normalizeCodeLanguage(originalAsNotebook?.defaultLanguage);

    if (originalWasNotebook) {
      const normalized = normalizeCodeNotebook(candidate);
      if (normalized) return normalized;

      if (typeof candidate === 'string') {
        return buildCodeNotebookFromCode(candidate, originalLanguage);
      }

      return originalAsNotebook;
    }

    if (typeof candidate === 'string') {
      return buildCodeNotebookFromCode(candidate, 'javascript');
    }

    const normalized = normalizeCodeNotebook(candidate);
    if (normalized) return normalized;

    if (typeof originalContent === 'string') {
      return buildCodeNotebookFromCode(originalContent, 'javascript');
    }

    return buildCodeNotebookFromCode('', 'javascript');
  }

  if (JSON_CONTENT_BLOCK_TYPES.has(blockType)) {
    try {
      return normalizeBlockContentByType(blockType, candidate, options);
    } catch {
      const fallback = parsePossiblyJson(originalContent);
      return normalizeBlockContentByType(blockType, fallback || {}, options);
    }
  }

  if (typeof candidate === 'string') {
    return candidate;
  }
  return typeof originalContent === 'string' ? originalContent : '';
};

const OPENROUTER_GENERATION_MODEL = getModel();

const getDefaultQuizContent = () => ({
  question: 'What is the most important idea from this lesson section?',
  options: [
    { text: 'Main concept and how to apply it', isCorrect: true, feedback: 'Correct. Focus on understanding and application.' },
    { text: 'Memorizing random details only', isCorrect: false, feedback: 'Not quite. Conceptual understanding matters more.' },
  ],
  timeLimit: 30,
});

const getDefaultExerciseContent = () => ({
  question: 'Choose the best explanation based on the lesson.',
  options: [
    { text: 'A concept-based explanation', isCorrect: true, feedback: 'Nice work. This aligns with the concept.' },
    { text: 'An unrelated explanation', isCorrect: false, feedback: 'Try again by focusing on the lesson idea.' },
  ],
});

const getDefaultWrittenQuizContent = () => ({
  question: 'Explain the core idea in your own words.',
  idealAnswer: 'A clear explanation of the central concept and one practical example.',
});

const toObjectOrNull = (value) => {
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

const normalizeType = (type) => {
  const t = String(type || '').trim().toUpperCase();
  return ALLOWED_BLOCK_TYPES.has(t) ? t : 'TEXT';
};

const normalizeQuizLikeContent = (rawContent, blockType) => {
  const fallback = blockType === 'QUIZ' ? getDefaultQuizContent() : getDefaultExerciseContent();
  const content = toObjectOrNull(rawContent) || fallback;
  const optionsSource = Array.isArray(content.options) ? content.options : fallback.options;

  const options = optionsSource
    .map((option, index) => ({
      text: typeof option?.text === 'string' && option.text.trim() ? option.text.trim() : `Option ${index + 1}`,
      isCorrect: Boolean(option?.isCorrect),
      feedback:
        typeof option?.feedback === 'string' && option.feedback.trim()
          ? option.feedback.trim()
          : option?.isCorrect
            ? 'Correct.'
            : 'Try again.',
    }))
    .slice(0, 6);

  if (options.length < 2) {
    options.push(...fallback.options.slice(options.length));
  }

  if (!options.some((option) => option.isCorrect)) {
    options[0].isCorrect = true;
  }

  const normalized = {
    question:
      typeof content.question === 'string' && content.question.trim()
        ? content.question.trim()
        : fallback.question,
    options,
  };

  if (blockType === 'QUIZ') {
    normalized.timeLimit = Math.max(10, Number(content.timeLimit) || 30);
  }

  return normalized;
};

const normalizeSimulationContent = (rawContent, options = {}) => {
  const content = toObjectOrNull(rawContent) || {};
  const normalized = normalizeSimulationBlockContent(content);

  if (options.rejectInvalidSimulation && !normalized.isValid) {
    throw new Error('Invalid INTERACTIVE_SIMULATION payload');
  }

  return normalized.content;
};

const TOPIC_KEYWORD_GROUPS = {
  graphSearch: ['shortest path', 'dijkstra', 'a*', 'a-star', 'astar', 'graph', 'pathfinding', 'heuristic', 'search'],
  finance: ['finance', 'financial', 'economics', 'economy', 'investment', 'interest', 'compound'],
};

const containsAnyKeyword = (text, keywords = []) => {
  const safeText = String(text || '').toLowerCase();
  return keywords.some((keyword) => safeText.includes(String(keyword).toLowerCase()));
};

const isGraphSearchTopic = (topic) => containsAnyKeyword(topic, TOPIC_KEYWORD_GROUPS.graphSearch);
const isFinanceTopic = (topic) => containsAnyKeyword(topic, TOPIC_KEYWORD_GROUPS.finance);

const toTopicLabel = (topic, fallback = 'Core Concept') => {
  const cleaned = String(topic || '').replace(/[`"]/g, '').trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, 42);
};

const buildTopicMermaidFallbackCode = (topic) => {
  if (isGraphSearchTopic(topic)) {
    return [
      'graph LR;',
      '  S((Start)) -->|4| A;',
      '  S -->|2| B;',
      '  B -->|1| A;',
      '  A -->|3| C;',
      '  B -->|5| D;',
      '  A -->|2| D;',
      '  C -->|2| G((Goal));',
      '  D -->|1| G;',
      '  H["Heuristic h(n)"] --> D;',
    ].join('\n');
  }

  const topicLabel = toTopicLabel(topic);
  return [
    'graph TD;',
    `  A[${topicLabel}] --> B[Core Mechanism];`,
    '  B --> C[Worked Example];',
    '  B --> D[Common Pitfall];',
    '  C --> E[Practical Application];',
  ].join('\n');
};

const MERMAID_SUPPORTED_PREFIX_RE =
  /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|c4Context|c4Container|c4Component|c4Dynamic|c4Deployment)\b/i;

const sanitizeMermaidCode = (value) => {
  let text = String(value || '').trim();
  if (!text) return '';

  text = text
    .replace(/```(?:mermaid)?/gi, '')
    .replace(/```/g, '')
    .trim();

  return text;
};

const hasBalancedTokenPairs = (text, openChar, closeChar) => {
  let depth = 0;
  for (const ch of String(text || '')) {
    if (ch === openChar) depth += 1;
    if (ch === closeChar) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
};

const isLikelyValidMermaidSyntax = (code) => {
  const normalized = sanitizeMermaidCode(code);
  if (!normalized) return false;

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0];

  if (!firstLine || !MERMAID_SUPPORTED_PREFIX_RE.test(firstLine)) {
    return false;
  }

  if (normalized.includes('```')) {
    return false;
  }

  if (
    !hasBalancedTokenPairs(normalized, '[', ']') ||
    !hasBalancedTokenPairs(normalized, '(', ')') ||
    !hasBalancedTokenPairs(normalized, '{', '}')
  ) {
    return false;
  }

  const isFlowchart = /^(graph|flowchart)\b/i.test(firstLine);
  if (isFlowchart && !/-->|---|-.->|==>|o--|x--/i.test(normalized)) {
    return false;
  }

  if (isFlowchart) {
    const flowLines = lines.slice(1);
    for (const flowLine of flowLines) {
      const withoutComment = flowLine.replace(/%%.*$/, '').trim();
      if (!withoutComment) continue;

      if (/^(subgraph|end|classDef|style|linkStyle|click)\b/i.test(withoutComment)) {
        continue;
      }

      const strippedLine = withoutComment.replace(/;$/, '').trim();

      // Parse failure pattern seen in malformed AI output: long dash runs left over in text.
      if (/\s-{4,}(?:\s|$)/.test(strippedLine) && !/(-->|---|-.->|==>|o--|x--)/.test(strippedLine)) {
        return false;
      }

      const pipeCount = (strippedLine.match(/\|/g) || []).length;
      if (pipeCount % 2 !== 0) {
        return false;
      }

      if (/(-->|---|-.->|==>|o--|x--)/.test(strippedLine)) {
        if (!/^[A-Za-z_][A-Za-z0-9_-]*/.test(strippedLine)) {
          return false;
        }

        const segments = strippedLine
          .split(/-->|---|-.->|==>|o--|x--/)
          .map((segment) => segment.trim())
          .filter(Boolean);

        if (segments.length < 2) {
          return false;
        }

        const hasMalformedSegment = segments.some((segment) => {
          const normalizedSegment = segment.replace(/^\|[^|]*\|\s*/, '');

          if (!/^[A-Za-z_][A-Za-z0-9_-]*/.test(normalizedSegment)) {
            return true;
          }

          const remainder = normalizedSegment
            .replace(/^[A-Za-z_][A-Za-z0-9_-]*/, '')
            .replace(/^\s*(\[[^\]]*\]|\([^)]+\)|\(\([^)]+\)\)|\{\{[^}]+\}\}|\{[^}]+\})?/, '')
            .trim();

          if (!remainder) return false;
          if (/^:::[A-Za-z_][A-Za-z0-9_-]*$/.test(remainder)) return false;
          return !/^\|[^|]*\|$/.test(remainder);
        });

        if (hasMalformedSegment) {
          return false;
        }
      }
    }
  }

  return true;
};

const isLowQualityMermaidCode = (code) => {
  const normalized = sanitizeMermaidCode(code);
  if (!normalized) return true;

  const flat = normalized.toLowerCase().replace(/\s+/g, ' ');
  if (
    flat.includes('graph td; a[start] --> b[end];') ||
    flat.includes('graph td; a[start] --> b[core concept];')
  ) {
    return true;
  }

  const nodeMatches = normalized.match(/\[[^\]]+\]|\([^)]+\)|\{\{[^}]+\}\}/g);
  return !nodeMatches || nodeMatches.length < 5;
};

const buildTopicStaticChartFallback = (topic) => {
  if (isGraphSearchTopic(topic)) {
    return {
      chartType: 'bar',
      title: 'Node Expansions: Dijkstra vs A*',
      dataKey: 'nodesExpanded',
      data: [
        { name: 'Sparse Graph', nodesExpanded: 98 },
        { name: 'Medium Graph', nodesExpanded: 173 },
        { name: 'Dense Graph', nodesExpanded: 264 },
        { name: 'Weighted Maze', nodesExpanded: 212 },
      ],
    };
  }

  return {
    chartType: 'bar',
    title: `${toTopicLabel(topic, 'Topic')} Comparative Metrics`,
    dataKey: 'value',
    data: [
      { name: 'Baseline', value: 20 },
      { name: 'Scenario A', value: 35 },
      { name: 'Scenario B', value: 47 },
      { name: 'Scenario C', value: 31 },
    ],
  };
};

const isLowQualityStaticChart = (content) => {
  if (!content || typeof content !== 'object') return true;

  const title = String(content.title || '').trim().toLowerCase();
  const data = Array.isArray(content.data) ? content.data : [];

  if (!title || title === 'chart' || title === 'sample data') {
    return true;
  }

  if (data.length < 3) {
    return true;
  }

  const labels = data
    .map((entry) => String(entry?.name || '').trim().toLowerCase())
    .filter(Boolean);

  if (labels.length < 3) {
    return true;
  }

  if (labels.every((label) => /^[a-z]$/.test(label))) {
    return true;
  }

  return false;
};

const buildTopicSimulationFallback = (topic) => {
  if (isGraphSearchTopic(topic)) {
    return {
      title: 'Shortest Path Explorer: Dijkstra vs A*',
      description:
        'Interact with a weighted graph, compare Dijkstra and A* behavior, and inspect how heuristic strength affects search effort.',
      template: 'react',
      hint: 'Keep the heuristic admissible and compare expanded-node counts between algorithms.',
      solutionText:
        'Dijkstra expands by lowest cumulative cost g(n). A* expands by f(n)=g(n)+h(n), often reducing exploration while preserving optimality with an admissible heuristic.',
      design_spec:
        'Build an interactive weighted graph with 7-10 nodes. Provide controls for start node, goal node, edge weights, algorithm toggle (Dijkstra/A*), and heuristic scaling. Animate frontier expansion step-by-step, highlight final shortest path, and display metrics: path cost, expanded nodes, and execution steps. Include reset and randomize controls.',
    };
  }

  const topicLabel = toTopicLabel(topic, 'Concept');
  return {
    title: `Interactive ${topicLabel} Explorer`,
    description: `Experiment with ${topicLabel} by changing parameters and observing model behavior in real time.`,
    template: 'react',
    hint: 'Change one control at a time and observe which outputs respond most.',
    solutionText: 'Relate each control to the observed output trend and explain the causal mechanism.',
    design_spec:
      `Create a topic-specific simulation for "${topicLabel}" with at least 3 user controls and 3 live output metrics. Include visual state changes and a compact explanation panel.`,
  };
};

const isLowQualitySimulationContent = (content, topic = '') => {
  if (!content || typeof content !== 'object') return true;

  const mergedText = [
    content.title,
    content.description,
    content.design_spec,
    content.hint,
    content.solutionText,
  ]
    .map((value) => String(value || ''))
    .join(' ')
    .toLowerCase();

  const genericSimulationTitle =
    String(content.title || '').trim().toLowerCase() === 'interactive simulation';

  const financeKeywordLeak = containsAnyKeyword(mergedText, [
    'compound growth',
    'compound interest',
    'principal',
    'apr',
    'projected value',
    'rate (%)',
  ]);

  if (genericSimulationTitle) {
    return true;
  }

  if (financeKeywordLeak && !isFinanceTopic(topic)) {
    return true;
  }

  if (isGraphSearchTopic(topic)) {
    const hasGraphTerms = containsAnyKeyword(mergedText, [
      'graph',
      'node',
      'edge',
      'path',
      'dijkstra',
      'a*',
      'heuristic',
      'frontier',
    ]);
    if (!hasGraphTerms) return true;
  }

  return false;
};

const normalizeBlockContentByType = (type, rawContent, options = {}) => {
  const defaultCodeLanguage = normalizeCodeLanguage(options.defaultCodeLanguage);

  if (type === 'TEXT') {
    return typeof rawContent === 'string' ? rawContent : String(rawContent ?? '');
  }

  if (type === 'DISCUSSION') {
    return typeof rawContent === 'string' && rawContent.trim()
      ? rawContent.trim()
      : 'Discuss how this concept applies in a real-world scenario.';
  }

  if (type === 'CODE') {
    if (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent)) {
      const notebook = normalizeCodeNotebook(rawContent);
      if (notebook) {
        return {
          ...notebook,
          defaultLanguage: normalizeCodeLanguage(notebook.defaultLanguage || defaultCodeLanguage),
          code:
            typeof notebook.code === 'string'
              ? notebook.code
              : combineCellsToCode(
                notebook.cells,
                normalizeCodeLanguage(notebook.defaultLanguage || defaultCodeLanguage)
              ),
        };
      }
    }

    const snippetLanguage = normalizeCodeLanguage(defaultCodeLanguage);
    const fallbackCode =
      typeof rawContent === 'string' && rawContent.trim()
        ? rawContent
        : getDefaultCodeSnippet(snippetLanguage);
    return buildCodeNotebookFromCode(fallbackCode, defaultCodeLanguage);
  }

  if (type === 'EXERCISE' || type === 'QUIZ') {
    return normalizeQuizLikeContent(rawContent, type);
  }

  if (type === 'WRITTEN_QUIZ') {
    const fallback = getDefaultWrittenQuizContent();
    const content = toObjectOrNull(rawContent) || fallback;
    return {
      question:
        typeof content.question === 'string' && content.question.trim()
          ? content.question.trim()
          : fallback.question,
      idealAnswer:
        typeof content.idealAnswer === 'string' && content.idealAnswer.trim()
          ? content.idealAnswer.trim()
          : fallback.idealAnswer,
    };
  }

  if (type === 'INTERACTIVE_SIMULATION') {
    const normalizedSimulation = normalizeSimulationContent(rawContent, options);
    if (isLowQualitySimulationContent(normalizedSimulation, options.topic)) {
      return buildTopicSimulationFallback(options.topic);
    }
    return normalizedSimulation;
  }

  if (type === 'MERMAID_DIAGRAM') {
    const fallbackCode = buildTopicMermaidFallbackCode(options.topic);
    const content = toObjectOrNull(rawContent) || { code: fallbackCode };
    const rawCode = sanitizeMermaidCode(typeof content.code === 'string' ? content.code : '');
    return {
      code:
        isLikelyValidMermaidSyntax(rawCode) && !isLowQualityMermaidCode(rawCode)
          ? rawCode
          : fallbackCode,
    };
  }

  if (type === 'STATIC_CHART') {
    const fallback = buildTopicStaticChartFallback(options.topic);
    const content = toObjectOrNull(rawContent) || fallback;
    const validChartTypes = new Set(['bar', 'line', 'pie']);
    const normalizedChart = {
      chartType: validChartTypes.has(content.chartType) ? content.chartType : 'bar',
      title: typeof content.title === 'string' && content.title.trim() ? content.title.trim() : fallback.title,
      dataKey: typeof content.dataKey === 'string' && content.dataKey.trim() ? content.dataKey.trim() : 'value',
      data: Array.isArray(content.data) && content.data.length > 0 ? content.data : fallback.data,
    };
    return isLowQualityStaticChart(normalizedChart) ? fallback : normalizedChart;
  }

  return '';
};

const normalizeGeneratedBlock = (rawBlock, options = {}) => {
  const type = normalizeType(rawBlock?.type);
  return {
    type,
    content: normalizeBlockContentByType(type, rawBlock?.content, options),
  };
};

const buildFallbackBlock = (type, topic, purpose, defaultCodeLanguage = 'javascript') => {
  const safeTopic = String(topic || 'this topic');
  const safePurpose = String(purpose || '').trim();
  const suffix = safePurpose ? ` (${safePurpose})` : '';

  if (type === 'TEXT') {
    return {
      type,
      content: `This section explains ${safeTopic}${suffix}. Focus on the core ideas and one practical example.`,
    };
  }

  if (type === 'CODE') {
    return {
      type,
      content: getDefaultCodeSnippet(defaultCodeLanguage),
    };
  }

  if (type === 'EXERCISE') {
    return { type, content: getDefaultExerciseContent() };
  }

  if (type === 'QUIZ') {
    return { type, content: getDefaultQuizContent() };
  }

  if (type === 'DISCUSSION') {
    return {
      type,
      content: `How would you explain ${safeTopic} to a classmate using your own example?`,
    };
  }

  if (type === 'WRITTEN_QUIZ') {
    return { type, content: getDefaultWrittenQuizContent() };
  }

  if (type === 'INTERACTIVE_SIMULATION') {
    return { type, content: buildTopicSimulationFallback(safeTopic) };
  }

  if (type === 'MERMAID_DIAGRAM') {
    return { type, content: { code: buildTopicMermaidFallbackCode(safeTopic) } };
  }

  if (type === 'STATIC_CHART') {
    return {
      type,
      content: buildTopicStaticChartFallback(safeTopic),
    };
  }

  return { type: 'TEXT', content: `Let's explore ${safeTopic}.` };
};

const enforceRequiredBlockCoverage = (blocks, topic) => {
  const nextBlocks = [...blocks];

  // Move QUIZ nearer to the end if it's placed too early
  const firstQuizIndex = nextBlocks.findIndex((block) => block.type === 'QUIZ');
  if (firstQuizIndex !== -1 && firstQuizIndex < nextBlocks.length - 2) {
    const [quizBlock] = nextBlocks.splice(firstQuizIndex, 1);
    nextBlocks.push(quizBlock);
  }

  return nextBlocks;
};

const normalizeStructurePlan = (raw, topic, targetDuration) => {
  const fallbackSections = [
    { id: 'section-1', title: 'Introduction', goal: `Introduce ${topic}`, keyPoints: [`What is ${topic}?`] },
    { id: 'section-2', title: 'Core Concepts', goal: `Explain core ideas in ${topic}`, keyPoints: ['Core principle 1', 'Core principle 2'] },
    { id: 'section-3', title: 'Guided Practice', goal: `Practice ${topic}`, keyPoints: ['Worked example', 'Common mistakes'] },
    { id: 'section-4', title: 'Assessment & Wrap-Up', goal: `Check understanding of ${topic}`, keyPoints: ['Quick recap', 'Exit check'] },
  ];

  const sourceSections = Array.isArray(raw?.sections) && raw.sections.length > 0 ? raw.sections : fallbackSections;
  const safeDuration = Math.max(10, Number(targetDuration) || 30);
  const perSection = Math.max(5, Math.round(safeDuration / sourceSections.length));

  return {
    lessonTitle:
      typeof raw?.lessonTitle === 'string' && raw.lessonTitle.trim()
        ? raw.lessonTitle.trim()
        : `Lesson on ${topic}`,
    objectives: Array.isArray(raw?.objectives)
      ? raw.objectives.map((objective) => String(objective)).filter(Boolean).slice(0, 6)
      : [`Understand the key idea behind ${topic}`, `Apply ${topic} in one practical situation`],
    sections: sourceSections.map((section, index) => ({
      id:
        typeof section?.id === 'string' && section.id.trim()
          ? section.id.trim()
          : `section-${index + 1}`,
      title:
        typeof section?.title === 'string' && section.title.trim()
          ? section.title.trim()
          : `Section ${index + 1}`,
      goal:
        typeof section?.goal === 'string' && section.goal.trim()
          ? section.goal.trim()
          : `Teach section ${index + 1} of ${topic}`,
      durationMinutes: Math.max(3, Number(section?.durationMinutes) || perSection),
      keyPoints: Array.isArray(section?.keyPoints)
        ? section.keyPoints.map((point) => String(point)).filter(Boolean).slice(0, 6)
        : [],
      })),
  };
};

const alignStructurePlanToReferenceHeadings = (structurePlan, referenceStructure, targetDuration, topic) => {
  const headings = Array.isArray(referenceStructure?.headings)
    ? referenceStructure.headings.map((item) => normalizeReferenceHeading(item)).filter(Boolean)
    : [];

  if (headings.length < 2) {
    return structurePlan;
  }

  const boundedHeadings = headings.slice(0, MAX_REFERENCE_STRUCTURE_HEADINGS);
  const existingSections = Array.isArray(structurePlan?.sections) ? structurePlan.sections : [];
  const safeDuration = Math.max(10, Number(targetDuration) || 30);
  const perSection = Math.max(3, Math.round(safeDuration / boundedHeadings.length));

  const sections = boundedHeadings.map((heading, index) => {
    const fallbackTitle = `Section ${index + 1}`;
    const existing = existingSections[index] || {};
    return {
      id: `section-${index + 1}`,
      title: heading || existing.title || fallbackTitle,
      goal:
        typeof existing?.goal === 'string' && existing.goal.trim()
          ? existing.goal.trim()
          : `Teach ${heading || fallbackTitle} for ${topic}`,
      durationMinutes: Math.max(3, Number(existing?.durationMinutes) || perSection),
      keyPoints:
        Array.isArray(existing?.keyPoints) && existing.keyPoints.length > 0
          ? existing.keyPoints.slice(0, 6)
          : [heading || fallbackTitle],
    };
  });

  return {
    ...structurePlan,
    sections,
    _referenceStructureApplied: true,
    _referenceStructureSource: referenceStructure?.source || 'unknown',
  };
};

const buildDenseSectionFallbackBlocks = (sectionTitle, sectionIndex, totalSections) => {
  const safeTitle = String(sectionTitle || '').trim() || `Section ${sectionIndex + 1}`;

  if (sectionIndex === 0) {
    return [
      { type: 'TEXT', purpose: `Foundational overview of ${safeTitle}` },
      { type: 'DISCUSSION', purpose: `Initial thoughts on ${safeTitle}` },
      { type: 'EXERCISE', purpose: `Quick readiness check for ${safeTitle}` },
    ];
  }

  if (sectionIndex === totalSections - 1) {
    return [
      { type: 'TEXT', purpose: `Synthesize and reinforce ${safeTitle}` },
      { type: 'EXERCISE', purpose: `Applied practice for ${safeTitle}` },
      { type: 'QUIZ', purpose: 'End-of-lesson assessment' },
    ];
  }

  return [
    { type: 'TEXT', purpose: `Deep explanation of ${safeTitle}` },
    { type: 'TEXT', purpose: `Real-world examples for ${safeTitle}` },
    { type: 'DISCUSSION', purpose: `Critical thinking prompt for ${safeTitle}` },
  ];
};

const enforceSectionBlockDensity = (blocks, fallbackBlocks) => {
  const safeFallback = Array.isArray(fallbackBlocks) && fallbackBlocks.length > 0
    ? fallbackBlocks
    : [{ type: 'TEXT', purpose: 'Core explanation' }];

  let next = Array.isArray(blocks) ? [...blocks] : [];
  if (next.length > MAX_BLOCKS_PER_SECTION) {
    next = next.slice(0, MAX_BLOCKS_PER_SECTION);
  }

  if (next.length >= MIN_BLOCKS_PER_SECTION) {
    return next;
  }

  const hasType = (type) => next.some((block) => block.type === type);
  for (const fallback of safeFallback) {
    if (next.length >= MIN_BLOCKS_PER_SECTION) break;
    if (!hasType(fallback.type)) {
      next.push({ ...fallback });
    }
  }

  let fallbackCursor = 0;
  while (next.length < MIN_BLOCKS_PER_SECTION) {
    const fallback = safeFallback[fallbackCursor % safeFallback.length];
    next.push({ ...fallback });
    fallbackCursor += 1;
  }

  return next.slice(0, MAX_BLOCKS_PER_SECTION);
};

const normalizeBlockStrategyPlan = (raw, structurePlan) => {
  const indexById = new Map(structurePlan.sections.map((section, index) => [section.id, index]));
  const sections = structurePlan.sections.map((section, index) => {
    const rawSection = Array.isArray(raw?.sections)
      ? raw.sections.find((candidate) => candidate && candidate.id === section.id)
      : null;

    const fallbackBlocks = buildDenseSectionFallbackBlocks(
      section.title,
      index,
      structurePlan.sections.length
    );

    const rawBlocks = Array.isArray(rawSection?.blocks) ? rawSection.blocks : fallbackBlocks;
    const normalized = rawBlocks
      .map((block) => ({
        type: normalizeType(block?.type),
        purpose: typeof block?.purpose === 'string' ? block.purpose : '',
      }))
      .filter((block) => ALLOWED_BLOCK_TYPES.has(block.type));

    const blocks = enforceSectionBlockDensity(
      normalized.length > 0 ? normalized : fallbackBlocks,
      fallbackBlocks
    );

    return {
      id: section.id,
      title: section.title,
      blocks,
    };
  });

  // Keep QUIZ near the end.
  let lostQuiz = false;
  sections.forEach((section, sectionIndex) => {
    if (sectionIndex < sections.length - 1) {
      const quizBlocks = section.blocks.filter((block) => block.type === 'QUIZ');
      if (quizBlocks.length > 0) {
        lostQuiz = true;
      }
      section.blocks = section.blocks.filter((block) => block.type !== 'QUIZ');
      const fallbackBlocks = buildDenseSectionFallbackBlocks(
        section.title,
        sectionIndex,
        sections.length
      );
      section.blocks = enforceSectionBlockDensity(section.blocks, fallbackBlocks);
    }
  });

  if (lostQuiz && !sections[sections.length - 1].blocks.some((block) => block.type === 'QUIZ')) {
    sections[sections.length - 1].blocks.push({ type: 'QUIZ', purpose: 'End-of-lesson assessment' });
  }

  const lastSectionIndex = sections.length - 1;
  const lastFallback = buildDenseSectionFallbackBlocks(
    sections[lastSectionIndex].title,
    lastSectionIndex,
    sections.length
  );
  sections[lastSectionIndex].blocks = enforceSectionBlockDensity(sections[lastSectionIndex].blocks, lastFallback);
  if (!sections[lastSectionIndex].blocks.some((block) => block.type === 'QUIZ')) {
    const quizBlock = { type: 'QUIZ', purpose: 'End-of-lesson assessment' };
    if (sections[lastSectionIndex].blocks.length >= MAX_BLOCKS_PER_SECTION) {
      sections[lastSectionIndex].blocks[MAX_BLOCKS_PER_SECTION - 1] = quizBlock;
    } else {
      sections[lastSectionIndex].blocks.push(quizBlock);
    }
  }

  return {
    lessonTitle:
      typeof raw?.lessonTitle === 'string' && raw.lessonTitle.trim()
        ? raw.lessonTitle.trim()
        : structurePlan.lessonTitle,
    sections,
    sectionOrder: structurePlan.sections.map((section) => section.id),
    indexById,
  };
};

const normalizeFinalLessonData = (raw, structurePlan, strategyPlan, topic, options = {}) => {
  const defaultCodeLanguage = normalizeCodeLanguage(options.defaultCodeLanguage);
  const title =
    typeof raw?.title === 'string' && raw.title.trim()
      ? raw.title.trim()
      : structurePlan.lessonTitle || `Lesson on ${topic}`;

  let blocks = [];

  if (Array.isArray(raw?.blocks) && raw.blocks.length > 0) {
    blocks = raw.blocks.map((block) =>
      normalizeGeneratedBlock(block, { defaultCodeLanguage, topic })
    );
  } else {
    const fallbackBlocks = [];
    strategyPlan.sections.forEach((section) => {
      section.blocks.forEach((block) => {
        fallbackBlocks.push(
          buildFallbackBlock(block.type, topic, block.purpose || section.title, defaultCodeLanguage)
        );
      });
    });
    blocks = fallbackBlocks.map((block) =>
      normalizeGeneratedBlock(block, { defaultCodeLanguage, topic })
    );
  }

  if (blocks.length === 0) {
    blocks = [
      normalizeGeneratedBlock(buildFallbackBlock('TEXT', topic, 'introduction', defaultCodeLanguage), {
        defaultCodeLanguage,
        topic,
      }),
      normalizeGeneratedBlock(buildFallbackBlock('CODE', topic, 'example', defaultCodeLanguage), {
        defaultCodeLanguage,
        topic,
      }),
      normalizeGeneratedBlock(buildFallbackBlock('EXERCISE', topic, 'practice', defaultCodeLanguage), {
        defaultCodeLanguage,
        topic,
      }),
      normalizeGeneratedBlock(
        buildFallbackBlock('INTERACTIVE_SIMULATION', topic, 'simulation', defaultCodeLanguage),
        { defaultCodeLanguage, topic }
      ),
      normalizeGeneratedBlock(buildFallbackBlock('QUIZ', topic, 'assessment', defaultCodeLanguage), {
        defaultCodeLanguage,
        topic,
      }),
    ];
  }

  blocks = enforceRequiredBlockCoverage(blocks, topic);

  return { title, blocks };
};

const serializeBlockContent = (content) =>
  typeof content === 'object' ? JSON.stringify(content) : String(content ?? '');

const deserializeBlockContentByType = (type, rawContent, options = {}) => {
  if (type === 'TEXT' || type === 'DISCUSSION') {
    return normalizeBlockContentByType(type, rawContent, options);
  }

  const parsed = typeof rawContent === 'string' ? tryParseJson(rawContent) : null;
  const candidate = parsed !== null ? parsed : rawContent;
  return normalizeBlockContentByType(type, candidate, options);
};

const normalizeIncomingLessonBlockPayload = (rawBlock, index) => {
  const type = normalizeType(rawBlock?.type);
  const blockId = typeof rawBlock?.id === 'string' ? rawBlock.id.trim() : '';
  const content = normalizeBlockContentByType(type, rawBlock?.content);
  return {
    id: blockId,
    type,
    content,
    order_index: index,
    is_post_publish_addition: Boolean(rawBlock?.is_post_publish_addition),
  };
};

const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${pairs.join(',')}}`;
};

const blockContentEquals = (a, b) => {
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b;
  }
  return stableStringify(a) === stableStringify(b);
};

const serializeStudentPersonalBlock = (block) => ({
  ...block,
  content: deserializeBlockContentByType(block.type, block.content),
});

const resolveStudentLessonForkTitle = (sourceTitle) => {
  const safeSourceTitle = String(sourceTitle || 'Untitled Lesson').trim() || 'Untitled Lesson';
  if (safeSourceTitle.toLowerCase().endsWith('(my copy)')) {
    return safeSourceTitle;
  }
  return `${safeSourceTitle} (My Copy)`;
};

const findOrCreateStudentLessonFork = async (tx, sourceLesson, studentId) => {
  if (!sourceLesson?.id || !studentId) {
    throw new Error('Invalid fork request');
  }

  const existingFork = await tx.lesson.findFirst({
    where: {
      source_lesson_id: sourceLesson.id,
      owner_student_id: studentId,
    },
    include: {
      blocks: {
        orderBy: { order_index: 'asc' },
      },
      class: true,
    },
  });

  if (existingFork) {
    return existingFork;
  }

  const sourceBlocks = await tx.lessonBlock.findMany({
    where: { lesson_id: sourceLesson.id },
    orderBy: { order_index: 'asc' },
  });

  const createdFork = await tx.lesson.create({
    data: {
      class_id: sourceLesson.class_id,
      title: resolveStudentLessonForkTitle(sourceLesson.title),
      created_by: studentId,
      owner_student_id: studentId,
      source_lesson_id: sourceLesson.id,
      status: sourceLesson.status,
    },
  });

  if (sourceBlocks.length > 0) {
    await tx.lessonBlock.createMany({
      data: sourceBlocks.map((block, index) => ({
        lesson_id: createdFork.id,
        type: block.type,
        content: block.content,
        order_index: index,
        is_post_publish_addition: Boolean(block.is_post_publish_addition),
      })),
    });
  }

  return tx.lesson.findUnique({
    where: { id: createdFork.id },
    include: {
      blocks: {
        orderBy: { order_index: 'asc' },
      },
      class: true,
    },
  });
};

const runWithTimeout = async (promiseFactory, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const withHardTimeout = async (promise, timeoutMs, timeoutMessage = 'Operation timed out') =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });

const MAX_REFERENCE_FILES = Math.max(1, Math.min(12, Number(process.env.MAX_REFERENCE_FILES) || 8));
const MAX_REFERENCE_FILE_BYTES = Math.max(
  256 * 1024,
  Number(process.env.MAX_REFERENCE_FILE_BYTES) || (6 * 1024 * 1024)
);
const MAX_REFERENCE_TOTAL_BYTES = Math.max(
  MAX_REFERENCE_FILE_BYTES,
  Number(process.env.MAX_REFERENCE_TOTAL_BYTES) || (18 * 1024 * 1024)
);
const MAX_REFINE_REFERENCE_IMAGES = Math.max(
  1,
  Math.min(8, Number(process.env.MAX_REFINE_REFERENCE_IMAGES) || 4)
);
const MAX_REFINE_REFERENCE_IMAGE_BYTES = Math.max(
  256 * 1024,
  Number(process.env.MAX_REFINE_REFERENCE_IMAGE_BYTES) || (6 * 1024 * 1024)
);
const MAX_REFINE_REFERENCE_IMAGE_TOTAL_BYTES = Math.max(
  MAX_REFINE_REFERENCE_IMAGE_BYTES,
  Number(process.env.MAX_REFINE_REFERENCE_IMAGE_TOTAL_BYTES) || (12 * 1024 * 1024)
);
const MAX_GENERATE_REFERENCE_IMAGES = Math.max(
  1,
  Math.min(24, Number(process.env.MAX_GENERATE_REFERENCE_IMAGES) || 16)
);
const MAX_GENERATE_REFERENCE_IMAGE_BYTES = Math.max(
  256 * 1024,
  Number(process.env.MAX_GENERATE_REFERENCE_IMAGE_BYTES) || (4 * 1024 * 1024)
);
const MAX_GENERATE_REFERENCE_IMAGE_TOTAL_BYTES = Math.max(
  MAX_GENERATE_REFERENCE_IMAGE_BYTES,
  Number(process.env.MAX_GENERATE_REFERENCE_IMAGE_TOTAL_BYTES) || (24 * 1024 * 1024)
);
const MAX_REFERENCE_TEXT_CHARS_PER_FILE = 7000;
const MAX_REFERENCE_TEXT_CHARS_TOTAL = 30000;
const REFERENCE_EXTRACTION_TIMEOUT_MS = 35000;
const MAX_REFERENCE_STRUCTURE_HEADINGS = 6;
const MAX_TOTAL_GENERATION_VISUALS = 24;
const MAX_VISUALS_PER_SECTION = 4;
const WIKIMEDIA_MAX_QUERIES = 6;
const WIKIMEDIA_MAX_RESULTS_PER_QUERY = 8;
const WIKIMEDIA_MAX_SELECTED_VISUALS = 12;

const REFERENCE_TEXTUAL_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.html', '.htm',
  '.rtf', '.yaml', '.yml', '.ini', '.log', '.py', '.js', '.ts', '.tsx', '.jsx',
  '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.sql', '.sh',
]);

const REFERENCE_BINARY_EXTENSIONS_FOR_MODEL = new Set([
  '.pdf', '.ppt', '.pptx', '.doc', '.docx', '.xls', '.xlsx',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
]);
const REFERENCE_IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tif', '.tiff', '.heic', '.heif', '.avif',
]);

const REFERENCE_MIME_BY_EXTENSION = {
  '.pdf': 'application/pdf',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
};

const normalizeReferenceWhitespace = (text) =>
  String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

const stripDataUrlPrefix = (value) => {
  const raw = String(value || '').trim();
  const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1] || '',
      base64: dataUrlMatch[2] || '',
    };
  }
  return {
    mimeType: '',
    base64: raw,
  };
};

const sanitizeFileName = (value, fallback) => {
  const safe = String(value || '')
    .replace(/[^\w.\-()\[\] ]/g, '')
    .trim();
  return safe || fallback;
};

const guessMimeTypeFromFileName = (fileName) => {
  const extension = path.extname(String(fileName || '').toLowerCase());
  return REFERENCE_MIME_BY_EXTENSION[extension] || 'application/octet-stream';
};

const estimateBytesFromBase64 = (base64) => {
  const sanitized = String(base64 || '').replace(/\s+/g, '');
  if (!sanitized) return 0;
  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((sanitized.length * 3) / 4) - padding);
};

const isLikelyTextReferenceFile = (fileName, mimeType) => {
  const safeMime = String(mimeType || '').toLowerCase();
  const extension = path.extname(String(fileName || '').toLowerCase());
  if (safeMime.startsWith('text/')) return true;
  if (safeMime.includes('json') || safeMime.includes('xml')) return true;
  return REFERENCE_TEXTUAL_EXTENSIONS.has(extension);
};

const shouldAttemptModelExtractionForFile = (fileName, mimeType) => {
  const safeMime = String(mimeType || '').toLowerCase();
  const extension = path.extname(String(fileName || '').toLowerCase());
  if (safeMime.startsWith('image/') || safeMime.startsWith('audio/') || safeMime.startsWith('video/')) return true;
  if (safeMime === 'application/pdf') return true;
  if (safeMime === 'application/octet-stream') return REFERENCE_BINARY_EXTENSIONS_FOR_MODEL.has(extension);
  if (safeMime.startsWith('application/') || safeMime.startsWith('text/')) return true;
  return REFERENCE_BINARY_EXTENSIONS_FOR_MODEL.has(extension);
};

const isLikelyImageReferenceFile = (fileName, mimeType) => {
  const safeMime = String(mimeType || '').toLowerCase();
  if (safeMime.startsWith('image/')) return true;
  const extension = path.extname(String(fileName || '').toLowerCase());
  return REFERENCE_IMAGE_EXTENSIONS.has(extension);
};

const decodeTextFromBuffer = (buffer) => {
  const utf8Text = buffer.toString('utf8');
  const replacementRatio = (utf8Text.match(/\uFFFD/g) || []).length / Math.max(utf8Text.length, 1);
  if (replacementRatio > 0.1) {
    return buffer.toString('latin1');
  }
  return utf8Text;
};

const normalizeReferenceFilesInput = (rawFiles) => {
  const warnings = [];
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return { files: [], warnings };
  }

  const safeFiles = [];
  let totalBytes = 0;
  const boundedFiles = rawFiles.slice(0, MAX_REFERENCE_FILES);

  if (rawFiles.length > MAX_REFERENCE_FILES) {
    warnings.push(`Only the first ${MAX_REFERENCE_FILES} reference files were processed.`);
  }

  boundedFiles.forEach((rawFile, index) => {
    const fallbackName = `reference-file-${index + 1}`;
    const fileName = sanitizeFileName(rawFile?.name, fallbackName);
    const stripped = stripDataUrlPrefix(rawFile?.base64 || '');
    const sanitizedBase64 = String(stripped.base64 || '').replace(/\s+/g, '');
    const mimeCandidate = String(rawFile?.mimeType || rawFile?.type || stripped.mimeType || '').trim().toLowerCase();
    const mimeType = mimeCandidate || guessMimeTypeFromFileName(fileName);

    if (!sanitizedBase64) {
      warnings.push(`Skipped "${fileName}" because it had no readable content.`);
      return;
    }

    if (!/^[a-z0-9+/=]+$/i.test(sanitizedBase64)) {
      warnings.push(`Skipped "${fileName}" because its encoding was invalid.`);
      return;
    }

    const estimatedBytes = estimateBytesFromBase64(sanitizedBase64);
    if (estimatedBytes <= 0) {
      warnings.push(`Skipped "${fileName}" because it appears empty.`);
      return;
    }

    if (estimatedBytes > MAX_REFERENCE_FILE_BYTES) {
      warnings.push(
        `Skipped "${fileName}" because it exceeds the per-file limit of ${Math.round(MAX_REFERENCE_FILE_BYTES / (1024 * 1024))} MB.`
      );
      return;
    }

    if (totalBytes + estimatedBytes > MAX_REFERENCE_TOTAL_BYTES) {
      warnings.push(
        `Skipped "${fileName}" because total uploaded reference files exceed ${Math.round(MAX_REFERENCE_TOTAL_BYTES / (1024 * 1024))} MB.`
      );
      return;
    }

    totalBytes += estimatedBytes;
    safeFiles.push({
      name: fileName,
      mimeType,
      sizeBytes: estimatedBytes,
      base64: sanitizedBase64,
    });
  });

  return { files: safeFiles, warnings };
};

const normalizeRefineImageInputs = (rawImages) => {
  const warnings = [];
  if (!Array.isArray(rawImages) || rawImages.length === 0) {
    return { images: [], warnings, requestedCount: 0 };
  }

  const safeImages = [];
  let totalBytes = 0;
  const boundedImages = rawImages.slice(0, MAX_REFINE_REFERENCE_IMAGES);
  if (rawImages.length > MAX_REFINE_REFERENCE_IMAGES) {
    warnings.push(`Only the first ${MAX_REFINE_REFERENCE_IMAGES} reference images were processed.`);
  }

  boundedImages.forEach((rawImage, index) => {
    const fallbackName = `reference-image-${index + 1}`;
    const fileName = sanitizeFileName(rawImage?.name, fallbackName);
    const stripped = stripDataUrlPrefix(rawImage?.base64 || '');
    const sanitizedBase64 = String(stripped.base64 || '').replace(/\s+/g, '');
    const mimeCandidate = String(rawImage?.mimeType || rawImage?.type || stripped.mimeType || '').trim().toLowerCase();
    const mimeType = mimeCandidate || guessMimeTypeFromFileName(fileName);

    if (!isLikelyImageReferenceFile(fileName, mimeType)) {
      warnings.push(`Skipped "${fileName}" because only image files are supported for refine context.`);
      return;
    }

    if (!sanitizedBase64) {
      warnings.push(`Skipped "${fileName}" because it had no readable content.`);
      return;
    }

    if (!/^[a-z0-9+/=]+$/i.test(sanitizedBase64)) {
      warnings.push(`Skipped "${fileName}" because its encoding was invalid.`);
      return;
    }

    const estimatedBytes = estimateBytesFromBase64(sanitizedBase64);
    if (estimatedBytes <= 0) {
      warnings.push(`Skipped "${fileName}" because it appears empty.`);
      return;
    }

    if (estimatedBytes > MAX_REFINE_REFERENCE_IMAGE_BYTES) {
      warnings.push(
        `Skipped "${fileName}" because it exceeds the per-image limit of ${Math.round(MAX_REFINE_REFERENCE_IMAGE_BYTES / (1024 * 1024))} MB.`
      );
      return;
    }

    if (totalBytes + estimatedBytes > MAX_REFINE_REFERENCE_IMAGE_TOTAL_BYTES) {
      warnings.push(
        `Skipped "${fileName}" because total uploaded refine images exceed ${Math.round(MAX_REFINE_REFERENCE_IMAGE_TOTAL_BYTES / (1024 * 1024))} MB.`
      );
      return;
    }

    totalBytes += estimatedBytes;
    safeImages.push({
      name: fileName,
      mimeType: mimeType.startsWith('image/') ? mimeType : guessMimeTypeFromFileName(fileName),
      sizeBytes: estimatedBytes,
      base64: sanitizedBase64,
    });
  });

  return {
    images: safeImages,
    warnings,
    requestedCount: rawImages.length,
  };
};

const normalizeGenerationImageSource = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'pdf_snapshot') return 'pdf_snapshot';
  return 'uploaded_image';
};

const normalizeGenerationReferenceImagesInput = (rawImages) => {
  const warnings = [];
  if (!Array.isArray(rawImages) || rawImages.length === 0) {
    return { images: [], warnings, requestedCount: 0 };
  }

  const safeImages = [];
  let totalBytes = 0;
  const boundedImages = rawImages.slice(0, MAX_GENERATE_REFERENCE_IMAGES);
  if (rawImages.length > MAX_GENERATE_REFERENCE_IMAGES) {
    warnings.push(`Only the first ${MAX_GENERATE_REFERENCE_IMAGES} generation reference images were processed.`);
  }

  boundedImages.forEach((rawImage, index) => {
    const fallbackName = `generation-reference-image-${index + 1}`;
    const fileName = sanitizeFileName(rawImage?.name, fallbackName);
    const stripped = stripDataUrlPrefix(rawImage?.base64 || '');
    const sanitizedBase64 = String(stripped.base64 || '').replace(/\s+/g, '');
    const mimeCandidate = String(rawImage?.mimeType || rawImage?.type || stripped.mimeType || '').trim().toLowerCase();
    const mimeType = mimeCandidate || guessMimeTypeFromFileName(fileName);

    if (!isLikelyImageReferenceFile(fileName, mimeType)) {
      warnings.push(`Skipped "${fileName}" because only image files are supported for visual insertion.`);
      return;
    }

    if (!sanitizedBase64) {
      warnings.push(`Skipped "${fileName}" because it had no readable content.`);
      return;
    }

    if (!/^[a-z0-9+/=]+$/i.test(sanitizedBase64)) {
      warnings.push(`Skipped "${fileName}" because its encoding was invalid.`);
      return;
    }

    const estimatedBytes = estimateBytesFromBase64(sanitizedBase64);
    if (estimatedBytes <= 0) {
      warnings.push(`Skipped "${fileName}" because it appears empty.`);
      return;
    }

    if (estimatedBytes > MAX_GENERATE_REFERENCE_IMAGE_BYTES) {
      warnings.push(
        `Skipped "${fileName}" because it exceeds the per-image limit of ${Math.round(MAX_GENERATE_REFERENCE_IMAGE_BYTES / (1024 * 1024))} MB.`
      );
      return;
    }

    if (totalBytes + estimatedBytes > MAX_GENERATE_REFERENCE_IMAGE_TOTAL_BYTES) {
      warnings.push(
        `Skipped "${fileName}" because total uploaded generation images exceed ${Math.round(MAX_GENERATE_REFERENCE_IMAGE_TOTAL_BYTES / (1024 * 1024))} MB.`
      );
      return;
    }

    totalBytes += estimatedBytes;
    safeImages.push({
      name: fileName,
      mimeType: mimeType.startsWith('image/') ? mimeType : guessMimeTypeFromFileName(fileName),
      sizeBytes: estimatedBytes,
      base64: sanitizedBase64,
      source: normalizeGenerationImageSource(rawImage?.source),
      sourceFile: sanitizeFileName(rawImage?.sourceFile, ''),
      sourcePage: Number.isFinite(Number(rawImage?.sourcePage))
        ? Math.max(1, Math.floor(Number(rawImage.sourcePage)))
        : null,
    });
  });

  return {
    images: safeImages,
    warnings,
    requestedCount: rawImages.length,
  };
};

const decodeBasicHtmlEntities = (value) =>
  String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

const normalizeReferenceHeading = (value) => {
  const decoded = decodeBasicHtmlEntities(String(value || '').replace(/<[^>]*>/g, ' '));
  const compact = decoded
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*\d+(\.\d+)*[\)\].:\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!compact) return '';
  if (compact.length < 4 || compact.length > 96) return '';
  if (/^(page|figure|table)\s+\d+$/i.test(compact)) return '';
  return compact;
};

const extractHeuristicReferenceHeadings = (referenceText) => {
  const lines = String(referenceText || '').split(/\r?\n/);
  const collected = [];

  lines.forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    if (/^[-*+]\s+/.test(trimmed)) return;

    if (/^#{1,6}\s+/.test(trimmed)) {
      const heading = normalizeReferenceHeading(trimmed);
      if (heading) collected.push(heading);
      return;
    }

    const numbered = trimmed.match(/^\d+(\.\d+)*[\)\].:\-\s]+(.+)$/);
    if (numbered?.[2]) {
      const heading = normalizeReferenceHeading(numbered[2]);
      if (heading) collected.push(heading);
      return;
    }

    const allCapsLike = /^[A-Z][A-Za-z0-9 ,()&\/\-]{3,90}$/.test(trimmed) && !/[.?!]$/.test(trimmed);
    if (allCapsLike && !/\b(and|or|but|because|therefore)\b/i.test(trimmed)) {
      const heading = normalizeReferenceHeading(trimmed);
      if (heading) collected.push(heading);
    }
  });

  const deduped = [];
  const seen = new Set();
  collected.forEach((heading) => {
    const key = heading.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(heading);
  });

  return deduped.slice(0, MAX_REFERENCE_STRUCTURE_HEADINGS);
};

const extractReferenceStructureWithAI = async ({ topic, referenceText }) => {
  if (!hasUsableAIConfig()) return [];

  const safeReference = String(referenceText || '').trim();
  if (!safeReference) return [];

  const prompt = `Topic: ${topic}
Reference material:
${safeReference.slice(0, 22000)}

Extract only the intended instructional section order from this material.
Return ONLY valid JSON with this shape:
{"headings":["Heading 1","Heading 2"]}

Rules:
- 2 to ${MAX_REFERENCE_STRUCTURE_HEADINGS} headings.
- Keep order exactly as implied by the source.
- Remove teacher-side chatter, logistics, and non-pedagogical notes.
- Keep each heading concise and classroom-appropriate.`;

  try {
    const responseText = await callOpenRouter({
      messages: [
        { role: 'system', content: 'You are a curriculum structure extraction assistant. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      jsonMode: true,
      timeoutMs: 22000,
    });
    const parsed = parseJsonFromText(responseText || '');
    const headings = Array.isArray(parsed?.headings)
      ? parsed.headings.map((item) => normalizeReferenceHeading(item)).filter(Boolean)
      : [];
    const deduped = [];
    const seen = new Set();
    headings.forEach((heading) => {
      const key = heading.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(heading);
    });
    return deduped.slice(0, MAX_REFERENCE_STRUCTURE_HEADINGS);
  } catch (err) {
    console.warn('AI reference structure extraction failed:', err?.message || err);
    return [];
  }
};

const buildReferenceStructureContext = async ({ topic, referenceText }) => {
  const warnings = [];
  const heuristic = extractHeuristicReferenceHeadings(referenceText);
  if (heuristic.length >= 2) {
    return {
      headings: heuristic,
      source: 'heuristic',
      warnings,
    };
  }

  const aiHeadings = await extractReferenceStructureWithAI({ topic, referenceText });
  if (aiHeadings.length >= 2) {
    return {
      headings: aiHeadings,
      source: 'ai',
      warnings,
    };
  }

  if (heuristic.length > 0) {
    warnings.push('Reference structure hints were sparse; proceeding with weak heading guidance.');
  } else {
    warnings.push('No clear heading structure was detected in reference material.');
  }

  return {
    headings: heuristic,
    source: heuristic.length > 0 ? 'heuristic_partial' : 'none',
    warnings,
  };
};

const summarizeBinaryReferenceFileWithAI = async ({ fileName, mimeType, base64, topic }) => {
  // Placeholder: the current OpenRouter model does not support file/image processing.
  // Return empty string so the lesson generation pipeline continues without file-based context.
  console.warn(`[Placeholder] Skipping AI summarization for "${fileName}" (${mimeType}) — model does not support file inputs.`);
  return '';
};

const buildReferenceFilesContext = async ({ topic, referenceFiles = [] }) => {
  const warnings = [];
  if (!Array.isArray(referenceFiles) || referenceFiles.length === 0) {
    return {
      combinedText: '',
      warnings,
      filesUsed: [],
    };
  }

  const extractionResults = [];
  for (const file of referenceFiles) {
    const fileName = sanitizeFileName(file?.name, 'reference-file');
    const mimeType = String(file?.mimeType || guessMimeTypeFromFileName(fileName)).toLowerCase();
    const base64 = String(file?.base64 || '');

    if (!base64) {
      extractionResults.push({
        fileName,
        mimeType,
        text: '',
        warning: `Skipped "${fileName}" because it had no decodable content.`,
      });
      continue;
    }

    if (isLikelyTextReferenceFile(fileName, mimeType)) {
      try {
        const decoded = decodeTextFromBuffer(Buffer.from(base64, 'base64'));
        const normalized = normalizeReferenceWhitespace(decoded).slice(0, MAX_REFERENCE_TEXT_CHARS_PER_FILE);
        extractionResults.push({
          fileName,
          mimeType,
          text: normalized,
          warning: '',
        });
      } catch {
        extractionResults.push({
          fileName,
          mimeType,
          text: '',
          warning: `Failed to decode text file "${fileName}".`,
        });
      }
      continue;
    }

    if (!shouldAttemptModelExtractionForFile(fileName, mimeType)) {
      extractionResults.push({
        fileName,
        mimeType,
        text: '',
        warning: `Skipped "${fileName}" because this file type is not currently supported for automatic extraction.`,
      });
      continue;
    }

    const extracted = await summarizeBinaryReferenceFileWithAI({
      fileName,
      mimeType,
      base64,
      topic,
    });

    if (!extracted) {
      extractionResults.push({
        fileName,
        mimeType,
        text: '',
        warning: `Could not extract usable context from "${fileName}".`,
      });
      continue;
    }

    extractionResults.push({
      fileName,
      mimeType,
      text: extracted,
      warning: '',
    });
  }

  const filesUsed = [];
  const chunks = [];
  extractionResults.forEach((result) => {
    if (result.warning) {
      warnings.push(result.warning);
      return;
    }
    if (!result.text) {
      return;
    }

    filesUsed.push({
      name: result.fileName,
      mimeType: result.mimeType,
    });
    chunks.push(`File: ${result.fileName}\nType: ${result.mimeType}\nExtracted context:\n${result.text}`);
  });

  const combinedText = normalizeReferenceWhitespace(chunks.join('\n\n')).slice(0, MAX_REFERENCE_TEXT_CHARS_TOTAL);
  return {
    combinedText,
    warnings,
    filesUsed,
  };
};

const RESEARCH_CACHE_TTL_SECONDS = Math.max(
  60,
  Number(process.env.RESEARCH_CACHE_TTL_SECONDS) || 1800
);
const RESEARCH_MAX_QUERIES = Math.max(
  3,
  Math.min(5, Number(process.env.RESEARCH_MAX_QUERIES) || 5)
);
const RESEARCH_MAX_GLOBAL_EVIDENCE = Math.max(
  6,
  Math.min(20, Number(process.env.RESEARCH_MAX_GLOBAL_EVIDENCE) || 12)
);
const RESEARCH_MAX_SECTION_EVIDENCE = Math.max(
  2,
  Math.min(8, Number(process.env.RESEARCH_MAX_SECTION_EVIDENCE) || 4)
);
const RESEARCH_MIN_CONFIDENCE = Math.max(
  0,
  Math.min(1, Number(process.env.RESEARCH_MIN_CONFIDENCE) || 0.42)
);
const RESEARCH_SNIPPET_MAX_CHARS = 420;
const RESEARCH_GLOBAL_PROMPT_MAX_CHARS = 3000;
const RESEARCH_SECTION_PROMPT_MAX_CHARS = 1600;
const RESEARCH_SECTION_QUERY_COUNT = 2;
const RESEARCH_CACHE_KEY_PREFIX = 'lesson:research:v1:';

const memoryResearchCache = new Map();
let researchRedisClient = null;
let researchRedisInitPromise = null;

const LOW_SIGNAL_SNIPPET_PATTERNS = [
  /click here/i,
  /subscribe/i,
  /sign up/i,
  /buy now/i,
  /read more/i,
  /cookie/i,
  /accept all/i,
  /privacy policy/i,
  /terms of service/i,
];

const INJECTION_LINE_PATTERNS = [
  /ignore\s+(all\s+)?previous/i,
  /\bsystem prompt\b/i,
  /\bact as\b/i,
  /\byou are chatgpt\b/i,
  /\bfollow these instructions\b/i,
  /\boverride\b/i,
  /\bdeveloper message\b/i,
];

const RESEARCH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'about', 'your', 'their',
  'what', 'when', 'where', 'which', 'while', 'using', 'used', 'have', 'has', 'had', 'are',
  'was', 'were', 'also', 'than', 'then', 'there', 'here', 'into', 'over', 'under', 'more',
  'most', 'some', 'such', 'very', 'just', 'not', 'can', 'could', 'would', 'should', 'will',
  'topic', 'guide', 'overview', 'introduction', 'lesson', 'university', 'college', 'student',
]);

const TRUSTED_DOMAIN_PATTERNS = [
  { pattern: /(^|\.)edu$/i, weight: 0.95 },
  { pattern: /(^|\.)gov$/i, weight: 0.94 },
  { pattern: /(^|\.)ac\.uk$/i, weight: 0.93 },
  { pattern: /(^|\.)arxiv\.org$/i, weight: 0.92 },
  { pattern: /(^|\.)ieee\.org$/i, weight: 0.92 },
  { pattern: /(^|\.)acm\.org$/i, weight: 0.92 },
  { pattern: /(^|\.)w3\.org$/i, weight: 0.9 },
  { pattern: /(^|\.)python\.org$/i, weight: 0.9 },
  { pattern: /(^|\.)developer\.mozilla\.org$/i, weight: 0.9 },
  { pattern: /(^|\.)docs\./i, weight: 0.86 },
];

const LOW_TRUST_DOMAIN_PATTERNS = [
  { pattern: /(^|\.)pinterest\./i, weight: 0.25 },
  { pattern: /(^|\.)quora\./i, weight: 0.3 },
  { pattern: /(^|\.)facebook\./i, weight: 0.2 },
  { pattern: /(^|\.)instagram\./i, weight: 0.2 },
  { pattern: /(^|\.)tiktok\./i, weight: 0.2 },
];

const recencyTopicPattern = /\b(latest|current|recent|today|new|update|updated|release|version|trend|202\d)\b/i;

const clampNumber = (value, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
};

const stripUnsafeSnippetText = (value) => {
  const raw = String(value || '');
  if (!raw.trim()) return '';

  const plain = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = plain
    .split(/(?<=[.?!])\s+|\s+-\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter((chunk) => !INJECTION_LINE_PATTERNS.some((pattern) => pattern.test(chunk)))
    .filter((chunk) => !LOW_SIGNAL_SNIPPET_PATTERNS.some((pattern) => pattern.test(chunk)));

  const sanitized = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!sanitized) return '';
  if (sanitized.length <= RESEARCH_SNIPPET_MAX_CHARS) return sanitized;
  return `${sanitized.slice(0, RESEARCH_SNIPPET_MAX_CHARS - 3).trimEnd()}...`;
};

const extractDomainFromUrl = (value) => {
  const candidate = String(value || '').trim();
  if (!candidate) return '';

  try {
    const parsed = new URL(candidate);
    return parsed.hostname.toLowerCase();
  } catch {
    return '';
  }
};

const inferPublishedAt = (text, url = '') => {
  const combined = `${String(text || '')} ${String(url || '')}`;

  const ymdMatch = combined.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (ymdMatch) {
    const iso = `${ymdMatch[1]}-${String(ymdMatch[2]).padStart(2, '0')}-${String(ymdMatch[3]).padStart(2, '0')}`;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const yearMatch = combined.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const date = new Date(`${yearMatch[1]}-01-01`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return null;
};

const tokenizeForResearch = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !RESEARCH_STOP_WORDS.has(token));

const computeTokenOverlapScore = (tokensA = [], tokensB = []) => {
  if (!Array.isArray(tokensA) || !Array.isArray(tokensB) || tokensA.length === 0 || tokensB.length === 0) {
    return 0;
  }

  const setB = new Set(tokensB);
  let hits = 0;
  tokensA.forEach((token) => {
    if (setB.has(token)) hits += 1;
  });
  return hits / Math.max(tokensA.length, tokensB.length);
};

const isRecencySensitiveTopic = (topic, teacherReference) =>
  recencyTopicPattern.test(`${String(topic || '')} ${String(teacherReference || '')}`);

const getDomainTrustScore = (domain) => {
  const safeDomain = String(domain || '').toLowerCase();
  if (!safeDomain) return 0.45;

  for (const item of TRUSTED_DOMAIN_PATTERNS) {
    if (item.pattern.test(safeDomain)) {
      return item.weight;
    }
  }

  for (const item of LOW_TRUST_DOMAIN_PATTERNS) {
    if (item.pattern.test(safeDomain)) {
      return item.weight;
    }
  }

  if (safeDomain.endsWith('.org')) return 0.78;
  if (safeDomain.endsWith('.com')) return 0.62;
  return 0.55;
};

const getRecencyScore = (publishedAt, recencySensitive) => {
  if (!recencySensitive) return 0.6;
  if (!publishedAt) return 0.25;

  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return 0.25;

  const ageDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 1;
  if (ageDays <= 180) return 0.86;
  if (ageDays <= 365) return 0.74;
  if (ageDays <= 730) return 0.62;
  return 0.35;
};

const getSnippetQualityScore = (snippet) => {
  const safeSnippet = String(snippet || '');
  if (!safeSnippet.trim()) return 0.1;

  let score = 0.58;
  if (safeSnippet.length >= 90) score += 0.16;
  if (safeSnippet.length >= 220) score += 0.08;
  if (/\b(therefore|because|evidence|benchmark|experiment|algorithm|complexity|proof)\b/i.test(safeSnippet)) {
    score += 0.08;
  }
  if (LOW_SIGNAL_SNIPPET_PATTERNS.some((pattern) => pattern.test(safeSnippet))) {
    score -= 0.28;
  }
  return clampNumber(score, 0, 1);
};

const flattenRelatedTopics = (items = [], query = '', acc = []) => {
  items.forEach((item) => {
    if (!item || typeof item !== 'object') return;

    if (Array.isArray(item.Topics)) {
      flattenRelatedTopics(item.Topics, query, acc);
      return;
    }

    if (item.Text) {
      acc.push({
        title: item.Text.split(' - ')[0] || 'Result',
        snippet: item.Text,
        url: item.FirstURL || '',
        query,
        source: 'duckduckgo_related',
      });
    }
  });

  return acc;
};

const fetchDuckDuckGoCandidates = async (query) => {
  const safeQuery = String(query || '').trim();
  if (!safeQuery) return [];

  const response = await runWithTimeout(
    (signal) =>
      fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(safeQuery)}&format=json&no_html=1&skip_disambig=1`,
        { signal }
      ),
    12000
  );

  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}`);
  }

  const data = await response.json();
  const candidates = [];

  if (data.AbstractText) {
    candidates.push({
      title: data.Heading || 'DuckDuckGo Summary',
      snippet: data.AbstractText,
      url: data.AbstractURL || '',
      query: safeQuery,
      source: 'duckduckgo_abstract',
    });
  }

  const related = flattenRelatedTopics(data.RelatedTopics || [], safeQuery);
  candidates.push(...related.slice(0, 8));
  return candidates;
};

const fetchVertexGroundedCandidates = async ({ query, topic }) => {
  const safeQuery = String(query || '').trim();
  if (!safeQuery) return [];

  if (!hasUsableAIConfig()) return [];

  try {
    const responseText = await callOpenRouter({
      messages: [
        {
          role: 'system',
          content: 'You are a curriculum research assistant. Provide concise, high-quality factual evidence for university-level teaching. Be accurate and cite sources when possible.',
        },
        {
          role: 'user',
          content: `Topic: ${topic}\nSearch query: ${safeQuery}\nProvide concise factual evidence.`,
        },
      ],
      temperature: 0.3,
      timeoutMs: 30000,
    });

    const fullText = String(responseText || '').trim();
    if (!fullText) return [];

    return [{
      title: `Research for ${safeQuery}`,
      snippet: fullText.slice(0, RESEARCH_SNIPPET_MAX_CHARS),
      url: '',
      query: safeQuery,
      source: 'openrouter_research',
    }];
  } catch (err) {
    console.warn(`Research generation failed for query "${safeQuery}"`, err?.message || err);
    return [];
  }
};

const normalizeResearchEvidence = (candidate, context) => {
  const safeTitle = String(candidate?.title || '').trim();
  const safeUrl = String(candidate?.url || '').trim();
  const safeDomain = extractDomainFromUrl(safeUrl);
  const rawSnippet = String(candidate?.snippet || '');
  const normalizedRawSnippet = rawSnippet.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const sanitizedSnippet = stripUnsafeSnippetText(rawSnippet);
  const query = String(candidate?.query || '').trim();

  if (!safeTitle && !sanitizedSnippet) {
    return null;
  }

  if (normalizedRawSnippet && sanitizedSnippet !== normalizedRawSnippet && Array.isArray(context?.warnings)) {
    const isInstructionLike = INJECTION_LINE_PATTERNS.some((pattern) => pattern.test(normalizedRawSnippet));
    const warning = isInstructionLike
      ? `Sanitized instruction-like web snippet content from ${safeDomain || safeUrl || 'unknown source'}.`
      : `Sanitized noisy web snippet content from ${safeDomain || safeUrl || 'unknown source'}.`;
    if (!context.warnings.includes(warning)) {
      context.warnings.push(warning);
    }
  }

  const publishedAt = inferPublishedAt(`${safeTitle} ${sanitizedSnippet}`, safeUrl);
  const queryTokens = tokenizeForResearch(query);
  const topicTokens = tokenizeForResearch(context.topic);
  const referenceTokens = tokenizeForResearch(context.teacherReference).slice(0, 20);
  const evidenceTokens = tokenizeForResearch(`${safeTitle} ${sanitizedSnippet}`);

  const topicMatch = computeTokenOverlapScore(evidenceTokens, [...topicTokens, ...referenceTokens]);
  const queryMatch = computeTokenOverlapScore(evidenceTokens, queryTokens);
  const trustScore = getDomainTrustScore(safeDomain);
  const recencyScore = getRecencyScore(publishedAt, context.recencySensitive);
  const snippetQuality = getSnippetQualityScore(sanitizedSnippet);

  const score = clampNumber(
    (0.34 * trustScore) +
    (0.26 * topicMatch) +
    (0.2 * queryMatch) +
    (0.12 * recencyScore) +
    (0.08 * snippetQuality),
    0,
    1
  );

  const idSeed = `${safeUrl}|${safeTitle}|${sanitizedSnippet}`;
  const id = `R${crypto.createHash('sha1').update(idSeed).digest('hex').slice(0, 10)}`;

  return {
    id,
    title: safeTitle || 'Untitled source',
    url: safeUrl,
    snippet: sanitizedSnippet,
    publishedAt,
    confidence: score,
    score,
    sectionHints: [],
    domain: safeDomain,
    query,
    source: String(candidate?.source || 'web'),
    retrievedAt: new Date().toISOString(),
  };
};

const dedupeEvidenceByIdentity = (evidence = []) => {
  const deduped = [];
  const byKey = new Map();

  evidence.forEach((entry) => {
    if (!entry) return;
    const key = entry.url || `${entry.title}|${entry.snippet}`;
    if (!key) return;

    const existing = byKey.get(key);
    if (!existing || (entry.score || 0) > (existing.score || 0)) {
      byKey.set(key, entry);
    }
  });

  byKey.forEach((value) => deduped.push(value));
  return deduped;
};

const rankResearchEvidence = (evidence = []) =>
  [...evidence].sort((a, b) => {
    const scoreDiff = (Number(b?.score) || 0) - (Number(a?.score) || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a?.title || '').localeCompare(String(b?.title || ''));
  });

const getMemoryCachedResearchBundle = (cacheKey) => {
  const entry = memoryResearchCache.get(cacheKey);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    memoryResearchCache.delete(cacheKey);
    return null;
  }

  return JSON.parse(JSON.stringify(entry.bundle));
};

const setMemoryCachedResearchBundle = (cacheKey, bundle, ttlSeconds = RESEARCH_CACHE_TTL_SECONDS) => {
  memoryResearchCache.set(cacheKey, {
    expiresAt: Date.now() + ttlSeconds * 1000,
    bundle: JSON.parse(JSON.stringify(bundle)),
  });
};

const getResearchRedisClient = async () => {
  const redisUrl = String(process.env.REDIS_URL || '').trim();
  if (!redisUrl) return null;

  if (researchRedisClient?.isOpen) {
    return researchRedisClient;
  }

  if (researchRedisInitPromise) {
    return researchRedisInitPromise;
  }

  researchRedisInitPromise = (async () => {
    try {
      const client = createClient({ url: redisUrl });
      client.on('error', (error) => {
        console.warn('Research cache Redis client error:', error?.message || error);
      });
      await client.connect();
      researchRedisClient = client;
      return client;
    } catch (err) {
      console.warn('Research cache Redis unavailable. Falling back to memory cache only.', err?.message || err);
      researchRedisClient = null;
      return null;
    } finally {
      researchRedisInitPromise = null;
    }
  })();

  return researchRedisInitPromise;
};

const buildResearchCacheKey = ({
  topic,
  teacherReference,
  durationMinutes,
  interactivityLevel,
  structurePlan,
}) => {
  const sectionSignatures = Array.isArray(structurePlan?.sections)
    ? structurePlan.sections.map((section) =>
      `${section.id}|${section.title}|${section.goal}|${(section.keyPoints || []).join(',')}`
    ).join('||')
    : 'no-sections';

  const raw = [
    String(topic || '').trim().toLowerCase(),
    String(teacherReference || '').trim().toLowerCase(),
    String(durationMinutes || ''),
    String(interactivityLevel || ''),
    sectionSignatures,
  ].join('::');

  return crypto.createHash('sha256').update(raw).digest('hex');
};

const getCachedResearchBundle = async (cacheKey) => {
  const memoryHit = getMemoryCachedResearchBundle(cacheKey);
  if (memoryHit) {
    memoryHit.cache = {
      cacheHit: true,
      cacheSource: 'memory',
      generatedAt: memoryHit?.cache?.generatedAt || new Date().toISOString(),
    };
    return memoryHit;
  }

  const client = await getResearchRedisClient();
  if (!client) return null;

  try {
    const payload = await client.get(`${RESEARCH_CACHE_KEY_PREFIX}${cacheKey}`);
    if (!payload) return null;

    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return null;

    setMemoryCachedResearchBundle(cacheKey, parsed);
    parsed.cache = {
      cacheHit: true,
      cacheSource: 'redis',
      generatedAt: parsed?.cache?.generatedAt || new Date().toISOString(),
    };
    return parsed;
  } catch (err) {
    console.warn('Failed to read research cache from Redis:', err?.message || err);
    return null;
  }
};

const setCachedResearchBundle = async (cacheKey, bundle) => {
  setMemoryCachedResearchBundle(cacheKey, bundle);

  const client = await getResearchRedisClient();
  if (!client) return;

  try {
    await client.set(
      `${RESEARCH_CACHE_KEY_PREFIX}${cacheKey}`,
      JSON.stringify(bundle),
      { EX: RESEARCH_CACHE_TTL_SECONDS }
    );
  } catch (err) {
    console.warn('Failed to write research cache to Redis:', err?.message || err);
  }
};

const extractReferenceKeywords = (reference, maxKeywords = 6) => {
  const tokens = tokenizeForResearch(reference);
  if (tokens.length === 0) return [];

  const counts = new Map();
  tokens.forEach((token) => {
    counts.set(token, (counts.get(token) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([token]) => token);
};

const MARKDOWN_IMAGE_TOKEN_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const VISUAL_PLACEHOLDER_RE = /^VISUAL:([A-Za-z0-9_-]+)$/i;
const SAFE_MARKDOWN_IMAGE_HTTP_RE = /^https:\/\/[^\s)]+$/i;
const SAFE_MARKDOWN_IMAGE_DATA_RE = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i;
const WIKIMEDIA_FILE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|avif)$/i;
const WIKIMEDIA_LOW_VALUE_TERMS = [
  'book cover',
  'cover',
  'dust jacket',
  'frontispiece',
  'front cover',
  'back cover',
  'title page',
  'spine',
  'library of congress',
  'university library',
  'scan of',
];

const isSafeMarkdownImageUrl = (url, options = {}) => {
  const safeUrl = String(url || '').trim();
  const allowHttpImageUrls = options?.allowHttpImageUrls !== false;
  if (!safeUrl) return false;
  if (VISUAL_PLACEHOLDER_RE.test(safeUrl)) return Boolean(options.allowVisualPlaceholders);
  if (SAFE_MARKDOWN_IMAGE_HTTP_RE.test(safeUrl)) return allowHttpImageUrls;
  if (SAFE_MARKDOWN_IMAGE_DATA_RE.test(safeUrl)) return true;
  return false;
};

const sanitizeMarkdownImageLinks = (rawText, options = {}) => {
  const warnings = [];
  const text = String(rawText || '');
  if (!text.trim()) {
    return { text, warnings };
  }

  const sanitized = text.replace(MARKDOWN_IMAGE_TOKEN_RE, (full, rawAlt, rawUrl) => {
    const alt = String(rawAlt || '').trim();
    const url = String(rawUrl || '').trim();
    if (!url) {
      warnings.push('Removed an image markdown token with an empty URL.');
      return '';
    }
    if (!isSafeMarkdownImageUrl(url, options)) {
      warnings.push(`Removed unsafe image URL: ${url.slice(0, 96)}`);
      return '';
    }
    return `![${alt}](${url})`;
  });

  return {
    text: sanitized.replace(/\n{3,}/g, '\n\n').trim(),
    warnings,
  };
};

const toImageDataUrl = (mimeType, base64) => `data:${mimeType};base64,${base64}`;

const toVisualSafeAlt = (value, fallback = 'Lesson visual') => {
  const cleaned = String(value || '')
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
};

const isTeacherVisual = (visual) => String(visual?.origin || '').startsWith('teacher_');

const getVisualPriorityScore = (visual) => {
  const origin = String(visual?.origin || '');
  if (origin === 'teacher_pdf_snapshot') return 3;
  if (origin === 'teacher_upload') return 2;
  if (origin === 'wikimedia_commons') return 1;
  return 0;
};

const countMarkdownImages = (value) => (String(value || '').match(/!\[[^\]]*\]\(([^)]+)\)/g) || []).length;

const buildVisualSnippetMarkdown = (visual, altOverride = '') => {
  const safeUrl = String(visual?.url || '').trim();
  if (!isSafeMarkdownImageUrl(safeUrl, { allowHttpImageUrls: false })) {
    return '';
  }

  const alt = String(altOverride || visual?.alt || visual?.title || 'Lesson visual').trim() || 'Lesson visual';
  const imageMarkdown = `![${alt}](${safeUrl})`;

  if (visual?.attributionMarkdown) {
    return `${imageMarkdown}\n\n${visual.attributionMarkdown}`;
  }
  return imageMarkdown;
};

const isLikelyLowValueWikimediaImage = (candidate) => {
  const haystack = `${candidate?.title || ''} ${candidate?.alt || ''} ${candidate?.relevanceText || ''}`.toLowerCase();
  if (!haystack.trim()) return true;
  return WIKIMEDIA_LOW_VALUE_TERMS.some((term) => haystack.includes(term));
};

const buildTeacherVisualCatalog = (referenceImages = []) => {
  const warnings = [];
  const visuals = [];
  const safeReferenceImages = Array.isArray(referenceImages) ? referenceImages : [];

  safeReferenceImages.forEach((image, index) => {
    const mimeType = String(image?.mimeType || '').toLowerCase().trim();
    const base64 = String(image?.base64 || '').replace(/\s+/g, '');
    if (!mimeType.startsWith('image/') || !base64) return;

    const url = toImageDataUrl(mimeType, base64);
    if (!isSafeMarkdownImageUrl(url)) {
      warnings.push(`Skipped "${image?.name || `teacher-image-${index + 1}`}" because it could not be sanitized.`);
      return;
    }

    const source = image?.source === 'pdf_snapshot' ? 'teacher_pdf_snapshot' : 'teacher_upload';
    const sourcePage = Number.isFinite(Number(image?.sourcePage))
      ? Math.max(1, Math.floor(Number(image.sourcePage)))
      : null;
    const sourceFile = String(image?.sourceFile || '').trim();

    const sourceLabel =
      source === 'teacher_pdf_snapshot'
        ? `Teacher PDF snapshot${sourceFile ? ` (${sourceFile}${sourcePage ? `, page ${sourcePage}` : ''})` : ''}`
        : 'Teacher uploaded image';

    visuals.push({
      id: `T${index + 1}`,
      origin: source,
      title: String(image?.name || `teacher-image-${index + 1}`),
      alt: toVisualSafeAlt(image?.name, sourceLabel),
      url,
      license: 'Teacher provided',
      author: 'Teacher upload',
      sourcePageUrl: '',
      attributionMarkdown: source === 'teacher_pdf_snapshot' && sourceFile
        ? `*Image source: Teacher PDF snapshot (${sourceFile}${sourcePage ? `, page ${sourcePage}` : ''}).*`
        : '',
      sectionHints: [],
      relevanceText: `${image?.name || ''} ${sourceLabel}`,
    });
  });

  return { visuals, warnings };
};

const parseWikimediaExtMetadataText = (extMetadata, key) => {
  const value = String(extMetadata?.[key]?.value || '');
  if (!value) return '';
  return normalizeReferenceWhitespace(decodeBasicHtmlEntities(value.replace(/<[^>]*>/g, ' ')));
};

const isLikelyAllowedWikimediaLicense = (licenseText) => {
  const normalized = String(licenseText || '').toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('creative commons') ||
    normalized.includes('cc by') ||
    normalized.includes('cc-by') ||
    normalized.includes('public domain') ||
    normalized.includes('gfdl') ||
    normalized.includes('free art')
  );
};

const buildWikimediaImageQueries = ({ topic, structurePlan, teacherReference }) => {
  const safeTopic = String(topic || '').trim();
  const keywords = extractReferenceKeywords(teacherReference, 4);
  const queries = new Set();

  queries.add(`${safeTopic} educational diagram`);
  queries.add(`${safeTopic} educational illustration`);

  if (keywords.length > 0) {
    queries.add(`${safeTopic} ${keywords.join(' ')} infographic`);
  }

  if (Array.isArray(structurePlan?.sections)) {
    structurePlan.sections.slice(0, 3).forEach((section) => {
      const label = normalizeReferenceHeading(section?.title || section?.goal || '');
      if (label) {
        queries.add(`${safeTopic} ${label} educational image`);
      }
    });
  }

  return [...queries].slice(0, WIKIMEDIA_MAX_QUERIES);
};

const fetchWikimediaImageCandidatesForQuery = async (query) => {
  const safeQuery = String(query || '').trim();
  if (!safeQuery) return [];

  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('origin', '*');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrnamespace', '6');
  url.searchParams.set('gsrsearch', safeQuery);
  url.searchParams.set('gsrlimit', String(WIKIMEDIA_MAX_RESULTS_PER_QUERY));
  url.searchParams.set('prop', 'imageinfo|info');
  url.searchParams.set('iiprop', 'url|extmetadata|size');
  url.searchParams.set('iiurlwidth', '1400');
  url.searchParams.set('inprop', 'url');

  const response = await runWithTimeout(
    (signal) =>
      fetch(url.toString(), {
        method: 'GET',
        signal,
      }),
    12000
  );

  if (!response.ok) {
    throw new Error(`Wikimedia image search failed with status ${response.status}`);
  }

  const payload = await response.json();
  const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];

  return pages
    .map((page) => {
      const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
      if (!info) return null;

      const fileTitle = String(page?.title || '').replace(/^File:/i, '').trim();
      const imageUrl = String(info.thumburl || info.url || '').trim();
      const sourcePageUrl = String(info.descriptionurl || page?.fullurl || '').trim();
      const extMetadata = info?.extmetadata || {};
      const license = parseWikimediaExtMetadataText(extMetadata, 'LicenseShortName') ||
        parseWikimediaExtMetadataText(extMetadata, 'UsageTerms');
      const author = parseWikimediaExtMetadataText(extMetadata, 'Artist') ||
        parseWikimediaExtMetadataText(extMetadata, 'Credit') ||
        'Unknown author';
      const imageDescription = parseWikimediaExtMetadataText(extMetadata, 'ImageDescription') ||
        parseWikimediaExtMetadataText(extMetadata, 'ObjectName');

      if (!imageUrl || !sourcePageUrl) return null;
      if (!isSafeMarkdownImageUrl(imageUrl)) return null;
      if (!WIKIMEDIA_FILE_EXTENSION_RE.test(fileTitle) && !WIKIMEDIA_FILE_EXTENSION_RE.test(imageUrl)) return null;
      if (!isLikelyAllowedWikimediaLicense(license)) return null;

      const relevanceText = `${fileTitle} ${imageDescription} ${safeQuery}`;
      const queryTokens = tokenizeForResearch(safeQuery);
      const relevanceTokens = tokenizeForResearch(relevanceText);
      const overlap = computeTokenOverlapScore(relevanceTokens, queryTokens);
      const candidate = {
        id: `W-${crypto.createHash('sha1').update(imageUrl).digest('hex').slice(0, 10)}`,
        origin: 'wikimedia_commons',
        title: fileTitle || 'Wikimedia image',
        alt: toVisualSafeAlt(imageDescription || fileTitle, 'Wikimedia visual'),
        url: imageUrl,
        license: license || 'See source page',
        author: author || 'Unknown author',
        sourcePageUrl,
        attributionMarkdown: `*Image credit: ${author || 'Unknown author'} | License: ${license || 'See source page'} | [Wikimedia Commons](${sourcePageUrl}).*`,
        sectionHints: [],
        relevanceText,
        score: overlap,
        query: safeQuery,
      };
      if (isLikelyLowValueWikimediaImage(candidate)) {
        return null;
      }

      return candidate;
    })
    .filter(Boolean);
};

const collectWikimediaVisualCatalog = async ({ topic, structurePlan, teacherReference }) => {
  const warnings = [];
  const queries = buildWikimediaImageQueries({ topic, structurePlan, teacherReference });
  if (queries.length === 0) {
    return { visuals: [], warnings };
  }

  const nested = await Promise.all(
    queries.map(async (query) => {
      try {
        return await fetchWikimediaImageCandidatesForQuery(query);
      } catch (err) {
        warnings.push(`Wikimedia search failed for query "${query}": ${err?.message || err}`);
        return [];
      }
    })
  );

  const all = nested.flat();
  const deduped = [];
  const byUrl = new Map();

  all.forEach((item) => {
    const key = item?.url;
    if (!key) return;
    const existing = byUrl.get(key);
    if (!existing || (Number(item?.score) || 0) > (Number(existing?.score) || 0)) {
      byUrl.set(key, item);
    }
  });

  byUrl.forEach((value) => deduped.push(value));

  const ranked = deduped
    .sort((a, b) => (Number(b?.score) || 0) - (Number(a?.score) || 0))
    .slice(0, WIKIMEDIA_MAX_SELECTED_VISUALS)
    .map((item, index) => ({
      ...item,
      id: `W${index + 1}`,
    }));

  return { visuals: ranked, warnings };
};

const mapVisualsToSections = (visuals = [], structurePlan) => {
  const mapping = {};
  const safeVisuals = Array.isArray(visuals) ? visuals : [];
  const sections = Array.isArray(structurePlan?.sections) ? structurePlan.sections : [];
  if (sections.length === 0 || safeVisuals.length === 0) {
    return mapping;
  }

  const visualsById = new Map(safeVisuals.map((visual) => [String(visual.id || ''), visual]));
  const teacherVisuals = safeVisuals
    .filter((visual) => isTeacherVisual(visual))
    .sort((a, b) => {
      const pageA = Number(a?.sourcePage) || Number.MAX_SAFE_INTEGER;
      const pageB = Number(b?.sourcePage) || Number.MAX_SAFE_INTEGER;
      return pageA - pageB;
    });
  const sectionPrefill = new Map(sections.map((section) => [section.id, []]));

  teacherVisuals.forEach((visual, index) => {
    const section = sections[index % sections.length];
    if (!section) return;
    const bucket = sectionPrefill.get(section.id);
    if (!Array.isArray(bucket) || bucket.length >= MAX_VISUALS_PER_SECTION) return;
    bucket.push(String(visual.id));
  });

  sections.forEach((section) => {
    const preSelected = Array.isArray(sectionPrefill.get(section.id))
      ? [...sectionPrefill.get(section.id)]
      : [];
    const selectedSet = new Set(preSelected);
    const sectionTokens = tokenizeForResearch(
      `${section?.title || ''} ${section?.goal || ''} ${(section?.keyPoints || []).join(' ')}`
    );

    const ranked = safeVisuals
      .map((visual) => {
        const relevanceTokens = tokenizeForResearch(
          `${visual?.title || ''} ${visual?.alt || ''} ${visual?.relevanceText || ''}`
        );
        const overlap = computeTokenOverlapScore(relevanceTokens, sectionTokens);
        const teacherBoost = isTeacherVisual(visual) ? 1.2 : 0;
        return {
          visual,
          score: overlap + teacherBoost,
        };
      })
      .sort((a, b) => b.score - a.score);

    const selected = ranked
      .filter((entry) => !selectedSet.has(String(entry.visual?.id || '')))
      .slice(0, Math.max(0, MAX_VISUALS_PER_SECTION - preSelected.length))
      .map((entry) => entry.visual.id)
      .filter(Boolean);

    const finalSelected = [...preSelected, ...selected].slice(0, MAX_VISUALS_PER_SECTION);
    mapping[section.id] = finalSelected;
    finalSelected.forEach((visualId) => {
      const target = visualsById.get(String(visualId));
      if (!target) return;
      if (!Array.isArray(target.sectionHints)) {
        target.sectionHints = [];
      }
      if (!target.sectionHints.includes(section.id)) {
        target.sectionHints.push(section.id);
      }
    });
  });

  return mapping;
};

const formatVisualCatalogForPrompt = (visuals = [], maxItems = 12) => {
  const safeVisuals = (Array.isArray(visuals) ? visuals : []).slice(0, maxItems);
  if (safeVisuals.length === 0) {
    return 'No visual assets are available.';
  }

  return safeVisuals
    .map((visual) => {
      const sourceLabel = visual.origin === 'wikimedia_commons' ? 'Wikimedia Commons' : 'Teacher-provided';
      return `[${visual.id}] ${visual.alt || visual.title} | Source: ${sourceLabel} | URL token: VISUAL:${visual.id}`;
    })
    .join('\n');
};

const buildSectionVisualPromptMap = (visualCatalog = [], structurePlan, sectionVisualMapping = {}) => {
  const result = {};
  const visualsById = new Map((visualCatalog || []).map((visual) => [visual.id, visual]));

  (structurePlan?.sections || []).forEach((section) => {
    const visualIds = Array.isArray(sectionVisualMapping?.[section.id]) ? sectionVisualMapping[section.id] : [];
    const visuals = visualIds.map((id) => visualsById.get(id)).filter(Boolean);
    result[section.id] = formatVisualCatalogForPrompt(visuals, MAX_VISUALS_PER_SECTION);
  });

  return result;
};

const applyVisualPlaceholdersToLesson = ({ lessonData, visualCatalog = [] }) => {
  const warnings = [];
  const visualById = new Map((visualCatalog || []).map((visual) => [String(visual.id), visual]));
  const usedVisualIds = new Set();
  const attributionById = new Map();
  const trackAttribution = (visualId, visual) => {
    const key = String(visualId || '');
    if (!key || !visual?.attributionMarkdown || attributionById.has(key)) return;
    attributionById.set(key, {
      id: key,
      attribution: visual.attributionMarkdown,
      sourcePageUrl: visual.sourcePageUrl || '',
      license: visual.license || '',
      author: visual.author || '',
    });
  };

  if (!Array.isArray(lessonData?.blocks)) {
    return { lessonData, warnings, usedVisualIds: [], attributions: [] };
  }

  lessonData.blocks = lessonData.blocks.map((block, index) => {
    if (block?.type !== 'TEXT' || typeof block?.content !== 'string') {
      return block;
    }

    let nextContent = block.content.replace(MARKDOWN_IMAGE_TOKEN_RE, (full, rawAlt, rawUrl) => {
      const urlText = String(rawUrl || '').trim();
      const placeholderMatch = urlText.match(VISUAL_PLACEHOLDER_RE);
      if (!placeholderMatch) {
        return full;
      }

      const visualId = placeholderMatch[1];
      const visual = visualById.get(visualId);
      if (!visual) {
        warnings.push(`Removed unresolved visual placeholder "${visualId}" in TEXT block ${index + 1}.`);
        return '';
      }
      if (!isTeacherVisual(visual)) {
        warnings.push(`Removed non-teacher visual placeholder "${visualId}" from TEXT block ${index + 1}.`);
        return '';
      }

      const safeUrl = String(visual.url || '').trim();
      if (!isSafeMarkdownImageUrl(safeUrl, { allowHttpImageUrls: false })) {
        warnings.push(`Removed visual "${visualId}" because its URL could not be sanitized.`);
        return '';
      }

      const alt = String(rawAlt || '').trim() || visual.alt || visual.title || 'Lesson visual';
      usedVisualIds.add(visualId);
      trackAttribution(visualId, visual);

      const imageMarkdown = `![${alt}](${safeUrl})`;
      if (visual.attributionMarkdown) {
        return `${imageMarkdown}\n\n${visual.attributionMarkdown}`;
      }
      return imageMarkdown;
    });

    const sanitized = sanitizeMarkdownImageLinks(nextContent, {
      allowVisualPlaceholders: false,
      allowHttpImageUrls: false,
    });
    if (sanitized.warnings.length > 0) {
      warnings.push(
        ...sanitized.warnings.map((message) => `TEXT block ${index + 1}: ${message}`)
      );
    }
    nextContent = sanitized.text;

    return {
      ...block,
      content: nextContent,
    };
  });

  const textBlockIndexes = lessonData.blocks
    .map((block, index) => (block?.type === 'TEXT' && typeof block?.content === 'string' ? index : -1))
    .filter((index) => index >= 0);

  if (textBlockIndexes.length > 0) {
    const remainingTeacherVisuals = (visualCatalog || [])
      .filter((visual) => isTeacherVisual(visual) && !usedVisualIds.has(String(visual?.id || '')))
      .sort((a, b) => {
        const priorityDiff = getVisualPriorityScore(b) - getVisualPriorityScore(a);
        if (priorityDiff !== 0) return priorityDiff;
        const pageA = Number(a?.sourcePage) || Number.MAX_SAFE_INTEGER;
        const pageB = Number(b?.sourcePage) || Number.MAX_SAFE_INTEGER;
        return pageA - pageB;
      });

    let cursor = 0;
    remainingTeacherVisuals.forEach((visual) => {
      if (!visual?.id) return;
      const snippet = buildVisualSnippetMarkdown(visual);
      if (!snippet) {
        warnings.push(`Skipped teacher visual "${visual.id}" because its URL was unsafe.`);
        return;
      }

      let placed = false;
      for (let attempt = 0; attempt < textBlockIndexes.length; attempt += 1) {
        const blockIndex = textBlockIndexes[cursor % textBlockIndexes.length];
        cursor += 1;
        const currentBlock = lessonData.blocks[blockIndex];
        if (!currentBlock || currentBlock.type !== 'TEXT') continue;

        const currentImageCount = countMarkdownImages(currentBlock.content);
        if (currentImageCount >= MAX_VISUALS_PER_SECTION) {
          continue;
        }

        const merged = [String(currentBlock.content || '').trim(), snippet].filter(Boolean).join('\n\n');
        const sanitized = sanitizeMarkdownImageLinks(merged, {
          allowVisualPlaceholders: false,
          allowHttpImageUrls: false,
        });
        if (!sanitized.text) {
          warnings.push(`Could not inject teacher visual "${visual.id}" into TEXT block ${blockIndex + 1}.`);
          continue;
        }

        lessonData.blocks[blockIndex] = {
          ...currentBlock,
          content: sanitized.text,
        };
        usedVisualIds.add(String(visual.id));
        trackAttribution(visual.id, visual);
        placed = true;
        break;
      }

      if (!placed) {
        warnings.push(`Teacher visual "${visual.id}" could not be placed because all TEXT blocks reached visual capacity.`);
      }
    });
  }

  return {
    lessonData,
    warnings,
    usedVisualIds: [...usedVisualIds],
    attributions: [...attributionById.values()],
  };
};

const buildResearchQueries = ({
  topic,
  teacherReference,
  structurePlan,
  recencySensitive,
}) => {
  const safeTopic = String(topic || '').trim();
  const keywords = extractReferenceKeywords(teacherReference, 6);
  const querySet = new Set();

  querySet.add(`${safeTopic} core concepts explanation university level`);
  querySet.add(`${safeTopic} official documentation standard reference`);

  if (keywords.length > 0) {
    querySet.add(`${safeTopic} ${keywords.slice(0, 4).join(' ')} worked example`);
  }

  if (recencySensitive) {
    querySet.add(`${safeTopic} latest developments current best practices`);
  } else {
    querySet.add(`${safeTopic} benchmark complexity case study`);
  }

  if (Array.isArray(structurePlan?.sections) && structurePlan.sections.length > 0) {
    structurePlan.sections
      .slice(0, RESEARCH_SECTION_QUERY_COUNT)
      .forEach((section) => {
        const sectionLabel = [section.title, section.goal].filter(Boolean).join(' ');
        if (sectionLabel.trim()) {
          querySet.add(`${safeTopic} ${sectionLabel} reference material`);
        }
      });
  }

  return [...querySet].slice(0, RESEARCH_MAX_QUERIES);
};

const isEvidencePoolLowQuality = (evidence = []) => {
  if (!Array.isArray(evidence) || evidence.length < 3) return true;
  const avg =
    evidence.reduce((sum, item) => sum + (Number(item?.confidence) || 0), 0) / Math.max(1, evidence.length);
  return avg < RESEARCH_MIN_CONFIDENCE;
};

const mapEvidenceToSections = (evidence = [], structurePlan) => {
  const mapping = {};
  if (!Array.isArray(structurePlan?.sections) || structurePlan.sections.length === 0) {
    return mapping;
  }

  const allEvidence = Array.isArray(evidence) ? evidence : [];

  structurePlan.sections.forEach((section) => {
    const sectionTokens = tokenizeForResearch(
      `${section.title || ''} ${section.goal || ''} ${(section.keyPoints || []).join(' ')}`
    );

    const ranked = [...allEvidence]
      .map((entry) => ({
        entry,
        relevance: computeTokenOverlapScore(
          tokenizeForResearch(`${entry.title} ${entry.snippet}`),
          sectionTokens
        ),
      }))
      .sort((a, b) => {
        const relDiff = b.relevance - a.relevance;
        if (relDiff !== 0) return relDiff;
        return (b.entry?.score || 0) - (a.entry?.score || 0);
      });

    const chosen = ranked
      .filter((item) => item.relevance > 0.02)
      .slice(0, RESEARCH_MAX_SECTION_EVIDENCE)
      .map((item) => item.entry.id);

    if (chosen.length === 0) {
      mapping[section.id] = allEvidence.slice(0, Math.min(2, RESEARCH_MAX_SECTION_EVIDENCE)).map((entry) => entry.id);
    } else {
      mapping[section.id] = chosen;
    }
  });

  const hintMap = new Map(allEvidence.map((entry) => [entry.id, entry]));
  Object.entries(mapping).forEach(([sectionId, evidenceIds]) => {
    evidenceIds.forEach((evidenceId) => {
      const target = hintMap.get(evidenceId);
      if (!target) return;
      if (!Array.isArray(target.sectionHints)) {
        target.sectionHints = [];
      }
      if (!target.sectionHints.includes(sectionId)) {
        target.sectionHints.push(sectionId);
      }
    });
  });

  return mapping;
};

const formatResearchEvidenceForPrompt = ({ evidence = [], maxChars = RESEARCH_GLOBAL_PROMPT_MAX_CHARS }) => {
  const lines = [];
  let used = 0;

  evidence.forEach((entry) => {
    const line = `[${entry.id}] ${entry.title} (${entry.domain || 'unknown domain'})\nURL: ${entry.url || 'n/a'}\nEvidence: ${entry.snippet || 'n/a'}${entry.publishedAt ? `\nPublished: ${entry.publishedAt.slice(0, 10)}` : ''}`;
    if (used + line.length > maxChars) {
      return;
    }
    lines.push(line);
    used += line.length + 2;
  });

  if (lines.length === 0) {
    return 'No high-confidence web evidence was retrieved.';
  }

  return lines.join('\n\n');
};

const formatResearchSummaryForPrompt = ({ evidence = [], maxChars = 1800 }) => {
  const lines = [];
  let used = 0;

  evidence.forEach((entry) => {
    const confidence = Number(entry?.confidence);
    const confidenceLabel = Number.isFinite(confidence) ? confidence.toFixed(2) : 'n/a';
    const line = `[${entry.id}] ${entry.title} | domain: ${entry.domain || 'unknown'} | confidence: ${confidenceLabel}${entry.publishedAt ? ` | published: ${entry.publishedAt.slice(0, 10)}` : ''}`;
    if (used + line.length > maxChars) {
      return;
    }
    lines.push(line);
    used += line.length + 1;
  });

  if (lines.length === 0) {
    return 'No high-confidence web evidence summary is available.';
  }

  return lines.join('\n');
};

const formatResearchTagsForPrompt = (evidence = [], maxItems = 10) => {
  const tags = (Array.isArray(evidence) ? evidence : [])
    .slice(0, maxItems)
    .map((entry) => `[${entry.id}] ${entry.title} (${entry.domain || 'unknown domain'})`);

  if (tags.length === 0) {
    return 'No high-confidence evidence tags available.';
  }

  return tags.join('\n');
};

const buildSectionResearchPromptMap = (researchBundle, structurePlan) => {
  const result = {};
  const evidenceById = new Map((researchBundle?.evidence || []).map((entry) => [entry.id, entry]));
  const mapping = researchBundle?.sectionEvidence || {};

  (structurePlan?.sections || []).forEach((section) => {
    const sectionEvidence = (mapping[section.id] || [])
      .map((id) => evidenceById.get(id))
      .filter(Boolean);

    result[section.id] = formatResearchEvidenceForPrompt({
      evidence: sectionEvidence,
      maxChars: RESEARCH_SECTION_PROMPT_MAX_CHARS,
    });
  });

  return result;
};

const buildResearchUsageBySection = (researchBundle, structurePlan) => {
  const usage = {};
  const mapping = researchBundle?.sectionEvidence || {};
  (structurePlan?.sections || []).forEach((section) => {
    usage[section.id] = Array.isArray(mapping[section.id]) ? mapping[section.id] : [];
  });
  return usage;
};

const compactResearchSources = (researchBundle) =>
  (researchBundle?.evidence || []).map((entry) => ({
    id: entry.id,
    title: entry.title,
    url: entry.url,
    domain: entry.domain,
    publishedAt: entry.publishedAt,
    confidence: entry.confidence,
  }));

const buildEmptyResearchBundle = (warningMessage = '') => {
  const warnings = warningMessage ? [warningMessage] : [];
  return {
    evidence: [],
    sectionEvidence: {},
    warnings,
    cache: {
      cacheHit: false,
      cacheSource: 'disabled',
      generatedAt: new Date().toISOString(),
    },
  };
};

const buildResearchBundle = async ({
  topic,
  teacherReference,
  durationMinutes,
  interactivityLevel,
  structurePlan = null,
  seedBundle = null,
}) => {
  const recencySensitive = isRecencySensitiveTopic(topic, teacherReference);
  const cacheKey = buildResearchCacheKey({
    topic,
    teacherReference,
    durationMinutes,
    interactivityLevel,
    structurePlan,
  });

  const cachedBundle = await getCachedResearchBundle(cacheKey);
  if (cachedBundle) {
    return cachedBundle;
  }

  const queries = buildResearchQueries({
    topic,
    teacherReference,
    structurePlan,
    recencySensitive,
  });

  const warnings = [];
  const context = { topic, teacherReference, recencySensitive, warnings };

  // Primary retrieval: Vertex AI Grounded Search
  const vertexAvailable = hasUsableAIConfig();
  let vertexCandidatesNested = [];
  if (vertexAvailable) {
    vertexCandidatesNested = await Promise.all(
      queries.map(async (query) => {
        try {
          return await fetchVertexGroundedCandidates({ query, topic });
        } catch (err) {
          warnings.push(`AI research failed for query "${query}": ${err?.message || err}`);
          return [];
        }
      })
    );
  } else {
    warnings.push('AI not configured; skipping primary research retrieval.');
  }

  const vertexCandidates = vertexCandidatesNested.flat();

  let normalized = vertexCandidates
    .map((candidate) => normalizeResearchEvidence(candidate, context))
    .filter(Boolean);

  if (Array.isArray(seedBundle?.evidence)) {
    normalized.push(...seedBundle.evidence);
  }

  normalized = dedupeEvidenceByIdentity(normalized);
  let ranked = rankResearchEvidence(normalized);

  // Fallback retrieval: DuckDuckGo Instant Answer API (only when primary is low quality or unavailable)
  if (isEvidencePoolLowQuality(ranked)) {
    const ddgCandidatesNested = await Promise.all(
      queries.map(async (query) => {
        try {
          return await fetchDuckDuckGoCandidates(query);
        } catch (err) {
          warnings.push(`DuckDuckGo fallback search failed for query "${query}": ${err?.message || err}`);
          return [];
        }
      })
    );

    const ddgCandidates = ddgCandidatesNested.flat();
    if (ddgCandidates.length > 0) {
      warnings.push('Primary AI retrieval quality was low; merged DuckDuckGo fallback evidence.');
      const merged = dedupeEvidenceByIdentity([
        ...ranked,
        ...ddgCandidates
          .map((candidate) => normalizeResearchEvidence(candidate, context))
          .filter(Boolean),
      ]);
      ranked = rankResearchEvidence(merged);
    } else {
      warnings.push('Primary retrieval quality was low and DuckDuckGo fallback returned no additional evidence.');
    }
  }

  const evidence = ranked.slice(0, RESEARCH_MAX_GLOBAL_EVIDENCE);
  const sectionEvidence = mapEvidenceToSections(evidence, structurePlan);

  const bundle = {
    topic,
    queries,
    evidence,
    sectionEvidence,
    warnings: [...new Set(warnings.map((warning) => String(warning || '').trim()).filter(Boolean))],
    cache: {
      cacheHit: false,
      cacheSource: 'none',
      generatedAt: new Date().toISOString(),
    },
  };

  await setCachedResearchBundle(cacheKey, bundle);
  return bundle;
};

const callVertexAIForJson = async ({ systemPrompt, userPrompt, imageInputs = [] }) => {
  if (!hasUsableAIConfig()) throw new Error('AI configuration missing (OPENROUTER_API_KEY)');

  // Note: imageInputs are ignored because the current OpenRouter model
  // does not support multimodal (image) inputs. We log a warning if images
  // were provided so the caller knows they were skipped.
  const safeImageParts = Array.isArray(imageInputs)
    ? imageInputs.filter((img) => img?.mimeType && img?.base64)
    : [];
  if (safeImageParts.length > 0) {
    console.warn(`[Placeholder] ${safeImageParts.length} image(s) were provided but skipped — model does not support image inputs.`);
  }

  return await callOpenRouterForJson({ systemPrompt, userPrompt, temperature: 0.2 });
};

// Get lessons for a class
router.get('/class/:classId', authenticateToken, async (req, res) => {
  try {
    const { classId } = req.params;
    const { userId, role } = req.user || {};

    if (!userId) {
      return res.status(401).json({ error: 'Invalid session. Please sign in again.' });
    }

    const authorization = await authorizeClassAccess({ classId, userId, role });
    if (authorization.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (!authorization.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const lessonsWhere =
      role === 'STUDENT'
        ? {
          class_id: classId,
          owner_student_id: null,
          status: {
            in: Array.from(STUDENT_VISIBLE_LESSON_STATUSES),
          },
        }
        : {
          class_id: classId,
          owner_student_id: null,
        };

    const lessons = await prisma.lesson.findMany({
      where: lessonsWhere,
      orderBy: { created_at: 'desc' }
    });
    res.json(lessons);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
});

// Get personal lesson forks for the authenticated student in a class
router.get('/class/:classId/personal', authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== 'STUDENT') {
      return res.status(403).json({ error: 'Student access required' });
    }

    const { classId } = req.params;
    const { userId, role } = req.user || {};

    if (!userId) {
      return res.status(401).json({ error: 'Invalid session. Please sign in again.' });
    }

    const authorization = await authorizeClassAccess({ classId, userId, role });
    if (authorization.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (!authorization.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const lessons = await prisma.lesson.findMany({
      where: {
        class_id: classId,
        owner_student_id: userId,
      },
      orderBy: { created_at: 'desc' },
    });

    return res.json(lessons);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch personal lessons' });
  }
});

// Get personal blocks for the authenticated student
router.get('/:id/personal-blocks', authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== 'STUDENT') {
      return res.status(403).json({ error: 'Student access required' });
    }

    const { id } = req.params;
    const { userId, role } = req.user;

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: { id: true, class_id: true, status: true },
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const authorization = await authorizeClassAccess({
      classId: lesson.class_id,
      userId,
      role,
    });
    if (!authorization.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (role === 'STUDENT' && !isStudentVisibleLessonStatus(lesson.status)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const blocks = await prisma.studentPersonalBlock.findMany({
      where: {
        lesson_id: id,
        student_id: userId,
      },
      orderBy: [{ order_index: 'asc' }, { created_at: 'asc' }],
    });

    return res.json(blocks.map(serializeStudentPersonalBlock));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch personal blocks' });
  }
});

// Create a personal block for a student
router.post('/:id/personal-blocks', authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== 'STUDENT') {
      return res.status(403).json({ error: 'Student access required' });
    }

    const { id } = req.params;
    const { userId, role } = req.user;
    const rawType = String(req.body?.type || '').trim().toUpperCase();
    const afterBlockId = String(req.body?.after_block_id || req.body?.afterBlockId || '').trim();
    const requestedOrder = Number(req.body?.order_index ?? req.body?.orderIndex);
    const orderIndex = Number.isFinite(requestedOrder) ? Math.max(0, Math.floor(requestedOrder)) : 0;

    if (!PERSONAL_BLOCK_TYPES.has(rawType)) {
      return res.status(400).json({ error: 'Unsupported personal block type' });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: { id: true, class_id: true, status: true },
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const authorization = await authorizeClassAccess({
      classId: lesson.class_id,
      userId,
      role,
    });
    if (!authorization.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (role === 'STUDENT' && !isStudentVisibleLessonStatus(lesson.status)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (afterBlockId) {
      const [officialAnchor, personalAnchor] = await Promise.all([
        prisma.lessonBlock.findFirst({
          where: {
            id: afterBlockId,
            lesson_id: id,
          },
          select: { id: true },
        }),
        prisma.studentPersonalBlock.findFirst({
          where: {
            id: afterBlockId,
            lesson_id: id,
            student_id: userId,
          },
          select: { id: true },
        }),
      ]);

      if (!officialAnchor && !personalAnchor) {
        return res.status(400).json({ error: 'after_block_id must reference a block in this lesson' });
      }
    }

    const normalizedContent = normalizeBlockContentByType(rawType, req.body?.content);

    const created = await prisma.studentPersonalBlock.create({
      data: {
        lesson_id: id,
        student_id: userId,
        after_block_id: afterBlockId || null,
        type: rawType,
        content: serializeBlockContent(normalizedContent),
        order_index: orderIndex,
      },
    });

    return res.status(201).json(serializeStudentPersonalBlock(created));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create personal block' });
  }
});

// Update a student's personal block
router.put('/:id/personal-blocks/:blockId', authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== 'STUDENT') {
      return res.status(403).json({ error: 'Student access required' });
    }

    const { id, blockId } = req.params;
    const { userId, role } = req.user;

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: { id: true, class_id: true, status: true },
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const authorization = await authorizeClassAccess({
      classId: lesson.class_id,
      userId,
      role,
    });
    if (!authorization.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (role === 'STUDENT' && !isStudentVisibleLessonStatus(lesson.status)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const existing = await prisma.studentPersonalBlock.findFirst({
      where: {
        id: blockId,
        lesson_id: id,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Personal block not found' });
    }

    if (existing.student_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const nextType = req.body?.type
      ? String(req.body.type).trim().toUpperCase()
      : existing.type;
    if (!PERSONAL_BLOCK_TYPES.has(nextType)) {
      return res.status(400).json({ error: 'Unsupported personal block type' });
    }

    const hasAfterBlock =
      Object.prototype.hasOwnProperty.call(req.body || {}, 'after_block_id') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'afterBlockId');
    const candidateAfter = String(req.body?.after_block_id ?? req.body?.afterBlockId ?? '').trim();
    const nextAfterBlockId = hasAfterBlock ? candidateAfter : existing.after_block_id;

    if (nextAfterBlockId) {
      const [officialAnchor, personalAnchor] = await Promise.all([
        prisma.lessonBlock.findFirst({
          where: { id: nextAfterBlockId, lesson_id: id },
          select: { id: true },
        }),
        prisma.studentPersonalBlock.findFirst({
          where: { id: nextAfterBlockId, lesson_id: id, student_id: userId },
          select: { id: true },
        }),
      ]);
      if (!officialAnchor && !personalAnchor) {
        return res.status(400).json({ error: 'after_block_id must reference a block in this lesson' });
      }
    }

    const hasOrderIndex =
      Object.prototype.hasOwnProperty.call(req.body || {}, 'order_index') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'orderIndex');
    const requestedOrder = Number(req.body?.order_index ?? req.body?.orderIndex);
    const nextOrderIndex = hasOrderIndex
      ? Number.isFinite(requestedOrder)
        ? Math.max(0, Math.floor(requestedOrder))
        : existing.order_index
      : existing.order_index;

    const hasContent = Object.prototype.hasOwnProperty.call(req.body || {}, 'content');
    const nextContent = hasContent
      ? normalizeBlockContentByType(nextType, req.body.content)
      : deserializeBlockContentByType(existing.type, existing.content);

    const updated = await prisma.studentPersonalBlock.update({
      where: { id: blockId },
      data: {
        type: nextType,
        content: serializeBlockContent(nextContent),
        after_block_id: nextAfterBlockId || null,
        order_index: nextOrderIndex,
      },
    });

    return res.json(serializeStudentPersonalBlock(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update personal block' });
  }
});

// Refine one student personal block with AI (student only, block-context only)
router.post('/:id/personal-blocks/:blockId/refine-ai', authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== 'STUDENT') {
      return res.status(403).json({ error: 'Student access required' });
    }

    const { id, blockId } = req.params;
    const { userId, role } = req.user;
    const instructions = String(req.body?.instructions || '').trim();
    const normalizedReferenceImages = normalizeRefineImageInputs(req.body?.referenceImages);

    if (normalizedReferenceImages.requestedCount > 0 && normalizedReferenceImages.images.length === 0) {
      return res.status(400).json({
        error:
          normalizedReferenceImages.warnings[0] ||
          'No valid reference images were provided for AI refinement.',
      });
    }

    if (normalizedReferenceImages.warnings.length > 0) {
      console.warn('Personal refine image normalization warnings:', normalizedReferenceImages.warnings);
    }

    if (!hasUsableAIConfig()) {
      return res.status(500).json({
        error:
          'AI service is not configured. Please supply OPENROUTER_API_KEY in backend/.env.',
      });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        class_id: true,
        status: true,
      },
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const authorization = await authorizeClassAccess({
      classId: lesson.class_id,
      userId,
      role,
    });
    if (!authorization.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (role === 'STUDENT' && !isStudentVisibleLessonStatus(lesson.status)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const personalBlock = await prisma.studentPersonalBlock.findFirst({
      where: {
        id: blockId,
        lesson_id: id,
        student_id: userId,
      },
      select: {
        id: true,
        type: true,
        content: true,
      },
    });

    if (!personalBlock) {
      return res.status(404).json({ error: 'Personal block not found' });
    }

    if (!STUDENT_PERSONAL_AI_BLOCK_TYPES.has(personalBlock.type)) {
      return res.status(400).json({
        error: 'AI refinement is currently available only for CODE and INTERACTIVE_SIMULATION blocks',
      });
    }

    const hasClientBlockContent = Object.prototype.hasOwnProperty.call(req.body || {}, 'blockContent');
    const currentBlockContent = hasClientBlockContent
      ? normalizeBlockContentByType(personalBlock.type, req.body.blockContent)
      : deserializeBlockContentByType(personalBlock.type, personalBlock.content);
    const serializedCurrentContent =
      typeof currentBlockContent === 'object'
        ? JSON.stringify(currentBlockContent, null, 2)
        : String(currentBlockContent || '');

    const systemPrompt = `You are an expert curriculum editor helping a student improve exactly one personal lesson block.

Hard requirements:
1. Edit ONLY the provided block content.
2. Never reference other lesson blocks or outside lesson structure.
3. Keep the same blockType.
4. Keep output concise, classroom-ready, and aligned to student instructions.
5. Return ONLY valid JSON with this shape: {"content": ...}
6. If reference images are attached, use them as supplementary visual context to improve accuracy and alignment.

Block type schema rules:
- CODE: content can be either:
  a) plain source code string, or
  b) notebook object: {"version":1,"language":"javascript","runtime":"browser-js","defaultLanguage":"python","code":"...","cells":[{"id":"...","title":"...","code":"..."}]}
- INTERACTIVE_SIMULATION: A self-contained, interactive React widget. 
  Must be an object with: "title", "description", "template", "files", "hint", "solutionText".
  STRICT RULES FOR "files":
  1. The "files" object MUST contain exactly two files: "/App.js" and "/styles.css".
  2. "/App.js" MUST start with \`import "./styles.css";\` and MUST have \`export default function App() { ... }\`.
  3. ALLOWED DEPENDENCIES: You are encouraged to use \`lucide-react\` for icons, \`recharts\` for data visualization, and \`framer-motion\` for animations. 
  4. STRICT BAN: Do NOT import from any other external libraries. Implement custom logic manually using standard React hooks.
  5. Write clean, modern CSS in "/styles.css" using Flexbox/Grid so the UI looks professional.
  6. The code must be perfectly escaped for JSON.
  7. PERFORMANCE CRITICAL: If using \`recharts\` for dynamic simulation data tied to UI sliders, STRICTLY limit the data array to a maximum of 100 data points (e.g., adjust your math loop steps and delta time accordingly). Generating more than 100 data points will cause React SVG rendering to crash the browser.

Output must be JSON only, without markdown fences or commentary.`;

    const referenceImageSummary =
      normalizedReferenceImages.images.length > 0
        ? normalizedReferenceImages.images
          .map((image, index) => `${index + 1}. ${image.name} (${image.mimeType})`)
          .join('\n')
        : 'None';

    const userPrompt = `Lesson title: ${lesson.title}
Block type: ${personalBlock.type}
Student instructions: ${instructions || 'Improve clarity, correctness, and educational value while preserving intent.'
      }
Attached reference images: ${normalizedReferenceImages.images.length > 0 ? `${normalizedReferenceImages.images.length}` : '0'}
${referenceImageSummary}

Current block content:
${serializedCurrentContent}`;

    const parsedPayload = await callVertexAIForJson({
      systemPrompt,
      userPrompt,
      imageInputs: normalizedReferenceImages.images,
    });

    if (!parsedPayload || typeof parsedPayload !== 'object') {
      return res.status(502).json({ error: 'AI returned invalid block format' });
    }

    const candidate = Object.prototype.hasOwnProperty.call(parsedPayload, 'content')
      ? parsedPayload.content
      : parsedPayload;
    const refinedContent = normalizeRefinedContent(
      personalBlock.type,
      currentBlockContent,
      candidate,
      {
        topic: lesson.title,
      }
    );

    return res.json({ content: refinedContent });
  } catch (err) {
    console.error('AI Refine Personal Block Error:', err);

    if (err?.status === 401 || err?.status === 403) {
      return res.status(502).json({
        error:
          'AI provider rejected credentials. Verify your OpenRouter API key.',
      });
    }

    if (String(err?.message || '').includes('invalid JSON payload')) {
      return res.status(502).json({
        error:
          'AI provider returned malformed JSON. Please try refining again.',
      });
    }

    return res.status(500).json({
      error:
        'Failed to refine personal block with AI. Check backend logs for details.',
    });
  }
});

// Delete a personal block
router.delete('/:id/personal-blocks/:blockId', authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== 'STUDENT') {
      return res.status(403).json({ error: 'Student access required' });
    }

    const { id, blockId } = req.params;
    const { userId, role } = req.user;

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: { id: true, class_id: true, status: true },
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const authorization = await authorizeClassAccess({
      classId: lesson.class_id,
      userId,
      role,
    });
    if (!authorization.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (role === 'STUDENT' && !isStudentVisibleLessonStatus(lesson.status)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const existing = await prisma.studentPersonalBlock.findFirst({
      where: {
        id: blockId,
        lesson_id: id,
      },
      select: {
        id: true,
        student_id: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Personal block not found' });
    }

    if (existing.student_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await prisma.studentPersonalBlock.delete({ where: { id: blockId } });
    return res.json({ message: 'Personal block deleted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete personal block' });
  }
});

// Create or return a student's personal fork of a global lesson
router.post('/:id/fork', authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== 'STUDENT') {
      return res.status(403).json({ error: 'Student access required' });
    }

    const { id } = req.params;
    const { userId, role } = req.user;

    const sourceLesson = await prisma.lesson.findUnique({
      where: { id },
      include: {
        class: true,
      },
    });

    if (!sourceLesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    if (!isGlobalLesson(sourceLesson)) {
      if (sourceLesson.owner_student_id === userId) {
        const existingPersonalLesson = await prisma.lesson.findUnique({
          where: { id: sourceLesson.id },
          include: {
            blocks: {
              orderBy: { order_index: 'asc' },
            },
          },
        });
        return res.json(existingPersonalLesson);
      }
      return res.status(403).json({ error: 'Access denied' });
    }

    const authorization = await authorizeClassAccess({
      classId: sourceLesson.class_id,
      userId,
      role,
    });
    if (!authorization.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!isStudentVisibleLessonStatus(sourceLesson.status)) {
      return res.status(403).json({ error: 'Only published lessons can be forked by students' });
    }

    const forkedLesson = await prisma.$transaction((tx) =>
      findOrCreateStudentLessonFork(tx, sourceLesson, userId)
    );

    return res.status(201).json(forkedLesson);
  } catch (err) {
    if (err?.code === 'P2002') {
      try {
        const { id } = req.params;
        const existing = await prisma.lesson.findFirst({
          where: {
            source_lesson_id: id,
            owner_student_id: req.user?.userId,
          },
          include: {
            blocks: {
              orderBy: { order_index: 'asc' },
            },
          },
        });
        if (existing) {
          return res.json(existing);
        }
      } catch (lookupErr) {
        console.error('Failed to recover existing lesson fork after unique conflict:', lookupErr);
      }
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to fork lesson' });
  }
});

// Get single lesson details with blocks
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.user || {};

    if (!userId) {
      return res.status(401).json({ error: 'Invalid session. Please sign in again.' });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: {
        blocks: {
          orderBy: { order_index: 'asc' }
        }
      }
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const authorization = await authorizeClassAccess({
      classId: lesson.class_id,
      userId,
      role,
    });
    if (authorization.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (!authorization.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (role === 'TEACHER' && isPersonalLesson(lesson)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (role === 'STUDENT') {
      if (isPersonalLesson(lesson)) {
        if (lesson.owner_student_id !== userId) {
          return res.status(403).json({ error: 'Access denied' });
        }
      } else if (!isStudentVisibleLessonStatus(lesson.status)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json(lesson);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch lesson' });
  }
});

const generateSimulationCode = async (design_spec, title, topic = '') => {
  const systemPrompt = `You are an expert React developer. Generate a self-contained interactive educational widget based on the user's specification.
Return ONLY valid JSON with this exact shape: { "files": { "/App.js": "...", "/styles.css": "..." } }
STRICT RULES FOR "files":
1. The "files" object MUST contain exactly two files: "/App.js" and "/styles.css".
2. "/App.js" MUST start with \`import "./styles.css";\` and MUST have \`export default function App() { ... }\`.
3. ALLOWED DEPENDENCIES: You are encouraged to use \`lucide-react\` for icons, \`recharts\` for data visualization, and \`framer-motion\` for animations. 
4. STRICT BAN: Do NOT import from any other external libraries (e.g., no material-ui, no chart.js, no tailwindcss). If you need functionality outside the allowed list, implement it manually using standard React hooks and standard CSS.
5. Write clean, modern CSS in "/styles.css" using Flexbox/Grid so the UI looks professional.
6. Escape code perfectly for JSON. No markdown fences.
7. PERFORMANCE CRITICAL: If using \`recharts\` for dynamic simulation data tied to UI sliders, STRICTLY limit the data array to a maximum of 100 data points (e.g., adjust your math loop steps and delta time accordingly). Generating more than 100 data points will cause React SVG rendering to crash the browser.
8. The simulation must stay explicitly aligned with the lesson topic and provided design spec. Never substitute an unrelated canned finance simulation unless the topic itself is finance/economics.`;

  const userPrompt = `Lesson Topic: ${topic || 'General topic'}
Simulation Title: ${title || 'Interactive Widget'}
Design Specification:
${design_spec || 'Create a simple placeholder interactive widget that visually explains the core concept of the lesson.'}`;

  try {
    const rawData = await callVertexAIForJson({ systemPrompt, userPrompt });
    if (rawData?.files && typeof rawData.files['/App.js'] === 'string' && typeof rawData.files['/styles.css'] === 'string') {
      return rawData.files;
    }
  } catch (err) {
    console.error('generateSimulationCode Error:', err);
  }

  const { getDefaultSimulationBlock } = require('../schemas/simulationBlockSchema');
  return getDefaultSimulationBlock().files;
};

const getEvidenceMatchScoreForText = (text, evidencePool = []) => {
  const targetTokens = tokenizeForResearch(text);
  if (targetTokens.length === 0) return 0;

  let bestScore = 0;
  evidencePool.forEach((entry) => {
    const evidenceTokens = tokenizeForResearch(`${entry?.title || ''} ${entry?.snippet || ''}`);
    const overlap = computeTokenOverlapScore(targetTokens, evidenceTokens);
    const weighted = overlap * (0.7 + 0.3 * (Number(entry?.confidence) || 0));
    if (weighted > bestScore) {
      bestScore = weighted;
    }
  });

  return bestScore;
};

const softenUnsupportedClaims = (text) => {
  let next = String(text || '');
  next = next.replace(/\balways\b/gi, 'often');
  next = next.replace(/\bnever\b/gi, 'rarely');
  next = next.replace(/\bguaranteed\b/gi, 'typically expected');
  next = next.replace(/\bproves\b/gi, 'suggests');
  next = next.replace(/\blatest\b/gi, 'recent');
  next = next.replace(/\bcurrent\b/gi, 'commonly referenced');
  return next;
};

const rewriteBlockFromEvidence = async (originalText, evidencePool, topic) => {
  const evidenceSnippets = (Array.isArray(evidencePool) ? evidencePool : [])
    .filter((entry) => entry?.snippet)
    .slice(0, 8)
    .map((entry) => `[${entry.id}] ${entry.title} (${entry.domain || 'unknown'})\nEvidence: ${entry.snippet}`)
    .join('\n\n');

  if (!evidenceSnippets.trim()) {
    return null;
  }

  const systemPrompt = `You are a strict factual rewriting engine for university-level educational content.

Your ONLY job is to rewrite the provided text block so that every claim is directly supported by the supplied research evidence.

Hard rules:
1. Use EXCLUSIVELY the provided evidence snippets as your source of truth.
2. Do NOT invent, extrapolate, or hallucinate any facts, statistics, dates, or claims not present in the evidence.
3. If the evidence does not support a claim from the original text, OMIT that claim entirely rather than guessing.
4. Preserve the original Markdown formatting style (headings, bold, lists, callouts).
5. Maintain academic rigor and university-level depth.
6. Return ONLY valid JSON with this shape: {"rewrittenContent": "..."}
7. Do not include markdown fences or commentary outside the JSON.`;

  const userPrompt = `Topic: ${topic}

Original text block (contains unsupported claims — do NOT trust it):
${originalText}

Verified research evidence (use ONLY these as source material):
${evidenceSnippets}

Rewrite the text block using exclusively the evidence above. Omit any claim that cannot be traced to a specific evidence snippet.`;

  const result = await callVertexAIForJson({ systemPrompt, userPrompt });

  if (result?.rewrittenContent && typeof result.rewrittenContent === 'string' && result.rewrittenContent.trim()) {
    return result.rewrittenContent;
  }

  return null;
};

const hasNumericChartClaims = (chartContent) => {
  if (!chartContent || typeof chartContent !== 'object') return false;
  const data = Array.isArray(chartContent.data) ? chartContent.data : [];
  return data.some((item) =>
    Object.entries(item || {}).some(([key, value]) => key !== 'name' && Number.isFinite(Number(value)))
  );
};

const verifyAndRepairGeneratedLesson = async ({
  lessonData,
  researchBundle,
  topic,
  options = {},
}) => {
  const warnings = [];
  const allowVisualPlaceholders = Boolean(options?.allowVisualPlaceholders);
  const allowHttpImageUrls = options?.allowHttpImageUrls !== false;
  const enableStrictEvidenceRewrite = Boolean(options?.enableStrictEvidenceRewrite);
  const evidencePool = Array.isArray(researchBundle?.evidence) ? researchBundle.evidence : [];

  if (!lessonData || !Array.isArray(lessonData.blocks)) {
    return { lessonData, warnings };
  }

  const updatedBlocks = await Promise.all(
    lessonData.blocks.map(async (block, blockIndex) => {
      if (!block || typeof block !== 'object') return block;
      const nextBlock = { ...block };

      if (nextBlock.type === 'TEXT' && typeof nextBlock.content === 'string') {
        const matchScore = getEvidenceMatchScoreForText(nextBlock.content, evidencePool);
        if (matchScore < 0.06 && evidencePool.length > 0 && enableStrictEvidenceRewrite) {
          // Optional strict rewrite path (disabled by default for latency/quality stability)
          try {
            const rewritten = await rewriteBlockFromEvidence(nextBlock.content, evidencePool, topic);
            if (rewritten) {
              nextBlock.content = rewritten;
              warnings.push({
                blockIndex,
                blockType: 'TEXT',
                reason: 'Low evidence alignment; block fully rewritten from cached research sources.',
              });
            } else {
              // Evidence pool was empty or rewrite returned nothing — fall back to softening
              nextBlock.content = softenUnsupportedClaims(nextBlock.content);
              warnings.push({
                blockIndex,
                blockType: 'TEXT',
                reason: 'Low evidence alignment; AI rewrite returned empty result, softened absolute claims as fallback.',
              });
            }
          } catch (rewriteErr) {
            console.warn(`Strict rewrite failed for block ${blockIndex}:`, rewriteErr?.message || rewriteErr);
            nextBlock.content = softenUnsupportedClaims(nextBlock.content);
            warnings.push({
              blockIndex,
              blockType: 'TEXT',
              reason: 'Low evidence alignment; AI rewrite failed, softened absolute claims as fallback.',
            });
          }
        } else if (matchScore < 0.04) {
          // Fast local-only fallback for weakly supported wording.
          nextBlock.content = softenUnsupportedClaims(nextBlock.content);
        }

        const sanitizedImages = sanitizeMarkdownImageLinks(nextBlock.content, {
          allowVisualPlaceholders,
          allowHttpImageUrls,
        });
        if (sanitizedImages.warnings.length > 0) {
          warnings.push(
            ...sanitizedImages.warnings.map((message) => ({
              blockIndex,
              blockType: 'TEXT',
              reason: message,
            }))
          );
        }
        nextBlock.content = sanitizedImages.text;
      }

      if (
        evidencePool.length > 0 &&
        nextBlock.type === 'STATIC_CHART' &&
        nextBlock.content &&
        typeof nextBlock.content === 'object'
      ) {
        if (hasNumericChartClaims(nextBlock.content)) {
          const chartSignal = `${nextBlock.content.title || ''} ${(nextBlock.content.data || [])
            .map((item) => item?.name || '')
            .join(' ')}`;
          const matchScore = getEvidenceMatchScoreForText(chartSignal, evidencePool);
          if (matchScore < 0.04) {
            nextBlock.type = 'TEXT';
            nextBlock.content = 'Numerical data for this chart was omitted because it could not be confidently verified against recent research.';
            warnings.push({
              blockIndex,
              blockType: 'TEXT',
              reason: 'Chart claims were weakly supported by evidence; converted to TEXT block indicating omitted numerical data.',
            });
          }
        }
      }

      if (
        evidencePool.length > 0 &&
        nextBlock.type === 'MERMAID_DIAGRAM' &&
        nextBlock.content &&
        typeof nextBlock.content === 'object'
      ) {
        const code = String(nextBlock.content.code || '');
        const yearMatches = code.match(/\b20\d{2}\b/g) || [];
        if (yearMatches.length > 0) {
          const evidenceText = evidencePool
            .map((entry) => `${entry?.title || ''} ${entry?.snippet || ''}`)
            .join(' ')
            .toLowerCase();
          const hasYearSupport = yearMatches.every((year) => evidenceText.includes(String(year).toLowerCase()));
          if (!hasYearSupport) {
            nextBlock.content = { code: buildTopicMermaidFallbackCode(topic) };
            warnings.push({
              blockIndex,
              blockType: 'MERMAID_DIAGRAM',
              reason: 'Unsupported year-specific Mermaid assertions were replaced with a safe fallback diagram.',
            });
          }
        }
      }

      return nextBlock;
    })
  );

  lessonData.blocks = updatedBlocks;
  return { lessonData, warnings };
};

// Generate lesson with AI (Teacher only)
router.post('/generate', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const {
      classId,
      topic,
      targetDuration,
      referenceContent,
      referenceFiles,
      referenceImages,
      interactivityLevel,
      defaultCodeLanguage,
    } = req.body;

    if (!hasUsableAIConfig()) {
      return res.status(500).json({
        error:
          'AI service is not configured. Please supply OPENROUTER_API_KEY in backend/.env.',
      });
    }

    const safeClassId = String(classId || '').trim();
    if (safeClassId) {
      const targetClass = await prisma.class.findUnique({
        where: { id: safeClassId },
        select: { id: true, teacher_id: true, is_archived: true },
      });

      if (!targetClass) {
        return res.status(404).json({ error: 'Class not found' });
      }
      if (targetClass.teacher_id !== req.user?.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (targetClass.is_archived) {
        return res.status(400).json({ error: 'Cannot generate lessons for an archived class' });
      }
    }

    const safeTopic = String(topic || '').trim() || 'Untitled Topic';
    const audience = 'University / College';
    const durationMinutes = Math.max(10, Number(targetDuration) || 30);
    const baseReference = String(referenceContent || '').trim();
    const safeDefaultCodeLanguage = normalizeCodeLanguage(defaultCodeLanguage);
    const safeInteractivityLevel = Number.isFinite(Number(interactivityLevel))
      ? Math.max(0, Math.min(100, Math.round(Number(interactivityLevel))))
      : 50;
    const normalizedReferenceFiles = normalizeReferenceFilesInput(referenceFiles);
    const normalizedReferenceImages = normalizeGenerationReferenceImagesInput(referenceImages);
    const pdfReferenceFileCount = normalizedReferenceFiles.files.filter((file) => {
      const mimeType = String(file?.mimeType || '').toLowerCase();
      const name = String(file?.name || '').toLowerCase();
      return mimeType === 'application/pdf' || name.endsWith('.pdf');
    }).length;
    const pdfSnapshotCount = normalizedReferenceImages.images.filter(
      (image) => String(image?.source || '').toLowerCase() === 'pdf_snapshot'
    ).length;
    if (pdfReferenceFileCount > 0 && pdfSnapshotCount === 0) {
      return res.status(400).json({
        error: 'PDF snapshots are required when PDF reference files are attached.',
        reason: 'PDF_SNAPSHOTS_REQUIRED',
      });
    }
    const extractedReferenceFilesContext = await buildReferenceFilesContext({
      topic: safeTopic,
      referenceFiles: normalizedReferenceFiles.files,
    });
    const referenceFileWarnings = [...new Set([
      ...(normalizedReferenceFiles.warnings || []),
      ...(extractedReferenceFilesContext.warnings || []),
    ])];
    const referenceImageWarnings = [...new Set(normalizedReferenceImages.warnings || [])];
    const effectiveReference = [baseReference, extractedReferenceFilesContext.combinedText]
      .filter((chunk) => String(chunk || '').trim())
      .join('\n\n')
      .slice(0, MAX_REFERENCE_TEXT_CHARS_TOTAL + 12000);
    const referenceStructure = await buildReferenceStructureContext({
      topic: safeTopic,
      referenceText: effectiveReference,
    });
    const referenceStructureWarnings = [...new Set(referenceStructure.warnings || [])];
    const hasTeacherGuidance = Boolean(
      effectiveReference.length >= 300 ||
      normalizedReferenceFiles.files.length > 0 ||
      normalizedReferenceImages.images.length > 0
    );
    const skipExternalResearch = hasTeacherGuidance;

    // Phase 0 - Structured Internet Research (initial pass for Step 1)
    const initialResearchBundle = skipExternalResearch
      ? buildEmptyResearchBundle('External web research skipped because teacher reference material is available.')
      : await buildResearchBundle({
        topic: safeTopic,
        teacherReference: effectiveReference,
        durationMinutes,
        interactivityLevel: safeInteractivityLevel,
        structurePlan: null,
        seedBundle: null,
      });
    const initialResearchSummary = formatResearchSummaryForPrompt({
      evidence: initialResearchBundle?.evidence || [],
      maxChars: 1800,
    });
    const structureEvidenceContext = skipExternalResearch
      ? 'External web evidence is disabled for this generation. Use only teacher-provided material and references.'
      : `Internet research digest (compact, sanitized):
${initialResearchSummary}`;

    // Step 1 - Structure: lesson outline and section flow.
    const structureSystemPrompt = `You are a University-level Teaching Assistant and curriculum architect.
Create only the high-level lesson structure for university/college learners.

Return ONLY valid JSON with this shape:
{
  "lessonTitle": "string",
  "objectives": ["string"],
  "sections": [
    {
      "id": "section-1",
      "title": "string",
      "goal": "string",
      "durationMinutes": 8,
      "keyPoints": ["string"]
    }
  ]
}

Rules:
- 3 to 6 sections.
- Keep section flow logical from introduction to assessment.
- Assume learners are university/college students with baseline prerequisite knowledge.
- Objectives should reflect higher-order outcomes.
- CRITICAL: The reference content may be a messy brain-dump, raw whiteboard notes, or conversational text. You must act as an expert instructional designer: filter out the teacher's personal reminders, conversational fluff, and disorganized formatting. Extract ONLY the core pedagogical concepts to build the structure.
- If a reference heading order is provided, follow that order as a hard preference unless it is clearly invalid.
- Do not generate detailed block content in this step.
- Do not include markdown or commentary.`;

    const structureUserPrompt = `Topic: ${safeTopic}
Target audience: ${audience}
Target duration (minutes): ${durationMinutes}
Teacher reference content (may be messy notes):
${effectiveReference || 'None provided.'}

Reference heading order preference:
${referenceStructure.headings.length > 0
    ? referenceStructure.headings.map((heading, index) => `${index + 1}. ${heading}`).join('\n')
    : 'No explicit heading order detected.'}

Evidence context:
${structureEvidenceContext}`;

    const rawStructurePlan = await callVertexAIForJson({
      systemPrompt: structureSystemPrompt,
      userPrompt: structureUserPrompt,
    });
    const normalizedStructurePlan = normalizeStructurePlan(rawStructurePlan, safeTopic, durationMinutes);
    const structurePlan = alignStructurePlanToReferenceHeadings(
      normalizedStructurePlan,
      referenceStructure,
      durationMinutes,
      safeTopic
    );

    // Phase 0b - Structured Internet Research (section-aware refresh after structure plan)
    const researchBundle = skipExternalResearch
      ? buildEmptyResearchBundle('External web research skipped because teacher reference material is available.')
      : await buildResearchBundle({
        topic: safeTopic,
        teacherReference: effectiveReference,
        durationMinutes,
        interactivityLevel: safeInteractivityLevel,
        structurePlan,
        seedBundle: initialResearchBundle,
      });
    const globalResearchSummary = formatResearchSummaryForPrompt({
      evidence: researchBundle?.evidence || [],
      maxChars: 1800,
    });
    const researchTagsForStrategy = formatResearchTagsForPrompt(researchBundle?.evidence || [], 10);
    const sectionResearchPromptMap = buildSectionResearchPromptMap(researchBundle, structurePlan);
    const sectionResearchUsage = buildResearchUsageBySection(researchBundle, structurePlan);

    const teacherVisualCatalogResult = buildTeacherVisualCatalog(normalizedReferenceImages.images);
    const visualCatalogWarnings = [
      ...(teacherVisualCatalogResult.warnings || []),
    ];
    const visualCatalog = [
      ...(teacherVisualCatalogResult.visuals || []),
    ].slice(0, MAX_TOTAL_GENERATION_VISUALS);
    const sectionVisualUsage = mapVisualsToSections(visualCatalog, structurePlan);
    const sectionVisualPromptMap = buildSectionVisualPromptMap(
      visualCatalog,
      structurePlan,
      sectionVisualUsage
    );
    const strategyEvidenceContext = skipExternalResearch
      ? 'External web evidence is disabled for this generation. Use only teacher-provided material and references.'
      : `Internet evidence tags (for block-type decisions):
${researchTagsForStrategy}

Internet research digest:
${globalResearchSummary}`;

    // Step 2 - Block Strategy: decide where each block type goes.
    const blockStrategySystemPrompt = `You are a University-level Teaching Assistant and instructional designer.
You will receive a lesson structure and must assign block types to each section for college-level learners.

Available block types and their nature:

STATIC (non-interactive) blocks:
- TEXT: Rich explanatory content - lectures, definitions, walkthroughs. The student reads but does not interact.
- CODE: A notebook-style code block. The teacher-selected default runtime language is "${safeDefaultCodeLanguage}". Students may switch runtime language at execution time. Content should still be plain source text, and multi-cell sections can be separated by lines that start with "// %%" comment lines.
- MERMAID_DIAGRAM: Use for flowcharts, concept maps, and system architectures.
- STATIC_CHART: Use for displaying static data, trends, or comparisons (bar, line, or pie charts).

INTERACTIVE blocks (the student actively responds or manipulates something):
- EXERCISE: Multiple-choice practice question with feedback.
- QUIZ: Timed multiple-choice assessment question.
- DISCUSSION: An open-ended prompt the student responds to in writing.
- WRITTEN_QUIZ: A free-response question evaluated against an ideal answer.
- INTERACTIVE_SIMULATION: A secure Sandpack-based simulation. Use this when the topic benefits from hands-on experimentation and visual feedback (for example, dynamic models, scientific systems, or algorithmic behavior).

Return ONLY valid JSON with this shape:
{
  "lessonTitle": "string",
  "sections": [
    {
      "id": "section-1",
      "title": "string",
      "blocks": [
        { "type": "TEXT", "purpose": "string" }
      ]
    }
  ]
}

Rules:
- Evaluate the topic and autonomously choose whichever blocks best serve it. You are the instructional designer.
- STRICT TOPIC ENFORCEMENT: You are STRICTLY FORBIDDEN from generating CODE, STATIC_CHART, or MERMAID_DIAGRAM blocks unless the lesson topic *strictly and explicitly* requires programming, numerical data visualization, or complex system architecture mapping. Qualitative, philosophical, or historical topics must rely on TEXT, DISCUSSION, and EXERCISE blocks. DO NOT force code or charts into non-technical lessons.
- CRITICAL: Teachers will provide messy, conversational reference notes. They will NOT explicitly ask for block types. You must infer their intent:
  * If they provide raw numerical data/benchmarks AND the topic is strictly quantitative -> use STATIC_CHART.
  * If they describe a system architecture or explicitly ask for a flowchart AND the topic is technical -> use MERMAID_DIAGRAM.
  * If they mention a "trick question", "ask the students", or a scenario -> use QUIZ or DISCUSSION.
  * If they provide raw, broken code snippets -> use CODE.
  * If they suggest visualizing a concept dynamically -> use INTERACTIVE_SIMULATION.
- Approximately ${safeInteractivityLevel}% of all blocks in the lesson should be INTERACTIVE blocks. The rest should be STATIC.
- Keep QUIZ near the end of the lesson.
- Keep each section focused.
- Keep each section highly detailed and comprehensive; generate 3 to 6 blocks per section depending on the required depth.
- Do not include detailed block content in this step.
- Do not include markdown or commentary.`;

    const blockStrategyUserPrompt = `Topic: ${safeTopic}
Target audience: ${audience}
Target duration (minutes): ${durationMinutes}
Teacher preferred code runtime: ${safeDefaultCodeLanguage}
Lesson structure JSON:
${JSON.stringify(structurePlan, null, 2)}
Teacher reference content (may be messy notes):
${effectiveReference || 'None provided.'}

Reference structure preference:
${referenceStructure.headings.length > 0
    ? referenceStructure.headings.map((heading, index) => `${index + 1}. ${heading}`).join('\n')
    : 'No explicit heading order detected.'}

Available visual assets:
${formatVisualCatalogForPrompt(visualCatalog, 10)}

Evidence context:
${strategyEvidenceContext}`;

    const rawBlockStrategy = await callVertexAIForJson({
      systemPrompt: blockStrategySystemPrompt,
      userPrompt: blockStrategyUserPrompt,
    });
    const strategyPlan = normalizeBlockStrategyPlan(rawBlockStrategy, structurePlan);

    // Step 3 - Deep Content Generation (Parallel per Section)
    let allBlocks = [];
    const sectionFailures = [];

    // Build a lookup from structurePlan for properties not carried by strategyPlan
    const structureSectionMap = new Map(
      structurePlan.sections.map((s) => [s.id, s])
    );

    // Build section list context for narrative continuity
    const sectionOverview = strategyPlan.sections.map((s, i) => {
      const info = structureSectionMap.get(s.id);
      return `${i + 1}. "${s.title}" (${info?.durationMinutes || '?'} min)`;
    });

    const objectivesList = (structurePlan.objectives || [])
      .map((o, i) => `${i + 1}. ${o}`)
      .join('\n');

    const sectionPromises = strategyPlan.sections.map(async (section, sIdx) => {
      const structSection = structureSectionMap.get(section.id) || {};
      const sectionEvidencePrompt =
        sectionResearchPromptMap[section.id] || 'No high-confidence section-specific web evidence was mapped.';
      const sectionCitationIds = Array.isArray(sectionResearchUsage?.[section.id]) && sectionResearchUsage[section.id].length > 0
        ? sectionResearchUsage[section.id].join(', ')
        : 'None';
      const sectionEvidenceContext = skipExternalResearch
        ? 'External web evidence is disabled for this generation. Use only teacher-provided material and references.'
        : `Section-Specific Evidence (sanitized):
${sectionEvidencePrompt}

Citation IDs mapped to this section:
${sectionCitationIds}`;
      const sectionVisualPrompt =
        sectionVisualPromptMap?.[section.id] || 'No visuals were pre-mapped to this section.';

      // Resolve properties from structurePlan that strategyPlan does not carry
      const sectionGoal = structSection.goal || `Cover ${section.title}`;
      const sectionDuration = structSection.durationMinutes || Math.round(durationMinutes / strategyPlan.sections.length);
      const sectionKeyPoints = Array.isArray(structSection.keyPoints) ? structSection.keyPoints : [];

      // Keep section output detailed but bounded to avoid generic over-expansion and slow responses.
      const estimatedWordCount = Math.min(sectionDuration * 70, 700);

      // Narrative positioning - mark the current section in the full outline
      const sectionListWithMarker = sectionOverview
        .map((title, i) => (i === sIdx ? `>> ${title} << (YOU ARE HERE)` : `  ${title}`))
        .join('\n');

      const previousSectionTitles = strategyPlan.sections
        .slice(0, sIdx)
        .map((plannedSection) => plannedSection.title);

      const previousContext = previousSectionTitles.length > 0
        ? `Sections planned before this one (avoid repeating their scope): ${previousSectionTitles.join(', ')}.`
        : 'This is the FIRST section of the lecture.';

      const isLastSection = sIdx === strategyPlan.sections.length - 1;

      const sectionSystemPrompt = `You are a University-level Teaching Assistant generating academically rigorous lesson content.
You are currently writing the highly detailed content for EXACTLY ONE SECTION of a larger university-level lecture.

LESSON CONTEXT:
Lesson Objectives:
${objectivesList || '- Understand and apply the core concepts of the topic.'}

Full Lecture Outline (your current position is marked):
${sectionListWithMarker}

${previousContext}

ANTI-REPETITION RULES:
- Do NOT re-introduce the overall topic or provide a general overview - earlier sections already covered that.
- Do NOT define basic terms that earlier sections would have already established.
- Begin DIRECTLY with this section's core material.
${isLastSection ? '- This is the FINAL section - you may include a brief synthesis or summary.' : '- Do NOT write a conclusion or summary paragraph; more sections follow.'}

Return ONLY valid JSON with this exact shape:
{
  "blocks": [
    { "type": "TEXT", "content": "..." }
  ]
}

Block content requirements:
- TEXT: precise, academically dense explanation text.
  FORMATTING (MANDATORY): You MUST produce textbook-style Markdown with clear hierarchy:
  - ## section headings and ### subheadings
  - well-spaced paragraphs (avoid large unbroken walls of text)
  - bullet lists for grouped concepts
  - numbered lists for procedures/algorithms
  - **bold** key terms and *italic* emphasis when useful
  - explicit definition callouts in the form > [!DEFINITION] ... for major definitions
  CRITICAL: Stay grounded in the teacher-provided material and section goals. Avoid generic filler and avoid invented statistics, citations, or datasets.
  DEPTH CALIBRATION: This section is allocated ${sectionDuration} minutes of lecture time. Each TEXT block should contain approximately ${estimatedWordCount} words of lecture-quality prose to fill that time adequately.
  VISUAL INSERTION RULES:
  - If the section catalog includes teacher visuals (IDs starting with "T"), you MUST include at least one teacher visual.
  - Embed visuals ONLY in TEXT blocks using this exact syntax: ![concise alt text](VISUAL:<id>)
  - Use only teacher visual IDs provided in the section-scoped catalog.
  - Use 1 to ${MAX_VISUALS_PER_SECTION} visual placeholders when visuals are available.
  - Immediately after each inserted image, add one short explanatory sentence that ties the image to the concept.
- CODE: plain source code text aligned to "${safeDefaultCodeLanguage}".
- EXERCISE: object with "question" and "options" (each option has "text", "isCorrect", "feedback").
- QUIZ: object with "question", "options", and "timeLimit".
- DISCUSSION: intellectually challenging prompt requiring synthesis.
- WRITTEN_QUIZ: object with "question" and "idealAnswer".
- INTERACTIVE_SIMULATION: Provide a specification object with: "title", "description", "hint", "solutionText", and a "design_spec" string detailing the simulation logic. Do not write React code. The simulation MUST be directly about this topic/section and MUST NOT default to compound-interest or unrelated finance examples unless the topic is finance.
- MERMAID_DIAGRAM: object with exactly one key "code" containing valid Mermaid.js syntax. Use standard graph syntax without unsupported shapes. Minimum detail: at least 5 nodes and domain-specific labels tied to the section key points.
- STATIC_CHART: object with "chartType" (bar, line, pie), "title", "dataKey", and "data" array. Minimum detail: at least 4 data points with non-generic category labels (not just A/B).

Output must be JSON only, without markdown fences or commentary.`;

      const sectionUserPrompt = `Topic: ${safeTopic}
Target audience: ${audience}
Teacher preferred code runtime: ${safeDefaultCodeLanguage}

CURRENT SECTION TO WRITE:
Title: ${section.title}
Goal: ${sectionGoal}
Allocated Time: ${sectionDuration} minutes
Key Points to Cover: ${sectionKeyPoints.length > 0 ? sectionKeyPoints.join('; ') : 'Use your judgement based on the section goal.'}
Required Blocks to Generate for this section: 
${JSON.stringify(section.blocks, null, 2)}

Teacher Reference Content (raw notes may be messy):
${effectiveReference || 'None provided.'}

Evidence context:
${sectionEvidenceContext}

Section-Scoped Visual Catalog (use only these IDs for VISUAL placeholders):
${sectionVisualPrompt}

Teacher visual policy:
- Use only IDs beginning with T (teacher-provided files/PDF snapshots).
- Do not use any external internet image URLs.

INSTRUCTIONS: 
The reference content provided by the teacher will vary wildly in length, structure, and quality. You must act as an expert instructional designer and adapt dynamically:

1. IF THE CONTENT IS SPARSE (e.g., just keywords, a brief sentence, or a skeletal outline):
   - Do not just output a short summary.
   - You MUST utilize your deep internal academic knowledge to exhaustively expand the topic.
   - Introduce necessary foundational theories, real-world case studies, and advanced mechanics to generate enough rigorous material to fill the ${sectionDuration}-minute allocation.

2. IF THE CONTENT IS EXCESSIVELY LONG OR MESSY (e.g., a massive brain-dump, raw syllabus, or unstructured notes):
   - Do not get bogged down in tangents or conversational filler ("make sure to tell them", "I ran these tests").
   - Distill and prioritize. Extract only the hard facts, formulas, and core pedagogical concepts required for this specific section.

3. ALWAYS ELEVATE:
   - Transform the raw input into a polished, highly structured, rigorous university-level lecture.

Generate the full content for the required blocks mapped to this specific section. Do not skip any requested blocks.`;

      let sectionSucceeded = false;
      let generatedBlocks = [];
      let failureReason = 'Unknown error';

      try {
        const rawSectionData = await callVertexAIForJson({
          systemPrompt: sectionSystemPrompt,
          userPrompt: sectionUserPrompt,
        });

        if (rawSectionData) {
          if (Array.isArray(rawSectionData.blocks) && rawSectionData.blocks.length > 0) {
            generatedBlocks = rawSectionData.blocks;
            sectionSucceeded = true;
          } else if (Array.isArray(rawSectionData) && rawSectionData.length > 0) {
            // Fallback: The AI returned the array directly instead of wrapping it in { blocks: [] }
            generatedBlocks = rawSectionData;
            sectionSucceeded = true;
          } else {
            failureReason = 'Empty or malformed AI response';
          }
        } else {
          failureReason = 'Empty AI response';
        }

      } catch (err) {
        const isRateLimit = err?.status === 429;

        if (isRateLimit) {
          // Retry once after a 5-second backoff for rate-limit errors
          console.warn(`Rate limited on section "${section.title}", retrying after 5s backoff...`);
          await new Promise((resolve) => setTimeout(resolve, 5000));
          try {
            const retryData = await callVertexAIForJson({
              systemPrompt: sectionSystemPrompt,
              userPrompt: sectionUserPrompt,
            });
            if (retryData && Array.isArray(retryData.blocks) && retryData.blocks.length > 0) {
              generatedBlocks = retryData.blocks;
              sectionSucceeded = true;
            } else if (Array.isArray(retryData) && retryData.length > 0) {
              generatedBlocks = retryData;
              sectionSucceeded = true;
            } else {
              failureReason = 'Empty response after rate-limit retry';
            }
          } catch (retryErr) {
            console.error(`Rate-limit retry failed for section "${section.title}":`, retryErr);
            failureReason = `Rate-limit retry failed: ${retryErr?.message || 'Unknown'}`;
          }
        } else {
          console.error(`Failed to generate section "${section.title}":`, err);
          failureReason = err?.message || 'Unknown error';
        }
      }

      return {
        index: sIdx,
        title: section.title,
        blocks: generatedBlocks,
        success: sectionSucceeded,
        reason: sectionSucceeded ? '' : failureReason,
      };
    });

    const sectionResults = await Promise.all(sectionPromises);
    sectionResults.sort((a, b) => a.index - b.index);
    const fallbackSectionsCount = sectionResults.filter((sectionResult) => !sectionResult.success).length;

    sectionResults.forEach((sectionResult) => {
      if (sectionResult.success && Array.isArray(sectionResult.blocks) && sectionResult.blocks.length > 0) {
        allBlocks.push(...sectionResult.blocks);
      } else {
        const plannedSection = strategyPlan.sections[sectionResult.index];
        const plannedFallbackBlocks =
          Array.isArray(plannedSection?.blocks) && plannedSection.blocks.length > 0
            ? plannedSection.blocks
            : buildDenseSectionFallbackBlocks(
              sectionResult.title,
              sectionResult.index,
              strategyPlan.sections.length
            );

        const fallbackBlocks = plannedFallbackBlocks.map((block) =>
          buildFallbackBlock(
            normalizeType(block?.type),
            safeTopic,
            block?.purpose || plannedSection?.title || sectionResult.title,
            safeDefaultCodeLanguage
          )
        );

        allBlocks.push(...fallbackBlocks);

        sectionFailures.push({
          title: sectionResult.title,
          reason: sectionResult.reason || 'Unknown error',
        });
      }
    });
    if (sectionFailures.length > 0) {
      console.warn(`Section generation summary: ${sectionFailures.length}/${strategyPlan.sections.length} sections failed`, sectionFailures);
    }

    // Assemble the accumulated blocks into the format the normalizer expects
    const rawFullLesson = {
      title: structurePlan.lessonTitle || `Lesson on ${safeTopic}`,
      blocks: allBlocks
    };

    let lessonData = normalizeFinalLessonData(rawFullLesson, structurePlan, strategyPlan, safeTopic, {
      defaultCodeLanguage: safeDefaultCodeLanguage,
      rejectInvalidSimulation: true,
    });

    const verificationResult = await verifyAndRepairGeneratedLesson({
      lessonData,
      researchBundle,
      topic: safeTopic,
      options: {
        allowVisualPlaceholders: true,
        allowHttpImageUrls: false,
        enableStrictEvidenceRewrite: false,
      },
    });
    lessonData = verificationResult?.lessonData || lessonData;

    const verifierWarnings = Array.isArray(verificationResult?.warnings)
      ? verificationResult.warnings
      : [];

    const visualApplication = applyVisualPlaceholdersToLesson({
      lessonData,
      visualCatalog,
    });
    lessonData = visualApplication?.lessonData || lessonData;
    const visualInsertionWarnings = Array.isArray(visualApplication?.warnings)
      ? visualApplication.warnings
      : [];
    const visualAttributions = Array.isArray(visualApplication?.attributions)
      ? visualApplication.attributions
      : [];
    const usedVisualIds = new Set(
      Array.isArray(visualApplication?.usedVisualIds) ? visualApplication.usedVisualIds : []
    );
    const visualSources = (visualCatalog || []).map((visual) => {
      const safeUrl = String(visual?.url || '');
      const isDataUrl = safeUrl.startsWith('data:image/');
      return {
        id: visual?.id || '',
        origin: visual?.origin || '',
        title: visual?.title || '',
        alt: visual?.alt || '',
        license: visual?.license || '',
        author: visual?.author || '',
        sourcePageUrl: visual?.sourcePageUrl || '',
        url: isDataUrl ? 'data:image/*;base64,<omitted>' : safeUrl,
        used: usedVisualIds.has(String(visual?.id || '')),
        sectionHints: Array.isArray(visual?.sectionHints) ? visual.sectionHints : [],
      };
    });

    const researchWarnings = [
      ...((researchBundle?.warnings || []).map((message) => ({
        type: 'research',
        message: String(message || ''),
      }))),
      ...referenceFileWarnings.map((message) => ({
        type: 'reference_file',
        message: String(message || ''),
      })),
      ...referenceImageWarnings.map((message) => ({
        type: 'reference_image',
        message: String(message || ''),
      })),
      ...referenceStructureWarnings.map((message) => ({
        type: 'reference_structure',
        message: String(message || ''),
      })),
      ...visualCatalogWarnings.map((message) => ({
        type: 'visual_catalog',
        message: String(message || ''),
      })),
      ...visualInsertionWarnings.map((message) => ({
        type: 'visual_insertion',
        message: String(message || ''),
      })),
      ...verifierWarnings.map((warning) => ({
        type: 'verification',
        ...warning,
      })),
    ];

    const generationMeta = {
      ...(lessonData._generationMeta || {}),
      classId: safeClassId || null,
      researchSources: compactResearchSources(researchBundle),
      researchUsage: sectionResearchUsage,
      researchWarnings,
      referenceFilesUsed: extractedReferenceFilesContext.filesUsed || [],
      referenceImagesUsed: normalizedReferenceImages.images.map((image) => ({
        name: image.name,
        mimeType: image.mimeType,
        source: image.source,
        sourceFile: image.sourceFile || '',
        sourcePage: image.sourcePage || null,
      })),
      referenceFileWarnings,
      referenceImageWarnings,
      referenceStructure: {
        source: referenceStructure?.source || 'none',
        headings: Array.isArray(referenceStructure?.headings) ? referenceStructure.headings : [],
      },
      visualSources,
      imageAttributions: visualAttributions,
      visualUsageBySection: sectionVisualUsage,
      researchCache: researchBundle?.cache || {
        cacheHit: false,
        cacheSource: 'none',
        generatedAt: new Date().toISOString(),
      },
    };

    // Attach generation metadata so the frontend can surface partial-failure warnings
    if (sectionFailures.length > 0) {
      generationMeta.totalSections = strategyPlan.sections.length;
      generationMeta.successfulSections = strategyPlan.sections.length - sectionFailures.length;
      generationMeta.fallbackSectionsCount = fallbackSectionsCount;
      generationMeta.failedSections = sectionFailures;
      generationMeta.warning = `${sectionFailures.length} of ${strategyPlan.sections.length} section(s) failed to generate and were replaced with fallback content.`;
    }
    lessonData._generationMeta = generationMeta;

    // Step 4: Generate Simulation Code (Two-Pass)
    if (lessonData.blocks && Array.isArray(lessonData.blocks)) {
      const simulationPromises = lessonData.blocks.map(async (block) => {
        if (block.type === 'INTERACTIVE_SIMULATION' && block.content) {
          try {
            const spec = block.content.design_spec || block.content.description;
            const files = await generateSimulationCode(spec, block.content.title, safeTopic);
            block.content.files = files;
            block.content.template = 'react';
          } catch (err) {
            console.error('Failed to generate simulation files in Step 4:', err);
          }
        }
      });
      await Promise.all(simulationPromises);
    }

    res.json(lessonData);
  } catch (err) {
    console.error('AI Generation Error:', err);

    if (err?.status === 401 || err?.status === 403) {
      return res.status(502).json({
        error:
          'AI provider rejected credentials. Verify your OpenRouter API key.',
      });
    }

    if (String(err?.message || '').includes('invalid JSON payload')) {
      return res.status(502).json({
        error:
          'AI provider returned malformed JSON. Please try generating again.',
      });
    }

    if (String(err?.message || '').includes('Invalid INTERACTIVE_SIMULATION payload')) {
      return res.status(502).json({
        error:
          'AI provider returned an invalid simulation payload. Please regenerate; simulation content must be Sandpack file JSON.',
      });
    }

    return res.status(500).json({
      error:
        'Failed to generate lesson with AI. Check backend logs for details.',
    });
  }
});

// Refine one lesson block with AI (Teacher only, affects only provided block content)
router.post('/:id/refine-block', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;
    const { blockType, blockContent, instructions } = req.body;
    const normalizedReferenceImages = normalizeRefineImageInputs(req.body?.referenceImages);

    if (normalizedReferenceImages.requestedCount > 0 && normalizedReferenceImages.images.length === 0) {
      return res.status(400).json({
        error:
          normalizedReferenceImages.warnings[0] ||
          'No valid reference images were provided for AI refinement.',
      });
    }

    if (normalizedReferenceImages.warnings.length > 0) {
      console.warn('Teacher refine image normalization warnings:', normalizedReferenceImages.warnings);
    }

    if (!ALLOWED_BLOCK_TYPES.has(blockType)) {
      return res.status(400).json({ error: 'Unsupported block type for AI refinement' });
    }

    if (!hasUsableAIConfig()) {
      return res.status(500).json({
        error:
          'AI service is not configured. Please supply OPENROUTER_API_KEY in backend/.env.',
      });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: { class: true },
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    if (isPersonalLesson(lesson)) {
      return res.status(403).json({ error: 'Only student owners can manage personal lesson forks' });
    }

    if (lesson.class.teacher_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (lesson.class.is_archived) {
      return res.status(400).json({ error: 'Cannot edit lessons in an archived class' });
    }

    const currentContent =
      typeof blockContent === 'object' ? JSON.stringify(blockContent, null, 2) : String(blockContent || '');

    const systemPrompt = `You are an expert curriculum editor helping a teacher improve exactly one lesson block.

Hard requirements:
1. Edit ONLY the provided block content.
2. Never reference other lesson blocks.
3. Keep the same blockType.
4. Keep output concise, classroom-ready, and aligned to teacher instructions.
5. Return ONLY valid JSON with this shape: {"content": ...}
6. If reference images are attached, use them as supplementary visual context, especially for simulation and Mermaid diagram refinements.

Block type schema rules:
- TEXT: content must be a string.
  CRITICAL FORMATTING: You MUST use textbook-style Markdown with visual hierarchy and spacing:
  - ## headings and ### subheadings
  - concise paragraphs with clear separation
  - bullet lists for grouped ideas
  - numbered lists for step-by-step procedures
  - **bold** key terms and *italic* emphasis where appropriate
  - definition callouts formatted as > [!DEFINITION] ... for core definitions
  Ensure the text is highly readable and well-structured.
- DISCUSSION: content must be a short discussion prompt string.
- CODE: content can be either:
  a) plain source code string, or
  b) notebook object: {"version":1,"language":"javascript","runtime":"browser-js","defaultLanguage":"python","code":"...","cells":[{"id":"...","title":"...","code":"..."}]}
- EXERCISE or QUIZ: content object with "question", "options" (array), and optional "timeLimit". Each option should keep "text", "isCorrect", and "feedback" when relevant.
- WRITTEN_QUIZ: content object with "question" and "idealAnswer".
- INTERACTIVE_SIMULATION: A self-contained, interactive React widget. 
  Must be an object with: "title", "description", "template", "files", "hint", "solutionText".
  STRICT RULES FOR "files":
  1. The "files" object MUST contain exactly two files: "/App.js" and "/styles.css".
  2. "/App.js" MUST start with \`import "./styles.css";\` and MUST have \`export default function App() { ... }\`.
  3. ALLOWED DEPENDENCIES: You are encouraged to use \`lucide-react\` for icons, \`recharts\` for data visualization, and \`framer-motion\` for animations. 
  4. STRICT BAN: Do NOT import from any other external libraries. Implement custom logic manually using standard React hooks.
  5. Write clean, modern CSS in "/styles.css" using Flexbox/Grid so the UI looks professional.
  6. The code must be perfectly escaped for JSON.
  7. PERFORMANCE CRITICAL: If using \`recharts\` for dynamic simulation data tied to UI sliders, STRICTLY limit the data array to a maximum of 100 data points (e.g., adjust your math loop steps and delta time accordingly). Generating more than 100 data points will cause React SVG rendering to crash the browser.
- MERMAID_DIAGRAM: object with exactly one key "code" containing valid Mermaid.js syntax (e.g., "graph TD; A-->B;").
- STATIC_CHART: object with "chartType" (must be "bar", "line", or "pie"), "title", "dataKey" (the key used for the y-axis values), and "data" (an array of objects containing a "name" string and numeric values matching the dataKey).

Output must be JSON only, without markdown fences or commentary.`;

    const referenceImageSummary =
      normalizedReferenceImages.images.length > 0
        ? normalizedReferenceImages.images
          .map((image, index) => `${index + 1}. ${image.name} (${image.mimeType})`)
          .join('\n')
        : 'None';

    const userPrompt = `Lesson title: ${lesson.title}
Block type: ${blockType}
Teacher instructions: ${String(instructions || '').trim() || 'Improve clarity and quality while preserving intent.'}
Attached reference images: ${normalizedReferenceImages.images.length > 0 ? `${normalizedReferenceImages.images.length}` : '0'}
${referenceImageSummary}

Current block content:
${currentContent}`;

    const parsedPayload = await callVertexAIForJson({
      systemPrompt,
      userPrompt,
      imageInputs: normalizedReferenceImages.images,
    });

    const candidate = Object.prototype.hasOwnProperty.call(parsedPayload, 'content')
      ? parsedPayload.content
      : parsedPayload;

    const refinedContent = normalizeRefinedContent(blockType, blockContent, candidate, {
      topic: lesson.title,
    });

    return res.json({ content: refinedContent });
  } catch (err) {
    console.error('AI Refine Block Error:', err);

    if (err?.status === 401 || err?.status === 403) {
      return res.status(502).json({
        error:
          'AI provider rejected credentials. Verify your OpenRouter API key.',
      });
    }

    if (String(err?.message || '').includes('invalid JSON payload')) {
      return res.status(502).json({
        error:
          'AI provider returned malformed JSON. Please try refining again.',
      });
    }

    if (err?.name === 'AbortError' || String(err?.message || '').toLowerCase().includes('timed out')) {
      return res.status(504).json({
        error:
          'AI refinement timed out. Please retry with shorter or more focused instructions.',
      });
    }

    return res.status(500).json({
      error:
        'Failed to refine block with AI. Check backend logs for details.',
    });
  }
});

// Create basic empty lesson (Teacher only)
router.post('/', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { class_id, title } = req.body;
    const { userId } = req.user;

    const targetClass = await prisma.class.findUnique({
      where: { id: class_id },
    });

    if (!targetClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (targetClass.teacher_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (targetClass.is_archived) {
      return res.status(400).json({ error: 'Cannot create lessons in an archived class' });
    }

    const newLesson = await prisma.lesson.create({
      data: {
        class_id,
        title,
        created_by: userId,
        status: 'DRAFT'
      }
    });

    res.status(201).json(newLesson);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create lesson' });
  }
});

// Delete lesson (Teacher only, owner only)
router.delete('/:id', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: { class: true },
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    if (lesson.class.teacher_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (isPersonalLesson(lesson)) {
      return res.status(403).json({ error: 'Teacher cannot delete student personal lesson forks' });
    }

    await prisma.$transaction(async (tx) => {
      const sessions = await tx.quizSession.findMany({
        where: { lesson_id: id },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);

      if (sessionIds.length > 0) {
        await tx.quizResponse.deleteMany({
          where: {
            session_id: {
              in: sessionIds,
            },
          },
        });
      }

      await tx.quizSession.deleteMany({
        where: { lesson_id: id },
      });

      await tx.chatMessage.deleteMany({
        where: { lesson_id: id },
      });

      await tx.studentNote.deleteMany({
        where: { lesson_id: id },
      });

      await tx.studentPersonalBlock.deleteMany({
        where: { lesson_id: id },
      });

      await tx.lessonBlock.deleteMany({
        where: { lesson_id: id },
      });

      await tx.lesson.delete({
        where: { id },
      });
    });

    return res.json({ message: 'Lesson deleted successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete lesson' });
  }
});

// Update lesson (teacher global lessons; student personal forks)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, status, blocks } = req.body;
    const { userId, role } = req.user || {};

    if (!userId) {
      return res.status(401).json({ error: 'Invalid session. Please sign in again.' });
    }

    if (blocks !== undefined && !Array.isArray(blocks)) {
      return res.status(400).json({ error: 'blocks must be an array when provided' });
    }

    const sourceLesson = await prisma.lesson.findUnique({
      where: { id },
      include: { class: true },
    });

    if (!sourceLesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const classAuthorization = await authorizeClassAccess({
      classId: sourceLesson.class_id,
      userId,
      role,
    });
    if (classAuthorization.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (!classAuthorization.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let targetLesson = sourceLesson;

    if (role === 'TEACHER') {
      if (sourceLesson.class.teacher_id !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (!isGlobalLesson(sourceLesson)) {
        return res.status(403).json({ error: 'Teachers can only edit global class lessons' });
      }
      if (sourceLesson.class.is_archived) {
        return res.status(400).json({ error: 'Cannot edit lessons in an archived class' });
      }
    } else if (role === 'STUDENT') {
      if (isPersonalLesson(sourceLesson)) {
        if (sourceLesson.owner_student_id !== userId) {
          return res.status(403).json({ error: 'Access denied' });
        }
      } else {
        if (!isStudentVisibleLessonStatus(sourceLesson.status)) {
          return res.status(403).json({ error: 'Access denied' });
        }
        targetLesson = await prisma.$transaction((tx) =>
          findOrCreateStudentLessonFork(tx, sourceLesson, userId)
        );
      }
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    const hasStatusField = Object.prototype.hasOwnProperty.call(req.body || {}, 'status');
    const nextLessonStatus = hasStatusField ? normalizeLessonStatus(status) : targetLesson.status;
    if (role === 'TEACHER' && hasStatusField && !LESSON_STATUSES.has(nextLessonStatus)) {
      return res.status(400).json({
        error: 'status must be one of: DRAFT, PUBLISHED, LIVE',
      });
    }

    const existingBlocks = await prisma.lessonBlock.findMany({
      where: { lesson_id: targetLesson.id },
      orderBy: { order_index: 'asc' },
    });
    const existingById = new Map(existingBlocks.map((block) => [block.id, block]));

    let normalizedIncomingBlocks =
      blocks === undefined
        ? null
        : blocks.map((block, index) => normalizeIncomingLessonBlockPayload(block, index));

    const shouldRebindStudentAutoForkBlockIds =
      role === 'STUDENT' &&
      isGlobalLesson(sourceLesson) &&
      targetLesson.id !== sourceLesson.id;

    if (normalizedIncomingBlocks && shouldRebindStudentAutoForkBlockIds) {
      normalizedIncomingBlocks = normalizedIncomingBlocks.map((block, index) => ({
        ...block,
        id: existingBlocks[index]?.id || '',
      }));
    }

    if (normalizedIncomingBlocks) {
      const incomingExistingIds = normalizedIncomingBlocks
        .map((block) => block.id)
        .filter(Boolean);
      const incomingExistingIdSet = new Set(incomingExistingIds);
      if (incomingExistingIdSet.size !== incomingExistingIds.length) {
        return res.status(400).json({ error: 'Duplicate lesson block ids are not allowed' });
      }
      const unknownExistingIds = incomingExistingIds.filter((blockId) => !existingById.has(blockId));
      if (unknownExistingIds.length > 0) {
        return res.status(400).json({ error: 'One or more block ids do not belong to this lesson' });
      }
    }

    const nextTitle =
      title !== undefined
        ? String(title || '').trim() || targetLesson.title
        : targetLesson.title;

    const updatedLesson = await prisma.$transaction(async (tx) => {
      await tx.lesson.update({
        where: { id: targetLesson.id },
        data: {
          title: nextTitle,
          ...(role === 'TEACHER' ? { status: nextLessonStatus } : {}),
        },
      });

      if (normalizedIncomingBlocks) {
        const retainedBlockIds = new Set();

        for (let index = 0; index < normalizedIncomingBlocks.length; index += 1) {
          const block = normalizedIncomingBlocks[index];

          if (block.id && existingById.has(block.id)) {
            retainedBlockIds.add(block.id);
            const original = existingById.get(block.id);
            await tx.lessonBlock.update({
              where: { id: block.id },
              data: {
                type: block.type,
                content: serializeBlockContent(block.content),
                order_index: index,
                is_post_publish_addition:
                  Boolean(original?.is_post_publish_addition) ||
                  Boolean(block.is_post_publish_addition),
              },
            });
            continue;
          }

          const createdBlock = await tx.lessonBlock.create({
            data: {
              lesson_id: targetLesson.id,
              type: block.type,
              content: serializeBlockContent(block.content),
              order_index: index,
              is_post_publish_addition: Boolean(block.is_post_publish_addition),
            },
          });
          retainedBlockIds.add(createdBlock.id);
        }

        const retained = Array.from(retainedBlockIds);
        await tx.lessonBlock.deleteMany({
          where: {
            lesson_id: targetLesson.id,
            ...(retained.length > 0 ? { id: { notIn: retained } } : {}),
          },
        });
      }

      return tx.lesson.findUnique({
        where: { id: targetLesson.id },
        include: {
          class: true,
          blocks: {
            orderBy: { order_index: 'asc' },
          },
        },
      });
    });

    return res.json(updatedLesson);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update lesson' });
  }
});

module.exports = router;


