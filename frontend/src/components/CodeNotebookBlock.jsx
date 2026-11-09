import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { codeExecutionService } from '../services/api';

const CODE_MESSAGE_CHANNEL = 'code-notebook-v2';
const LANGUAGE_OPTIONS = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
  { value: 'php', label: 'PHP' },
];

const LANGUAGE_LABELS = LANGUAGE_OPTIONS.reduce((acc, language) => {
  acc[language.value] = language.label;
  return acc;
}, {});

const LANGUAGE_ALIAS = {
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

const BASE_CSS = `
:root {
  color-scheme: dark;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #0f172a;
  color: #e2e8f0;
  min-height: 100vh;
}
#output-container {
  padding: 12px 16px;
  font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.log { color: #e2e8f0; }
.warn { color: #fde68a; }
.error { color: #fca5a5; font-weight: 600; }
.info { color: #93c5fd; }
.time { color: #94a3b8; font-size: 11px; margin-top: 8px; }
.run { color: #38bdf8; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin: 6px 0; }
.table-wrap { overflow-x: auto; margin: 6px 0; }
.table-wrap table { border-collapse: collapse; font-size: 12px; min-width: 120px; }
.table-wrap th, .table-wrap td { border: 1px solid #334155; padding: 4px 8px; text-align: left; }
.table-wrap th { background: #1e293b; color: #7dd3fc; font-weight: 700; }
.table-wrap td { background: #0f172a; }
.html-output { margin: 8px 0; padding: 10px 12px; background: #f8fafc; color: #0f172a; border-radius: 8px; font-family: ui-sans-serif, system-ui; }
`;

const serializeForScript = (value) =>
  JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const normalizeRuntimeLanguage = (value) => {
  const alias = LANGUAGE_ALIAS[String(value || '').trim().toLowerCase()];
  return alias || 'javascript';
};

const getCellSeparator = (language) =>
  normalizeRuntimeLanguage(language) === 'python' ? '# %%' : '// %%';

const createCellId = () => `cell-${Math.random().toString(36).slice(2, 10)}`;

const splitLegacyStringIntoCells = (source) => {
  const text = String(source || '');
  if (!text.trim()) {
    return [{ id: createCellId(), title: 'Cell 1', code: '' }];
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
    id: createCellId(),
    title: `Cell ${index + 1}`,
    code: chunk,
  }));
};

const normalizeCell = (cell, index) => ({
  id: typeof cell?.id === 'string' && cell.id.trim() ? cell.id : createCellId(),
  title: typeof cell?.title === 'string' && cell.title.trim() ? cell.title.trim() : `Cell ${index + 1}`,
  code: typeof cell?.code === 'string' ? cell.code : '',
});

const cellsToCode = (cells = [], language = 'javascript') =>
  (cells || [])
    .map((cell) => String(cell?.code || ''))
    .join(`\n\n${getCellSeparator(language)}\n\n`);

const normalizeNotebookContent = (content) => {
  if (isObject(content) && (Array.isArray(content.cells) || typeof content.code === 'string')) {
    const normalizedCells = Array.isArray(content.cells)
      ? content.cells.map(normalizeCell)
      : splitLegacyStringIntoCells(content.code || '');
    const safeCells = normalizedCells.length > 0 ? normalizedCells : [normalizeCell({}, 0)];
    const defaultLanguage = normalizeRuntimeLanguage(content.defaultLanguage || content.language);
    return {
      version: 1,
      language: 'javascript',
      runtime: 'browser-js',
      defaultLanguage,
      code: typeof content.code === 'string' ? content.code : cellsToCode(safeCells, defaultLanguage),
      cells: safeCells,
    };
  }

  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(content);
        if (isObject(parsed) && Array.isArray(parsed.cells)) {
          return normalizeNotebookContent(parsed);
        }
      } catch {
        // Keep as legacy code string.
      }
    }

    return {
      version: 1,
      language: 'javascript',
      runtime: 'browser-js',
      defaultLanguage: 'javascript',
      code: content,
      cells: splitLegacyStringIntoCells(content),
    };
  }

  return {
    version: 1,
    language: 'javascript',
    runtime: 'browser-js',
    defaultLanguage: 'javascript',
    code: '',
    cells: [normalizeCell({}, 0)],
  };
};

