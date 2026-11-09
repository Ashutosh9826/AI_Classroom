const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/authMiddleware');
const { hasUsableAIConfig, callOpenRouter, callOpenRouterForJson, getModel } = require('../services/openrouter');

const prisma = new PrismaClient();
const STUDENT_VISIBLE_LESSON_STATUSES = new Set(['PUBLISHED', 'LIVE']);
const normalizeLessonStatus = (value) => String(value || '').trim().toUpperCase();

const CHAT_MODEL = getModel();
const CHAT_MAX_BLOCK_SUMMARY_CHARS = 900;
const CHAT_MAX_CONTEXT_CHARS = 12000;
const CHAT_MAX_BLOCKS_IN_CONTEXT = 24;
const CHAT_MAX_HISTORY_MESSAGES = 16;
const CHAT_MAX_HISTORY_MESSAGE_CHARS = 1000;
const CHAT_MAX_QUESTION_CHARS = 2000;

const truncateText = (value, maxChars) => {
  const safeText = String(value || '');
  const safeMax = Math.max(24, Number(maxChars) || 0);
  if (safeText.length <= safeMax) return safeText;
  return `${safeText.slice(0, safeMax - 3).trimEnd()}...`;
};


const createTimeoutError = () => {
  const timeoutError = new Error('Chat request timed out. Please retry.');
  timeoutError.name = 'TimeoutError';
  return timeoutError;
};

const runWithTimeout = async (promiseFactory, timeoutMs = 12000) => {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await promiseFactory(controller.signal);
  } catch (err) {
    if (didTimeout) {
      throw createTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
};

const awaitStreamWithAbort = async ({ chat, message, signal, isClientDisconnected }) => {
  const streamPromise = chat.sendMessageStream({ message });
  streamPromise.catch(() => { });

  while (true) {
    if (signal?.aborted) {
      const abortError = new Error('AbortError');
      abortError.name = 'AbortError';
      throw abortError;
    }

    if (isClientDisconnected?.()) {
      const clientAbortError = new Error('ClientAbortError');
      clientAbortError.name = 'ClientAbortError';
      throw clientAbortError;
    }

    const settled = await Promise.race([
      streamPromise
        .then((stream) => ({ done: true, stream }))
        .catch((error) => ({ done: true, error, failed: true })),
      new Promise((resolve) => setTimeout(() => resolve({ done: false }), 40)),
    ]);

    if (!settled.done) {
      continue;
    }

    if (settled.failed) {
      throw settled.error;
    }

    return settled.stream;
  }
};

const authorizeLessonAccess = async ({ lessonId, userId, role }) => {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      class: {
        select: {
          id: true,
          teacher_id: true,
        },
      },
      blocks: {
        orderBy: { order_index: 'asc' },
      },
    },
  });

  if (!lesson) {
    return { lesson: null, allowed: false, notFound: true };
  }

  if (role === 'TEACHER') {
    return {
      lesson,
      allowed: lesson.class.teacher_id === userId,
      notFound: false,
    };
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      class_id: lesson.class_id,
      user_id: userId,
    },
    select: { id: true },
  });

  return {
    lesson,
    allowed:
      Boolean(enrollment) && STUDENT_VISIBLE_LESSON_STATUSES.has(normalizeLessonStatus(lesson.status)),
    notFound: false,
  };
};

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

const summarizeBlockContent = (block) => {
  const type = String(block?.type || '').toUpperCase();
  const raw = block?.content;

  if (type === 'TEXT' || type === 'DISCUSSION') {
    return String(raw || '');
  }

  if (type === 'CODE') {
    const parsed = toObjectOrNull(raw);
    if (parsed) {
      const language = parsed.defaultLanguage || parsed.language || 'javascript';
      const code = typeof parsed.code === 'string' ? parsed.code : '';
      return `Code (${language}):\n${code}`;
    }
    return `Code:\n${String(raw || '')}`;
  }

  const parsed = toObjectOrNull(raw);
  if (!parsed) {
    return String(raw || '');
  }

  if (type === 'QUIZ' || type === 'EXERCISE') {
    return `Question: ${parsed.question || ''}\nOptions: ${(parsed.options || [])
      .map((opt, idx) => `${idx + 1}. ${opt?.text || ''}`)
      .join(' | ')}`;
  }

  if (type === 'WRITTEN_QUIZ') {
    return `Question: ${parsed.question || ''}\nIdeal answer: ${parsed.idealAnswer || ''}`;
  }

  if (type === 'INTERACTIVE_SIMULATION') {
    return `Simulation: ${parsed.title || 'Untitled'}\nDescription: ${parsed.description || ''}`;
  }

  return truncateText(JSON.stringify(parsed), CHAT_MAX_BLOCK_SUMMARY_CHARS);
};

