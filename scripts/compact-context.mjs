import fs from 'node:fs';
import path from 'node:path';

const contextPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(process.cwd(), 'PROJECT_CONTEXT.md');

const MAX_CHARS = 8000;
const MAX_ENTRIES = 8;
const MAX_BULLETS_PER_ENTRY = 6;
const MAX_WORDS_PER_BULLET = 20;

function trimBullet(line) {
  const prefixMatch = line.match(/^(\s*[-*]\s+)/);
  if (!prefixMatch) return line;
  const prefix = prefixMatch[1];
  const words = line.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  if (words.length <= MAX_WORDS_PER_BULLET) return line.trimEnd();
  return `${prefix}${words.slice(0, MAX_WORDS_PER_BULLET).join(' ')}...`;
}

function compactEntry(entryText) {
  const lines = entryText.split('\n');
  let bulletCount = 0;
  const out = [];

  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      bulletCount += 1;
      if (bulletCount <= MAX_BULLETS_PER_ENTRY) {
        out.push(trimBullet(line));
      }
      continue;
    }
    out.push(line);
  }

  return out.join('\n').trimEnd();
}

function parseSessionEntries(logBlock) {
  const cleaned = logBlock.trim();
  if (!cleaned) return [];

  const entries = cleaned
    .split(/\n(?=###\s+)/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter((chunk) => chunk.startsWith('### '));

  return entries;
}

if (!fs.existsSync(contextPath)) {
  console.error(`Context file not found: ${contextPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(contextPath, 'utf8');
const startMarker = '<!-- SESSION_LOG_START -->';
const endMarker = '<!-- SESSION_LOG_END -->';
const startIdx = raw.indexOf(startMarker);
const endIdx = raw.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  console.error('Session log markers missing or invalid in PROJECT_CONTEXT.md');
  process.exit(1);
}

const before = raw.slice(0, startIdx + startMarker.length);
const between = raw.slice(startIdx + startMarker.length, endIdx);
const after = raw.slice(endIdx);

const logHeaderMatch = between.match(/\n## Session Log\s*\n/i);
const header = logHeaderMatch ? '\n## Session Log\n\n' : '\n';
const entriesRaw = between.replace(/\n## Session Log\s*\n/i, '').trim();

let entries = parseSessionEntries(entriesRaw).map(compactEntry);
if (entries.length > MAX_ENTRIES) {
  entries = entries.slice(entries.length - MAX_ENTRIES);
}

let rebuiltLog = `${header}${entries.join('\n\n')}\n`;
let rebuilt = `${before}${rebuiltLog}${after}`;

while (rebuilt.length > MAX_CHARS && entries.length > 1) {
  entries = entries.slice(1);
  rebuiltLog = `${header}${entries.join('\n\n')}\n`;
  rebuilt = `${before}${rebuiltLog}${after}`;
}

if (rebuilt !== raw) {
  fs.writeFileSync(contextPath, rebuilt, 'utf8');
  console.log(`Compacted: ${path.relative(process.cwd(), contextPath)}`);
} else {
  console.log('No compaction changes needed.');
}