const serializeNotebookContent = (notebook, selectedLanguage = 'javascript') => {
  const cells = (notebook?.cells || []).map((cell, index) => normalizeCell(cell, index));
  const code = cellsToCode(cells, selectedLanguage);
  return {
    version: 1,
    language: 'javascript',
    runtime: 'browser-js',
    defaultLanguage: normalizeRuntimeLanguage(selectedLanguage),
    code,
    cells,
  };
};

const buildSrcDoc = ({ executionPayload, runKey, instanceId }) => {
  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>${BASE_CSS}</style>
  </head>
  <body>
    <div id="output-container"></div>
    <script>
      (() => {
        const channel = "${CODE_MESSAGE_CHANNEL}";
        const runKey = ${Number(runKey) || 0};
        const instanceId = ${serializeForScript(instanceId)};
        const payload = ${serializeForScript(executionPayload)};
        const outputEl = document.getElementById('output-container');
        const startedAt = performance.now();

        const post = (type, extra = {}) => {
          try {
            window.parent.postMessage({ channel, type, runKey, instanceId, ...extra }, '*');
          } catch (err) {
            // no-op
          }
        };

        const appendText = (text, className = 'log') => {
          const row = document.createElement('div');
          row.className = className;
          row.textContent = text;
          outputEl.appendChild(row);
          post('output', { className, text });
        };

        const appendHtml = (markup) => {
          const row = document.createElement('div');
          row.className = 'html-output';
          row.innerHTML = String(markup || '');
          outputEl.appendChild(row);
          post('output', { className: 'html', text: String(markup || '') });
        };

        const formatValue = (value) => {
          if (value === undefined) return 'undefined';
          if (value === null) return 'null';
          if (typeof value === 'string') return value;
          if (typeof value === 'number' || typeof value === 'boolean') return String(value);
          try {
            return JSON.stringify(value, null, 2);
          } catch {
            return String(value);
          }
        };

        const renderTable = (value) => {
          if (!Array.isArray(value) || value.length === 0) {
            appendText(formatValue(value), 'log');
            return;
          }

          const keys = Object.keys(value[0] || {});
          const wrap = document.createElement('div');
          wrap.className = 'table-wrap';

          const table = document.createElement('table');
          const thead = document.createElement('thead');
          const headerRow = document.createElement('tr');

          const indexHead = document.createElement('th');
          indexHead.textContent = '(index)';
          headerRow.appendChild(indexHead);

          keys.forEach((key) => {
            const th = document.createElement('th');
            th.textContent = key;
            headerRow.appendChild(th);
          });

          thead.appendChild(headerRow);
          table.appendChild(thead);

          const tbody = document.createElement('tbody');
          value.forEach((rowValue, rowIndex) => {
            const tr = document.createElement('tr');

            const indexCell = document.createElement('td');
            indexCell.textContent = String(rowIndex);
            tr.appendChild(indexCell);

            keys.forEach((key) => {
              const td = document.createElement('td');
              td.textContent = formatValue(rowValue?.[key]);
              tr.appendChild(td);
            });

            tbody.appendChild(tr);
          });

          table.appendChild(tbody);
          wrap.appendChild(table);
          outputEl.appendChild(wrap);
        };

        const renderSimplePlot = (values, options = {}) => {
          if (!Array.isArray(values) || values.length === 0) {
            appendText('plot() expects an array of numbers.', 'warn');
            return;
          }

          const width = Number(options.width) > 0 ? Number(options.width) : 480;
          const height = Number(options.height) > 0 ? Number(options.height) : 180;
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.style.maxWidth = '100%';
          canvas.style.background = '#020617';
          canvas.style.border = '1px solid #334155';
          canvas.style.borderRadius = '8px';
          canvas.style.margin = '8px 0';

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            appendText('Canvas context unavailable.', 'error');
            return;
          }

          const numeric = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
          if (numeric.length === 0) {
            appendText('plot() received no numeric values.', 'warn');
            return;
          }

          const min = Math.min(...numeric);
          const max = Math.max(...numeric);
          const span = max - min || 1;

          ctx.clearRect(0, 0, width, height);
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, height - 24);
          ctx.lineTo(width, height - 24);
          ctx.stroke();

          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();

          numeric.forEach((value, index) => {
            const x = (index / Math.max(1, numeric.length - 1)) * (width - 24) + 12;
            const y = (height - 30) - ((value - min) / span) * (height - 50);
            if (index === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
            ctx.fillStyle = '#7dd3fc';
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fill();
          });

          ctx.stroke();
          outputEl.appendChild(canvas);
        };

        const resolveSpecifier = (specifier) => {
          const s = String(specifier || '').trim();
          if (!s) return s;
          if (/^(https?:|data:|blob:|\/|\.\.?\/)/i.test(s)) {
            return s;
          }
          return 'https://esm.sh/' + s.replace(/^\/+/, '') + '?bundle';
        };

        const normalizeNamedImports = (namedClause) => {
          return namedClause
            .split(',')
            .map((segment) => segment.trim())
            .filter(Boolean)
            .map((segment) => {
              const match = segment.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
              if (match) {
                return match[1] + ': ' + match[2];
              }
              return segment;
            })
            .join(', ');
        };

        const transformImports = (source) => {
          let moduleCounter = 0;
          let transformed = String(source || '');

          transformed = transformed.replace(/^\s*import\s+([^'";]+?)\s+from\s+['"]([^'"\n]+)['"]\s*;?\s*$/gm, (_full, clauseRaw, specRaw) => {
            const clause = clauseRaw.trim();
            const specifier = JSON.stringify(specRaw.trim());
            const moduleVar = '__mod_' + moduleCounter++;

            if (clause.startsWith('{') && clause.endsWith('}')) {
              const named = normalizeNamedImports(clause.slice(1, -1));
              return 'const ' + moduleVar + ' = await __import(' + specifier + ');\nconst { ' + named + ' } = ' + moduleVar + ';';
            }

            if (clause.startsWith('* as ')) {
              const namespaceVar = clause.replace(/^\*\s+as\s+/, '').trim();
              return 'const ' + namespaceVar + ' = await __import(' + specifier + ');';
            }

            const defaultAndNamedMatch = clause.match(/^([A-Za-z_$][\w$]*)\s*,\s*\{([\s\S]+)\}$/);
            if (defaultAndNamedMatch) {
              const defaultName = defaultAndNamedMatch[1].trim();
              const named = normalizeNamedImports(defaultAndNamedMatch[2]);
              return (
                'const ' +
                moduleVar +
                ' = await __import(' +
                specifier +
                ');\nconst ' +
                defaultName +
                ' = ' +
                moduleVar +
                '.default ?? ' +
                moduleVar +
                ';\nconst { ' +
                named +
                ' } = ' +
                moduleVar +
                ';'
              );
            }

            if (/^[A-Za-z_$][\w$]*$/.test(clause)) {
              return (
                'const ' +
                moduleVar +
                ' = await __import(' +
                specifier +
                ');\nconst ' +
                clause +
                ' = ' +
                moduleVar +
                '.default ?? ' +
                moduleVar +
                ';'
              );
            }

            return 'await __import(' + specifier + ');';
          });

          transformed = transformed.replace(/^\s*import\s+['"]([^'"\n]+)['"]\s*;?\s*$/gm, (_full, specRaw) => {
            return 'await __import(' + JSON.stringify(specRaw.trim()) + ');';
          });

          transformed = transformed.replace(/\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g, (_full, _quote, specRaw) => {
            return 'import(__resolve(' + JSON.stringify(specRaw.trim()) + '))';
          });

          transformed = transformed.replace(/^\s*export\s+default\s+/gm, 'const __default_export__ = ');
          transformed = transformed.replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '');
          transformed = transformed.replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, '$1 ');

          return transformed;
        };

        const runtime = {
          samples: {
            numbers: [2, 5, 9, 3, 7, 11],
            students: [
              { name: 'Ava', score: 92 },
              { name: 'Noah', score: 85 },
              { name: 'Mia', score: 96 },
            ],
          },
          display: (...values) => appendText(values.map(formatValue).join(' '), 'log'),
          print: (...values) => appendText(values.map(formatValue).join(' '), 'log'),
          info: (...values) => appendText(values.map(formatValue).join(' '), 'info'),
          warn: (...values) => appendText(values.map(formatValue).join(' '), 'warn'),
          error: (...values) => appendText(values.map(formatValue).join(' '), 'error'),
          html: (markup) => appendHtml(markup),
          table: (value) => renderTable(value),
          plot: (values, options) => renderSimplePlot(values, options),
          clear: () => {
            outputEl.innerHTML = '';
          },
          fetchJson: async (url, options = {}) => {
            const response = await fetch(url, options);
            return response.json();
          },
          importLib: async (specifier) => {
            return import(resolveSpecifier(specifier));
          },
        };

        window.runtime = runtime;
        window.display = runtime.display;
        window.print = runtime.print;
        window.table = runtime.table;
        window.html = runtime.html;
        window.plot = runtime.plot;

        const originalConsole = { ...console };
        console.log = (...args) => {
          originalConsole.log(...args);
          runtime.display(...args);
        };
        console.info = (...args) => {
          originalConsole.info(...args);
          runtime.info(...args);
        };
        console.warn = (...args) => {
          originalConsole.warn(...args);
          runtime.warn(...args);
        };
        console.error = (...args) => {
          originalConsole.error(...args);
          runtime.error(...args);
        };
        console.table = (value) => {
          originalConsole.table(value);
          runtime.table(value);
        };
        console.clear = () => {
          originalConsole.clear();
          runtime.clear();
        };

        window.addEventListener('error', (event) => {
          const message = event?.message || 'Runtime error';
          appendText(message, 'error');
          post('error', { message });
        });

        window.addEventListener('unhandledrejection', (event) => {
          const reason = event?.reason;
          const message = reason?.message || String(reason || 'Unhandled promise rejection');
          appendText(message, 'error');
          post('error', { message });
        });

        const runNotebook = async () => {
          const cells = Array.isArray(payload?.cells) ? payload.cells : [];
          const runMode = payload?.mode === 'cell' ? 'cell' : 'all';
          const rawIndex = Number(payload?.index);
          const index = Number.isFinite(rawIndex) ? Math.max(0, Math.min(rawIndex, Math.max(0, cells.length - 1))) : cells.length - 1;
          const lastCell = runMode === 'cell' ? index : cells.length - 1;

          if (cells.length === 0) {
            appendText('No code cells found.', 'warn');
            return;
          }

          appendText(runMode === 'cell' ? 'Running through cell ' + (lastCell + 1) : 'Running all cells', 'run');

          const combinedCode = cells
            .slice(0, lastCell + 1)
            .map((cell, cellIndex) => '// Cell ' + (cellIndex + 1) + '\n' + (cell?.code || ''))
            .join('\n\n');

          const transformedCode = transformImports(combinedCode);

          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          const execute = new AsyncFunction(
            'runtime',
            '__import',
            '__resolve',
            'display',
            'print',
            'html',
            'table',
            'plot',
            'fetchJson',
            transformedCode
          );

          const importFn = (specifier) => import(resolveSpecifier(specifier));
          await execute(runtime, importFn, resolveSpecifier, runtime.display, runtime.print, runtime.html, runtime.table, runtime.plot, runtime.fetchJson);
        };

        runNotebook()
          .then(() => {
            const elapsed = (performance.now() - startedAt).toFixed(1);
            appendText('Executed in ' + elapsed + 'ms', 'time');
            post('done', { elapsed });
          })
          .catch((error) => {
            const message = error?.message || String(error);
            appendText(message, 'error');
            post('error', { message, stack: error?.stack || '' });
          });
      })();
    <${'/'}script>
  </body>
