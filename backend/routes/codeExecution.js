const express = require('express');
const axios = require('axios');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

const PISTON_URL = process.env.PISTON_URL;
const JUDGE0_URL = process.env.JUDGE0_URL || 'https://ce.judge0.com';

const LANGUAGE_ALIASES = {
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

const JUDGE0_LANGUAGE_IDS = {
  javascript: 63,
  python: 71,
  c: 50,
  cpp: 54,
  java: 62,
  php: 68,
};

const normalizeLanguage = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  return LANGUAGE_ALIASES[raw] || null;
};

const toText = (value) => (typeof value === 'string' ? value : '');

const isPistonInfrastructureFailure = (executionResult) => {
  const compile = executionResult?.compile || {};
  const run = executionResult?.run || {};
  const combined = [compile.stderr, run.stderr, run.message, run.output]
    .filter(Boolean)
    .join('\n');

  return /cannot run proxy|operation not permitted|clone failed/i.test(combined);
};

const executeWithPiston = async (language, code) => {
  if (!PISTON_URL) {
    throw new Error('PISTON_URL_MISSING');
  }

  const payload = {
    language,
    version: '*',
    files: [{ content: code }],
  };

  const pistonResponse = await axios.post(`${PISTON_URL}/api/v2/execute`, payload, {
    timeout: 25000,
    headers: { 'Content-Type': 'application/json' },
  });

  const executionResult = pistonResponse?.data || {};
  if (isPistonInfrastructureFailure(executionResult)) {
    const err = new Error('PISTON_INFRA_UNAVAILABLE');
    err.pistonResult = executionResult;
    throw err;
  }

  const compile = executionResult.compile || {};
  const run = executionResult.run || {};

  const compileOutput = [compile.stdout, compile.stderr].filter(Boolean).join('\n').trim();
  const runtimeOutput = [run.stdout, run.stderr].filter(Boolean).join('\n').trim();
  const output = [compileOutput, runtimeOutput].filter(Boolean).join('\n').trim();
  const hasFailure = Boolean(run.signal) || (typeof run.code === 'number' && run.code !== 0);

  return {
    provider: 'piston',
    language,
    output: output || 'Execution completed with no output.',
    stdout: toText(run.stdout),
    stderr: [compile.stderr, run.stderr].filter(Boolean).join('\n').trim(),
    compile_output: compileOutput,
    code: run.code,
    signal: run.signal,
    isError: hasFailure,
  };
};

const executeWithJudge0 = async (language, code) => {
  const languageId = JUDGE0_LANGUAGE_IDS[language];
  if (!languageId) {
    throw new Error('UNSUPPORTED_LANGUAGE_FOR_JUDGE0');
  }

  const judgePayload = {
    language_id: languageId,
    source_code: code,
  };

  const judgeResponse = await axios.post(
    `${JUDGE0_URL}/submissions?base64_encoded=false&wait=true`,
    judgePayload,
    {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const result = judgeResponse?.data || {};
  const stdout = toText(result.stdout);
  const compileOutput = toText(result.compile_output);
  const stderr = [result.stderr, result.message].filter(Boolean).join('\n').trim();
  const output = [stdout, compileOutput, stderr].filter(Boolean).join('\n').trim();
  const statusId = result?.status?.id;

  return {
    provider: 'judge0',
    language,
    output: output || 'Execution completed with no output.',
    stdout,
    stderr,
    compile_output: compileOutput,
    code: null,
    signal: null,
    isError: statusId !== 3,
    status: result?.status?.description || null,
    status_id: statusId || null,
  };
};

router.post('/', authenticateToken, async (req, res) => {
  try {
    const mappedAlias = normalizeLanguage(req.body?.language);
    const code = typeof req.body?.code === 'string' ? req.body.code : '';

    if (!mappedAlias) {
      return res.status(400).json({
        isError: true,
        output: 'Unsupported language. Use one of: JavaScript, Python, C, C++, Java, PHP.',
      });
    }

    if (!code.trim()) {
      return res.status(400).json({
        isError: true,
        output: 'Code is required.',
      });
    }

    if (code.length > 60000) {
      return res.status(400).json({
        isError: true,
        output: 'Code payload is too large.',
      });
    }

    let pistonError = null;
    if (PISTON_URL) {
      try {
        const pistonResult = await executeWithPiston(mappedAlias, code);
        return res.json(pistonResult);
      } catch (error) {
        pistonError = error;
      }
    }

    try {
      const judgeResult = await executeWithJudge0(mappedAlias, code);
      return res.json({
        ...judgeResult,
        fallback_used: Boolean(pistonError),
      });
    } catch (judgeError) {
      const details = [
        pistonError?.message ? `Piston: ${pistonError.message}` : null,
        judgeError?.response?.data?.message
          ? `Judge0: ${judgeError.response.data.message}`
          : null,
        judgeError?.message ? `Judge0: ${judgeError.message}` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      return res.status(502).json({
        isError: true,
        output: details || 'Unable to execute code right now.',
      });
    }
  } catch (error) {
    console.error('Code execution failed:', error?.message || error);

    if (error?.code === 'ECONNABORTED') {
      return res.status(504).json({
        isError: true,
        output: 'Execution timed out. Please simplify the program and retry.',
      });
    }

    const upstreamError =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.response?.statusText ||
      error?.message ||
      'Unable to execute code right now.';

    return res.status(502).json({
      isError: true,
      output: String(upstreamError),
    });
  }
});

module.exports = router;
