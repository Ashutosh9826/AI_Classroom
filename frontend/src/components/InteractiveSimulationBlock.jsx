import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sandpack,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
} from '@codesandbox/sandpack-react';
import SandpackErrorBoundary from './SandpackErrorBoundary';

const isObjectRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const DEFAULT_REACT_FILES = {
  '/App.js': `import React, { useMemo, useState } from "react";
import "./styles.css";

export default function App() {
  const [rate, setRate] = useState(5);
  const [time, setTime] = useState(3);

  const projected = useMemo(() => {
    return Math.round(1000 * Math.pow(1 + rate / 100, time));
  }, [rate, time]);

  return (
    <main className="sim-root">
      <h1>Compound Growth Explorer</h1>
      <p className="sim-description">
        Adjust the controls to observe how growth rate and time affect outcomes.
      </p>

      <section className="sim-controls">
        <label>
          Rate (%)
          <input
            type="range"
            min="0"
            max="20"
            step="1"
            value={rate}
            onChange={(event) => setRate(Number(event.target.value))}
          />
          <span>{rate}%</span>
        </label>

        <label>
          Time (years)
          <input
            type="range"
            min="1"
            max="20"
            step="1"
            value={time}
            onChange={(event) => setTime(Number(event.target.value))}
          />
          <span>{time} years</span>
        </label>
      </section>

      <section className="sim-output">
        <p>Initial value: <strong>$1,000</strong></p>
        <p>Projected value: <strong>\${projected.toLocaleString()}</strong></p>
      </section>
    </main>
  );
}
`,
  '/styles.css': `:root {
  color-scheme: light;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}

body {
  margin: 0;
  background: #f8fafc;
  color: #0f172a;
}

.sim-root {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px;
}

h1 {
  margin: 0 0 6px;
  font-size: 1.1rem;
}

.sim-description {
  margin: 0 0 18px;
  color: #475569;
  line-height: 1.45;
}

.sim-controls {
  display: grid;
  gap: 12px;
}

label {
  display: grid;
  gap: 6px;
  font-size: 0.87rem;
  font-weight: 600;
}

input[type="range"] {
  width: 100%;
}

.sim-output {
  margin-top: 18px;
  padding: 12px;
  border: 1px solid #dbe2ea;
  border-radius: 10px;
  background: #ffffff;
}

.sim-output p {
  margin: 0;
}

.sim-output p + p {
  margin-top: 6px;
}
`,
};

const DEFAULT_VANILLA_FILES = {
  '/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Interactive Simulation</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main id="app"></main>
    <script src="/index.js"></script>
  </body>
</html>
`,
  '/styles.css': `:root {
  color-scheme: light;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}

body {
  margin: 0;
  background: #f8fafc;
  color: #0f172a;
}

#app {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px;
}
`,
  '/index.js': `const app = document.getElementById("app");
app.innerHTML = \`
  <h1>Interactive Simulation</h1>
  <p>Update this file to build a dynamic model.</p>
\`;
`,
};

const DEFAULT_SIMULATION = {
  title: 'Interactive Simulation',
  description: 'Explore the concept by changing parameters and observing outcomes.',
  template: 'react',
  files: DEFAULT_REACT_FILES,
  hint: 'Inspect the model behavior as parameters change.',
  solutionText: 'Compare outcomes across multiple inputs and identify the pattern.',
};