const compileLessonContext = (lesson) => {
  if (!lesson) {
    return 'No lesson context available.';
  }

  const titlePrefix = `Lesson title: ${lesson.title}\n\n`;
  const blockSummaries = [];
  let contextLength = titlePrefix.length;
  let truncated = false;
  const sourceBlocks = Array.isArray(lesson.blocks) ? lesson.blocks : [];
  const blocks = sourceBlocks.slice(0, CHAT_MAX_BLOCKS_IN_CONTEXT);

  if (sourceBlocks.length > blocks.length) {
    truncated = true;
  }

  blocks.forEach((block, index) => {
    const summary = truncateText(summarizeBlockContent(block), CHAT_MAX_BLOCK_SUMMARY_CHARS);
    const chunk = `[Block ${index + 1} - ${block.type}]\n${summary}`;
    const projectedLength = contextLength + chunk.length + (blockSummaries.length > 0 ? 2 : 0);

    if (projectedLength > CHAT_MAX_CONTEXT_CHARS) {
      truncated = true;
      return;
    }

    blockSummaries.push(chunk);
    contextLength = projectedLength;
  });

  let context = `${titlePrefix}${blockSummaries.join('\n\n') || 'No blocks in lesson.'}`;
  if (truncated) {
    const marker = '\n\n[Context truncated for latency. Ask follow-up questions if you need details from omitted blocks.]';
    context = `${truncateText(context, Math.max(200, CHAT_MAX_CONTEXT_CHARS - marker.length))}${marker}`;
  }
  return context;
};

const mapClientMessageRole = (message) => {
  const rawRole = String(message?.role || '')
    .trim()
    .toUpperCase();

  if (rawRole === 'ASSISTANT' || rawRole === 'SYSTEM') {
    return 'assistant';
  }

  if (rawRole === 'USER') {
    return 'user';
  }

  const sender = String(message?.sender || '')
    .trim()
    .toLowerCase();
  if (sender.includes('assistant') || sender === 'system' || sender === 'ai') {
    return 'assistant';
  }

  return 'user';
};

const buildSystemPrompt = ({ lessonContext }) => {
  return `You are the Academic Atelier AI tutor for university-level students.

Use the provided lesson context as your primary source. 

Rules:
1. Keep explanations rigorous, concise, and conceptually precise.
2. Prefer guided reasoning over directly giving away graded answers.
3. Answer primarily from the lesson context and general academic knowledge.
4. You have access to Google Search retrieval. Use it seamlessly when you need real-time information, news, or context outside of the provided lesson.
5. If you use web search, cite your sources.
6. If the web search returns no results, or if you simply do not know the answer based on the available context, explicitly state that you do not have enough information to answer. Never output an empty string.

Lesson Context:
${lessonContext}`;
};