</html>`;
};

const CellEditor = ({
  cell,
  index,
  editable,
  runtimeLanguage,
  onChangeCode,
  onChangeTitle,
  onRunCell,
  onMoveCell,
  onDeleteCell,
  totalCells,
}) => {
  const lineCount = Math.max(1, String(cell?.code || '').split('\n').length);

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      onRunCell(index);
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const target = event.target;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const value = target.value;
      const nextValue = `${value.slice(0, start)}  ${value.slice(end)}`;
      onChangeCode(index, nextValue);

      requestAnimationFrame(() => {
        target.selectionStart = start + 2;
        target.selectionEnd = start + 2;
      });
    }
  };

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/80 overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-900 border-b border-slate-700">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Cell {index + 1}</span>
          {editable ? (
            <input
              type="text"
              value={cell?.title || ''}
              onChange={(event) => onChangeTitle(index, event.target.value)}
              className="min-w-[120px] max-w-[220px] bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-[11px] font-semibold text-slate-200 outline-none focus:border-sky-400"
              placeholder={`Cell ${index + 1}`}
            />
          ) : (
            <span className="text-xs font-semibold text-slate-200 truncate">{cell?.title || `Cell ${index + 1}`}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onRunCell(index)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest bg-emerald-300 text-slate-900 hover:bg-emerald-200 transition-colors"
          >
            Run
          </button>

          {editable && (
            <>
              <button
                type="button"
                onClick={() => onMoveCell(index, -1)}
                disabled={index === 0}
                className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                title="Move up"
              >
                <span className="material-symbols-outlined text-sm">arrow_upward</span>
              </button>
              <button
                type="button"
                onClick={() => onMoveCell(index, 1)}
                disabled={index === totalCells - 1}
                className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                title="Move down"
              >
                <span className="material-symbols-outlined text-sm">arrow_downward</span>
              </button>
              <button
                type="button"
                onClick={() => onDeleteCell(index)}
                disabled={totalCells <= 1}
                className="inline-flex items-center justify-center w-7 h-7 rounded border border-rose-400/30 text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                title="Delete cell"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            </>
          )}
        </div>
      </header>

      <div className="relative">
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-10 bg-slate-950 border-r border-slate-700 text-right pr-2 pt-3 pointer-events-none select-none"
        >
          {Array.from({ length: lineCount }, (_, lineIndex) => (
            <div key={lineIndex} className="text-[11px] leading-6 font-mono text-slate-600">
              {lineIndex + 1}
            </div>
          ))}
        </div>
        <textarea
          value={cell?.code || ''}
          onChange={(event) => onChangeCode(index, event.target.value)}
          onKeyDown={handleKeyDown}
          readOnly={!editable}
          spellCheck={false}
          placeholder={`// Write ${LANGUAGE_LABELS[runtimeLanguage] || 'code'} here.`}
          className="w-full pl-12 pr-3 py-3 bg-transparent text-slate-100 text-sm leading-6 font-mono outline-none resize-y min-h-[96px]"
          style={{ minHeight: Math.max(96, lineCount * 24 + 24) }}
        />
      </div>
    </section>
  );
};