const parseContentObject = (content) => {
  if (isObjectRecord(content)) return content;
  if (typeof content !== 'string') return {};
  try {
    const parsed = JSON.parse(content);
    return isObjectRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const sanitizeFiles = (files) => {
  if (!isObjectRecord(files)) return null;
  const entries = Object.entries(files).reduce((acc, [path, code]) => {
    if (typeof path !== 'string' || !path.startsWith('/')) return acc;
    acc[path] = typeof code === 'string' ? code : String(code ?? '');
    return acc;
  }, {});
  return Object.keys(entries).length > 0 ? entries : null;
};

const appendTagIfMissing = (html, regex, tagMarkup) => {
  if (regex.test(html)) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tagMarkup}\n</body>`);
  return `${html}\n${tagMarkup}`;
};

const buildLegacyVanillaFiles = (legacy) => {
  const html =
    typeof legacy?.html === 'string' && legacy.html.trim()
      ? legacy.html
      : '<main id="app"></main>';
  const css = typeof legacy?.css === 'string' ? legacy.css : '';
  const js =
    typeof legacy?.js === 'string' && legacy.js.trim()
      ? legacy.js
      : DEFAULT_VANILLA_FILES['/index.js'];

  let normalizedHtml = html;
  if (!/<html[\s>]/i.test(normalizedHtml)) {
    normalizedHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Interactive Simulation</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    ${normalizedHtml}
    <script src="/index.js"></script>
  </body>
</html>`;
  } else {
    normalizedHtml = appendTagIfMissing(
      normalizedHtml,
      /<link[^>]+href=["']\/styles\.css["']/i,
      '<link rel="stylesheet" href="/styles.css" />'
    );
    normalizedHtml = appendTagIfMissing(
      normalizedHtml,
      /<script[^>]+src=["']\/index\.js["']/i,
      '<script src="/index.js"></script>'
    );
  }

  return {
    '/index.html': normalizedHtml,
    '/styles.css': css,
    '/index.js': js,
  };
};

const ensureTemplateFiles = (template, files) => {
  const safeTemplate = template === 'vanilla' ? 'vanilla' : 'react';
  const normalized = { ...files };

  if (safeTemplate === 'react') {
    if (typeof normalized['/App.js'] !== 'string' || !normalized['/App.js'].trim()) {
      normalized['/App.js'] = DEFAULT_REACT_FILES['/App.js'];
    }
    if (typeof normalized['/styles.css'] !== 'string') {
      normalized['/styles.css'] = DEFAULT_REACT_FILES['/styles.css'];
    }
  } else {
    if (typeof normalized['/index.html'] !== 'string' || !normalized['/index.html'].trim()) {
      normalized['/index.html'] = DEFAULT_VANILLA_FILES['/index.html'];
    }
    if (typeof normalized['/index.js'] !== 'string' || !normalized['/index.js'].trim()) {
      normalized['/index.js'] = DEFAULT_VANILLA_FILES['/index.js'];
    }
    if (typeof normalized['/styles.css'] !== 'string') {
      normalized['/styles.css'] = DEFAULT_VANILLA_FILES['/styles.css'];
    }
  }

  return { template: safeTemplate, files: normalized };
};

const normalizeSimulationContent = (content) => {
  const parsed = parseContentObject(content);
  const metadata = {
    title:
      typeof parsed.title === 'string' && parsed.title.trim()
        ? parsed.title.trim()
        : DEFAULT_SIMULATION.title,
    description:
      typeof parsed.description === 'string' && parsed.description.trim()
        ? parsed.description.trim()
        : DEFAULT_SIMULATION.description,
    hint: typeof parsed.hint === 'string' ? parsed.hint : DEFAULT_SIMULATION.hint,
    solutionText:
      typeof parsed.solutionText === 'string'
        ? parsed.solutionText
        : DEFAULT_SIMULATION.solutionText,
  };

  const directFiles = sanitizeFiles(parsed.files);
  if (directFiles) {
    const prepared = ensureTemplateFiles(parsed.template, directFiles);
    return {
      ...metadata,
      template: prepared.template,
      files: prepared.files,
    };
  }

  const legacy =
    isObjectRecord(parsed.canvasSandbox) && parsed.canvasSandbox.enabled
      ? parsed.canvasSandbox
      : parsed;

  if (
    typeof legacy.html === 'string' ||
    typeof legacy.css === 'string' ||
    typeof legacy.js === 'string'
  ) {
    const prepared = ensureTemplateFiles('vanilla', buildLegacyVanillaFiles(legacy));
    return {
      ...metadata,
      template: prepared.template,
      files: prepared.files,
    };
  }

  return {
    ...metadata,
    template: DEFAULT_SIMULATION.template,
    files: { ...DEFAULT_SIMULATION.files },
  };
};

export default function InteractiveSimulationBlock({ block, compact = false }) {
  const simulation = useMemo(() => normalizeSimulationContent(block?.content), [block?.content]);
  const [showSource, setShowSource] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [heightBoost, setHeightBoost] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 900
  );
  const fullscreenRootRef = useRef(null);

  useEffect(() => {
    const syncViewportHeight = () => setViewportHeight(window.innerHeight || 900);
    window.addEventListener('resize', syncViewportHeight);
    return () => window.removeEventListener('resize', syncViewportHeight);
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement || null;
      setIsFullscreen(Boolean(fullscreenElement && fullscreenRootRef.current && fullscreenElement === fullscreenRootRef.current));
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
    };
  }, []);

  const toggleFullscreen = async () => {
    const root = fullscreenRootRef.current;
    if (!root) return;

    const currentlyFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (currentlyFullscreen) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      return;
    }

    try {
      if (root.requestFullscreen) {
        await root.requestFullscreen();
      } else if (root.webkitRequestFullscreen) {
        root.webkitRequestFullscreen();
      } else {
        setIsExpanded(true);
      }
    } catch {
      setIsExpanded(true);
    }
  };

  const defaultHeight = compact ? 420 : 600;
  const expandedHeight = compact ? 860 : 1200;
  const fullscreenHeight = Math.max(1200, Math.round(viewportHeight * 1.5));
  const editorHeightBase = isFullscreen ? fullscreenHeight : isExpanded ? expandedHeight : defaultHeight;
  const editorHeight = editorHeightBase + heightBoost;
  const sandpackOptions = useMemo(
    () => ({
      showNavigator: false,
      showTabs: false,
      editorHeight,
    }),
    [editorHeight]
  );
  const customSetup = simulation.template === 'vanilla' 
    ? { entry: '/index.js' } 
    : {
        dependencies: {
          "lucide-react": "latest",
          "recharts": "latest",
          "framer-motion": "latest",
          "react-is": "latest"
        }
      };

  return (
    <div
      ref={fullscreenRootRef}
      className={isFullscreen ? 'w-full h-full bg-background overflow-y-auto p-3 sm:p-6' : undefined}
    >
      <article
        className={`border border-outline-variant/20 bg-surface-container-lowest shadow-sm overflow-hidden ${
          isFullscreen ? 'max-w-7xl mx-auto rounded-xl' : 'rounded-2xl'
        }`}
      >
      <header className="px-5 pt-5 pb-3 md:px-6 md:pt-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary flex items-center gap-1.5 mb-1">
              <span className="material-symbols-outlined text-sm">experiment</span>
              Interactive Simulation
            </p>
            <h3 className="text-lg font-bold text-on-surface tracking-tight leading-snug">
              {simulation.title}
            </h3>
            <p className="text-sm text-on-surface-variant mt-1 leading-relaxed">
              {simulation.description}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowSource((value) => !value)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-outline-variant/30 text-xs font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors"
            >
              <span className="material-symbols-outlined text-sm">code</span>
              {showSource ? 'Hide Source Code' : 'View Source Code'}
            </button>

            <button
              type="button"
              onClick={() => setIsExpanded((value) => !value)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-outline-variant/30 text-xs font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors"
              title={isExpanded ? 'Collapse preview' : 'Expand preview'}
            >
              <span className="material-symbols-outlined text-sm">
                {isExpanded ? 'close_fullscreen' : 'open_in_full'}
              </span>
              {isExpanded ? 'Collapse' : 'Expand'}
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-outline-variant/30 text-xs font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors"
              title={isFullscreen ? 'Exit full screen' : 'Open full screen'}
            >
              <span className="material-symbols-outlined text-sm">
                {isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
              </span>
              {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
            </button>

            <button
              type="button"
              onClick={() => setHeightBoost((value) => Math.min(2000, value + 240))}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-outline-variant/30 text-xs font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors"
              title="Increase simulation viewport height"
            >
              <span className="material-symbols-outlined text-sm">height</span>
              Increase Height
            </button>

            {heightBoost > 0 && (
              <button
                type="button"
                onClick={() => setHeightBoost(0)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-outline-variant/30 text-xs font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors"
                title="Reset simulation viewport height"
              >
                <span className="material-symbols-outlined text-sm">restart_alt</span>
                Reset Height
              </button>
            )}
          </div>
        </div>
      </header>

      {simulation.hint && (
        <div className="px-5 md:px-6 pb-2">
          <button
            type="button"
            onClick={() => setShowHint((value) => !value)}
            className="text-xs font-semibold text-amber-700 hover:underline"
          >
            {showHint ? 'Hide Hint' : 'Hint'}
          </button>
          {showHint && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {simulation.hint}
            </p>
          )}
        </div>
      )}

      {simulation.solutionText && (
        <div className="px-5 md:px-6 pb-2">
          <button
            type="button"
            onClick={() => setShowSolution((value) => !value)}
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            {showSolution ? 'Hide Solution' : 'Solution'}
          </button>
          {showSolution && (
            <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {simulation.solutionText}
            </p>
          )}
        </div>
      )}

      <div className="px-5 md:px-6 pb-5">
        <SandpackErrorBoundary>
          <div className="rounded-xl border border-outline-variant/20 overflow-hidden">
            {showSource ? (
              <Sandpack
                template={simulation.template}
                files={simulation.files}
                theme="light"
                customSetup={customSetup}
                options={sandpackOptions}
              />
            ) : (
              <SandpackProvider
                template={simulation.template}
                files={simulation.files}
                theme="light"
                customSetup={customSetup}
              >
                <SandpackLayout>
                  <SandpackPreview
                    showOpenInCodeSandbox={false}
                    showRefreshButton
                    style={{ height: `${editorHeight}px`, minHeight: `${editorHeight}px` }}
                  />
                </SandpackLayout>
              </SandpackProvider>
            )}
          </div>
        </SandpackErrorBoundary>
      </div>
      </article>
    </div>
  );
}