// Send message to AI Tutor
router.post('/message', authenticateToken, async (req, res) => {
  let clientDisconnected = false;
  const handleClientAbort = () => {
    clientDisconnected = true;
  };

  req.on('close', handleClientAbort);
  req.on('aborted', handleClientAbort);

  try {
    const { lessonId, messages } = req.body;

    if (!hasUsableAIConfig()) {
      return res.status(500).json({ error: 'AI config is missing (OPENROUTER_API_KEY)' });
    }

    const safeMessages = Array.isArray(messages) ? messages : [];

    let lesson = null;
    if (lessonId && lessonId !== 'demo-lesson') {
      const auth = await authorizeLessonAccess({
        lessonId,
        userId: req.user.userId,
        role: req.user.role,
      });

      if (auth.notFound) {
        return res.status(404).json({ error: 'Lesson not found' });
      }

      if (!auth.allowed) {
        return res.status(403).json({ error: 'Access denied' });
      }

      lesson = auth.lesson;
    }

    const lessonContext = compileLessonContext(lesson);

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.write(JSON.stringify({ type: 'status', message: 'Thinking...' }) + '\n');

    // Build OpenRouter messages array
    const openRouterMessages = [
      { role: 'system', content: buildSystemPrompt({ lessonContext }) },
    ];

    let latestQuestionText = '';
    const historySource = safeMessages.slice(
      Math.max(0, safeMessages.length - 1 - CHAT_MAX_HISTORY_MESSAGES),
      Math.max(0, safeMessages.length - 1)
    );

    // Build history excluding the latest user message
    for (let i = 0; i < historySource.length; i++) {
      const msg = historySource[i];
      const text = truncateText(String(msg?.text || '').trim(), CHAT_MAX_HISTORY_MESSAGE_CHARS);
      if (!text) continue;
      openRouterMessages.push({
        role: mapClientMessageRole(msg) === 'assistant' ? 'assistant' : 'user',
        content: text,
      });
    }

    if (safeMessages.length > 0) {
      latestQuestionText = truncateText(
        String(safeMessages[safeMessages.length - 1]?.text || '').trim(),
        CHAT_MAX_QUESTION_CHARS
      );
    }

    if (!latestQuestionText) {
      res.write(JSON.stringify({ type: 'result', text: 'Please provide a message.' }) + '\n');
      return res.end();
    }

    openRouterMessages.push({ role: 'user', content: latestQuestionText });

    await runWithTimeout(async (signal) => {
      if (signal.aborted || clientDisconnected) {
        return;
      }

      const responseText = await callOpenRouter({
        messages: openRouterMessages,
        temperature: 0.7,
        timeoutMs: 40000,
      });

      let finalResponseText = String(responseText || '').trim();
      if (!finalResponseText) {
        finalResponseText = "I don't have enough information to answer that right now.";
      }

      if (clientDisconnected || res.writableEnded) {
        return;
      }

      res.write(JSON.stringify({
        type: 'result',
        text: finalResponseText,
        usedWebContext: false,
        webContext: [],
      }) + '\n');
    }, 45000);

    if (!clientDisconnected && !res.writableEnded) {
      return res.end();
    }
    return;
  } catch (err) {
    console.error('Chat AI Error:', err);
    const isTimeout = err?.name === 'TimeoutError';
    const isClientAbort = err?.name === 'ClientAbortError';
    const isAbortError = err?.name === 'AbortError' || err?.message === 'AbortError';

    if (isClientAbort || clientDisconnected) {
      return;
    }

    if (!res.headersSent) {
      if (isTimeout || isAbortError) {
        return res.status(504).json({ error: 'Chat request timed out. Please retry.' });
      }
      return res.status(500).json({ error: 'Failed to get AI response' });
    } else {
      if (res.writableEnded) {
        return;
      }
      res.write(JSON.stringify({
        type: 'error',
        message: isTimeout || isAbortError ? 'Chat request timed out. Please retry.' : err?.message || 'Failed to get AI response',
      }) + '\n');
      return res.end();
    }
  } finally {
    req.off('close', handleClientAbort);
    req.off('aborted', handleClientAbort);
  }
});

// Evaluate student written answer
router.post('/evaluate-answer', authenticateToken, async (req, res) => {
  try {
    const { question, idealAnswer, studentAnswer } = req.body;

    if (!hasUsableAIConfig()) {
      return res.status(500).json({ error: 'AI config is missing (OPENROUTER_API_KEY)' });
    }

    const systemPrompt = `You are a strict but fair university professor evaluating a student's answer.
Question: "${question}"
Ideal Answer: "${idealAnswer}"
Student Answer: "${studentAnswer}"

Provide a score out of 10 based on conceptual accuracy, depth of reasoning, and alignment with the ideal answer. First, provide concise but academically rigorous feedback. Then, on a new line at the very end, write strictly "SCORE: X/10" where X is the score (decimals allowed, e.g. 8.5).`;

    const replyText = await callOpenRouter({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Evaluate the student answer above.` },
      ],
      temperature: 0.3,
    });

    const safeReply = String(replyText || '').trim();
    const scoreMatch = safeReply.match(/SCORE:\s*([\d.]+)\/10/i);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;

    return res.json({ feedback: safeReply, score });
  } catch (err) {
    console.error('Evaluate AI Error:', err);
    return res.status(500).json({ error: 'Failed to evaluate answer' });
  }
});

module.exports = router;