export default function CodeNotebookBlock({ content, code, onChange, editable = false, blockId }) {
  const rawContent = content !== undefined ? content : code;

  const notebook = useMemo(() => normalizeNotebookContent(rawContent), [rawContent]);

  const [selectedLanguage, setSelectedLanguage] = useState(
    normalizeRuntimeLanguage(notebook.defaultLanguage)
  );
  const [hasRun, setHasRun] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(null);
  const [hasError, setHasError] = useState(false);
  const [executionPayload, setExecutionPayload] = useState(null);
  const [outputMode, setOutputMode] = useState('browser');
  const [backendOutput, setBackendOutput] = useState('');

  const instanceId = useMemo(() => `code-${blockId || 'block'}`, [blockId]);

  useEffect(() => {
    setSelectedLanguage(normalizeRuntimeLanguage(notebook.defaultLanguage));
  }, [notebook.defaultLanguage]);

  const srcDoc = useMemo(() => {
    if (!hasRun || !executionPayload || outputMode !== 'browser') return null;
    return buildSrcDoc({ executionPayload, runKey, instanceId });
  }, [executionPayload, hasRun, instanceId, outputMode, runKey]);

  useEffect(() => {
    const handler = (event) => {
      const data = event?.data;
      if (!isObject(data) || data.channel !== CODE_MESSAGE_CHANNEL) return;
      if (data.instanceId !== instanceId || data.runKey !== runKey) return;

      if (data.type === 'done') {
        setIsRunning(false);
        setElapsed(data.elapsed || null);
        setHasError(false);
      }

      if (data.type === 'error') {
        setIsRunning(false);
        setHasError(true);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [instanceId, runKey]);

  const commitNotebook = useCallback(
    (nextNotebook, languageOverride = selectedLanguage) => {
      if (!onChange) return;
      onChange(serializeNotebookContent(nextNotebook, languageOverride));
    },
    [onChange, selectedLanguage]
  );

  const updateCellCode = useCallback(
    (cellIndex, nextCode) => {
      const nextNotebook = {
        ...notebook,
        cells: notebook.cells.map((cell, index) =>
          index === cellIndex ? { ...cell, code: nextCode } : cell
        ),
      };
      commitNotebook(nextNotebook);
    },
    [commitNotebook, notebook]
  );

  const updateCellTitle = useCallback(
    (cellIndex, nextTitle) => {
      const nextNotebook = {
        ...notebook,
        cells: notebook.cells.map((cell, index) =>
          index === cellIndex ? { ...cell, title: nextTitle } : cell
        ),
      };
      commitNotebook(nextNotebook);
    },
    [commitNotebook, notebook]
  );

  const addCell = useCallback(() => {
    const nextNotebook = {
      ...notebook,
      cells: [
        ...notebook.cells,
        {
          id: createCellId(),
          title: `Cell ${notebook.cells.length + 1}`,
          code: '',
        },
      ],
    };
    commitNotebook(nextNotebook);
  }, [commitNotebook, notebook]);

  const moveCell = useCallback(
    (cellIndex, direction) => {
      const targetIndex = cellIndex + direction;
      if (targetIndex < 0 || targetIndex >= notebook.cells.length) return;

      const nextCells = [...notebook.cells];
      const temp = nextCells[cellIndex];
      nextCells[cellIndex] = nextCells[targetIndex];
      nextCells[targetIndex] = temp;

      const nextNotebook = {
        ...notebook,
        cells: nextCells,
      };
      commitNotebook(nextNotebook);
    },
    [commitNotebook, notebook]
  );

  const deleteCell = useCallback(
    (cellIndex) => {
      if (notebook.cells.length <= 1) return;
      const nextNotebook = {
        ...notebook,
        cells: notebook.cells.filter((_cell, index) => index !== cellIndex),
      };
      commitNotebook(nextNotebook);
    },
    [commitNotebook, notebook]
  );

  const handleLanguageChange = useCallback(
    (event) => {
      const nextLanguage = normalizeRuntimeLanguage(event.target.value);
      setSelectedLanguage(nextLanguage);

      if (editable) {
        commitNotebook(
          {
            ...notebook,
            defaultLanguage: nextLanguage,
          },
          nextLanguage
        );
      }
    },
    [commitNotebook, editable, notebook]
  );

  const buildRuntimeCode = useCallback(
    (mode, index) => {
      const cells = notebook.cells || [];
      if (cells.length === 0) return '';
      const runtimeLanguage = normalizeRuntimeLanguage(selectedLanguage);

      if (mode === 'cell') {
        const target = Number.isFinite(Number(index))
          ? Math.max(0, Math.min(Number(index), cells.length - 1))
          : cells.length - 1;
        return cellsToCode(cells.slice(0, target + 1), runtimeLanguage);
      }

      return cellsToCode(cells, runtimeLanguage);
    },
    [notebook.cells, selectedLanguage]
  );

  const runNotebook = useCallback(
    async (mode, index = null) => {
      const runtimeLanguage = normalizeRuntimeLanguage(selectedLanguage);
      const payload = {
        cells: notebook.cells.map((cell) => ({ title: cell.title, code: cell.code })),
        mode,
        index,
      };

      setHasError(false);
      setElapsed(null);
      setIsRunning(true);
      setHasRun(true);

      if (runtimeLanguage === 'javascript') {
        setOutputMode('browser');
        setBackendOutput('');
        setExecutionPayload(payload);
        setRunKey((value) => value + 1);
        return;
      }

      try {
        setOutputMode('backend');
        setExecutionPayload(null);
        const startedAt = performance.now();
        const codeToRun = buildRuntimeCode(mode, index);
        const result = await codeExecutionService.execute({
          language: runtimeLanguage,
          code: codeToRun,
        });
        const elapsedMs = (performance.now() - startedAt).toFixed(1);
        setElapsed(elapsedMs);
        setBackendOutput(
          String(result?.output || result?.stdout || 'Execution completed with no output.')
        );
        setHasError(Boolean(String(result?.stderr || '').trim()));
      } catch (error) {
        const message =
          error?.response?.data?.detail ||
          error?.response?.data?.error ||
          error?.message ||
          'Execution failed.';
        setBackendOutput(String(message));
        setHasError(true);
      } finally {
        setIsRunning(false);
      }
    },
    [buildRuntimeCode, notebook.cells, selectedLanguage]
  );

  const clearOutput = useCallback(() => {
    setHasRun(false);
    setHasError(false);
    setElapsed(null);
    setIsRunning(false);
    setExecutionPayload(null);
    setBackendOutput('');
    setOutputMode(selectedLanguage === 'javascript' ? 'browser' : 'backend');
  }, [selectedLanguage]);

  return (
    <div className="rounded-xl overflow-hidden border border-slate-700 bg-slate-950 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-900 border-b border-slate-700">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-300 text-[10px] font-bold uppercase tracking-widest">
            {selectedLanguage === 'javascript' ? 'Browser Runtime' : 'Remote Runtime'}
          </span>
          <span className="text-[11px] font-semibold text-slate-400">
            {notebook.cells.length} cell{notebook.cells.length !== 1 ? 's' : ''}
          </span>
          <select
            value={selectedLanguage}
            onChange={handleLanguageChange}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[11px] font-semibold text-slate-200 outline-none focus:border-sky-400"
            aria-label="Runtime language"
          >
            {LANGUAGE_OPTIONS.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] font-semibold text-slate-500">
            Students can switch runtime language before execution
          </span>
        </div>

        <div className="flex items-center gap-2">
          {elapsed && !isRunning && <span className="text-[10px] font-mono text-slate-400">{elapsed}ms</span>}
          <button
            type="button"
            onClick={clearOutput}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-600 text-[11px] font-semibold text-slate-300 hover:bg-slate-800"
          >
            <span className="material-symbols-outlined text-sm">delete</span>
            Clear Output
          </button>
          {editable && (
            <button
              type="button"
              onClick={addCell}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-600 text-[11px] font-semibold text-slate-300 hover:bg-slate-800"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Add Cell
            </button>
          )}
          <button
            type="button"
            onClick={() => runNotebook('all', notebook.cells.length - 1)}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-300 text-slate-900 text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-200 disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-sm">play_arrow</span>
            {isRunning ? 'Running...' : 'Run All'}
          </button>
        </div>
      </header>

      <div className="p-3 space-y-3 bg-slate-950">
        {notebook.cells.map((cell, index) => (
          <CellEditor
            key={cell.id}
            cell={cell}
            index={index}
            editable={editable}
            runtimeLanguage={selectedLanguage}
            onChangeCode={updateCellCode}
            onChangeTitle={updateCellTitle}
            onRunCell={(cellIndex) => runNotebook('cell', cellIndex)}
            onMoveCell={moveCell}
            onDeleteCell={deleteCell}
            totalCells={notebook.cells.length}
          />
        ))}
      </div>

      <section className="border-t border-slate-700 bg-slate-900/90">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="material-symbols-outlined text-sm text-slate-400">terminal</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Output</span>
          {hasError && <span className="text-[10px] font-bold text-rose-300">Error detected</span>}
          {isRunning && <span className="text-[10px] font-bold text-sky-300">Running</span>}
          {!isRunning && hasRun && !hasError && (
            <span className="text-[10px] font-bold text-emerald-300">Completed</span>
          )}
        </div>

        {outputMode === 'browser' && srcDoc ? (
          <iframe
            key={`${instanceId}-${runKey}`}
            title="Notebook output"
            srcDoc={srcDoc}
            sandbox="allow-scripts"
            className="w-full"
            style={{ height: '260px', border: 0, background: '#0f172a' }}
          />
        ) : outputMode === 'backend' && hasRun ? (
          <pre className="px-4 pb-4 text-xs text-slate-200 whitespace-pre-wrap break-words">
            {backendOutput || 'Execution completed with no output.'}
          </pre>
        ) : (
          <div className="px-4 pb-4 text-xs text-slate-500">
            Run a cell or run all cells to see output here.
          </div>
        )}
      </section>

      <footer className="px-4 py-2 bg-slate-900 border-t border-slate-700 flex items-center justify-between text-[10px] text-slate-500">
        <span>Shift + Enter runs the current cell.</span>
        <span>
          {selectedLanguage === 'javascript'
            ? 'Sandboxed browser runtime.'
            : `${LANGUAGE_LABELS[selectedLanguage]} runs via backend executor.`}
        </span>
      </footer>
    </div>
  );
}
