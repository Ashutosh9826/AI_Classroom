/**
 * OpenRouter API helper — drop-in replacement for Google Vertex AI.
 *
 * Provides a unified interface that both lessons.js and chat.js consume
 * for text generation and JSON-structured output via the OpenRouter
 * OpenAI-compatible chat completions endpoint.
 */

const axios = require('axios');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

const getApiKey = () => String(process.env.OPENROUTER_API_KEY || '').trim();
const getModel = () =>
  String(process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free').trim();

/**
 * Check whether the OpenRouter API key is configured.
 */
const hasUsableAIConfig = () => {
  const key = getApiKey();
  return Boolean(key && key !== 'replace_me');
};

/**
 * Call OpenRouter chat completions endpoint.
 *
 * @param {object} options
 * @param {Array<{role: string, content: string}>} options.messages
 * @param {number} [options.temperature=0.7]
 * @param {boolean} [options.jsonMode=false]  — request JSON output
 * @param {boolean} [options.stream=false]     — return raw axios response for streaming
 * @param {number} [options.timeoutMs=120000]
 * @returns {Promise<string>} The assistant's response text.
 */
const callOpenRouter = async ({
  messages,
  temperature = 0.7,
  jsonMode = false,
  stream = false,
  timeoutMs = 120000,
}) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured (OPENROUTER_API_KEY).');
  }

  const body = {
    model: getModel(),
    messages,
    temperature,
    stream,
  };

  // Some free models may not support response_format, but we request it
  // and handle gracefully if the model ignores it.
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'http://localhost:8080',
    'X-Title': 'AI Tutor Local Dev',
  };

  if (stream) {
    // Return the raw response for streaming consumption
    const response = await axios.post(OPENROUTER_BASE_URL, body, {
      headers,
      timeout: timeoutMs,
      responseType: 'stream',
    });
    return response;
  }

  const response = await axios.post(OPENROUTER_BASE_URL, body, {
    headers,
    timeout: timeoutMs,
  });

  const data = response.data;

  if (!data?.choices?.[0]?.message?.content) {
    const preview = JSON.stringify(data).slice(0, 300);
    throw new Error(`OpenRouter returned unexpected response shape: ${preview}`);
  }

  return data.choices[0].message.content;
};

/**
 * Call OpenRouter and parse the result as JSON.
 * Includes one automatic retry with a stronger instruction if the first
 * attempt returns malformed JSON.
 *
 * @param {object} options
 * @param {string} options.systemPrompt
 * @param {string} options.userPrompt
 * @param {number} [options.temperature=0.2]
 * @returns {Promise<object>} Parsed JSON object.
 */
const callOpenRouterForJson = async ({ systemPrompt, userPrompt, temperature = 0.2 }) => {
  const requestOnce = async (prompt) => {
    const text = await callOpenRouter({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature,
      jsonMode: true,
    });
    return text;
  };

  let content = await requestOnce(userPrompt);
  let parsed = tryParseJson(content);
  if (parsed && typeof parsed === 'object') {
    return parsed;
  }

  // Retry with a stronger instruction
  const retryPrompt = `${userPrompt}\n\nIMPORTANT: Return ONLY valid JSON that exactly matches the required schema. Do not include markdown fences. Do not include explanatory text before or after the JSON.`;
  const retryContent = await requestOnce(retryPrompt);
  parsed = tryParseJson(retryContent);
  if (parsed && typeof parsed === 'object') {
    return parsed;
  }

  const firstPreview = String(content || '').slice(0, 240);
  const retryPreview = String(retryContent || '').slice(0, 240);
  console.warn('OpenRouter JSON parse failed after retry', { firstPreview, retryPreview });
  throw new Error('OpenRouter returned invalid JSON payload');
};

/**
 * Attempt to parse a string as JSON, stripping markdown fences and
 * extracting balanced JSON objects if needed.
 */
const tryParseJson = (text) => {
  if (!text || typeof text !== 'string') return null;

  // Strip UTF-8 BOM
  let cleaned = text.replace(/^\uFEFF/, '').trim();

  // Direct parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // continue
  }

  // Strip markdown fences
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fenceRegex.exec(cleaned)) !== null) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      // continue
    }
  }

  // Find first { or [ and try to extract balanced JSON
  const startIdx = Math.min(
    cleaned.indexOf('{') === -1 ? Infinity : cleaned.indexOf('{'),
    cleaned.indexOf('[') === -1 ? Infinity : cleaned.indexOf('[')
  );
  if (startIdx === Infinity) return null;

  const candidate = extractBalancedJson(cleaned, startIdx);
  if (candidate) {
    try {
      return JSON.parse(candidate);
    } catch {
      // fall through
    }
  }

  return null;
};

/**
 * Extract a balanced JSON substring from a string starting at the given index.
 */
const extractBalancedJson = (text, start) => {
  const openChar = text[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === openChar) depth++;
    if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
};

module.exports = {
  hasUsableAIConfig,
  callOpenRouter,
  callOpenRouterForJson,
  tryParseJson,
  getModel,
};
