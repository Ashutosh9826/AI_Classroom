const { z } = require('zod');

const FILE_PATH_PATTERN = /^\/[A-Za-z0-9._/-]+$/;

const SimulationFilesSchema = z
  .record(z.string().regex(FILE_PATH_PATTERN, 'Simulation file paths must start with "/"'), z.string())
  .refine((files) => Object.keys(files).length > 0, {
    message: 'Simulation files must include at least one file',
  });

const SimulationBlockSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(2500),
  template: z.enum(['react', 'vanilla']).default('react'),
  files: SimulationFilesSchema.optional(),
  hint: z.string().trim().max(1200).optional().default(''),
  solutionText: z.string().trim().max(3000).optional().default(''),
  design_spec: z.string().trim().optional(),
});

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

const isObjectRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const sanitizeFilesObject = (value) => {
  if (!isObjectRecord(value)) return null;

  const entries = Object.entries(value).reduce((acc, [path, content]) => {
    if (typeof path !== 'string') return acc;
    const safePath = path.trim();
    if (!safePath || !FILE_PATH_PATTERN.test(safePath)) return acc;
    acc[safePath] = typeof content === 'string' ? content : String(content ?? '');
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
  const legacyHtml =
    typeof legacy?.html === 'string' && legacy.html.trim()
      ? legacy.html
      : '<main id="app"></main>';
  const legacyCss = typeof legacy?.css === 'string' ? legacy.css : '';
  const legacyJs =
    typeof legacy?.js === 'string' && legacy.js.trim()
      ? legacy.js
      : DEFAULT_VANILLA_FILES['/index.js'];

  let normalizedHtml = legacyHtml;
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
    '/styles.css': legacyCss,
    '/index.js': legacyJs,
  };
};

const ensureTemplateFiles = (content) => {
  const template = content.template === 'vanilla' ? 'vanilla' : 'react';
  const files = { ...content.files };

  if (template === 'react') {
    if (typeof files['/App.js'] !== 'string' || !files['/App.js'].trim()) {
      files['/App.js'] = DEFAULT_REACT_FILES['/App.js'];
    }
    if (typeof files['/styles.css'] !== 'string') {
      files['/styles.css'] = DEFAULT_REACT_FILES['/styles.css'];
    }
  } else {
    if (typeof files['/index.html'] !== 'string' || !files['/index.html'].trim()) {
      files['/index.html'] = DEFAULT_VANILLA_FILES['/index.html'];
    }
    if (typeof files['/index.js'] !== 'string' || !files['/index.js'].trim()) {
      files['/index.js'] = DEFAULT_VANILLA_FILES['/index.js'];
    }
    if (typeof files['/styles.css'] !== 'string') {
      files['/styles.css'] = DEFAULT_VANILLA_FILES['/styles.css'];
    }
  }

  return {
    ...content,
    template,
    files,
  };
};

const getDefaultSimulationBlock = () => {
  return {
    title: 'Interactive Simulation',
    description: 'Explore the concept by changing parameters and observing outcomes.',
    template: 'react',
    files: { ...DEFAULT_REACT_FILES },
    hint: 'Inspect how each input affects the model output.',
    solutionText: 'Use the controls to identify how the underlying relationship behaves.',
  };
};

const normalizeSimulationBlockContent = (rawContent) => {
  const fallback = getDefaultSimulationBlock();

  const parsedInput = isObjectRecord(rawContent) ? rawContent : {};

  const directCandidate = {
    title: typeof parsedInput.title === 'string' ? parsedInput.title : fallback.title,
    description:
      typeof parsedInput.description === 'string'
        ? parsedInput.description
        : fallback.description,
    template: parsedInput.template,
    files: sanitizeFilesObject(parsedInput.files),
    hint: typeof parsedInput.hint === 'string' ? parsedInput.hint : fallback.hint,
    solutionText:
      typeof parsedInput.solutionText === 'string'
        ? parsedInput.solutionText
        : fallback.solutionText,
    design_spec: typeof parsedInput.design_spec === 'string' ? parsedInput.design_spec : undefined,
  };

  if (directCandidate.files || directCandidate.design_spec) {
    const validated = SimulationBlockSchema.safeParse(directCandidate);
    if (validated.success) {
      if (!validated.data.files) {
        validated.data.files = { ...DEFAULT_REACT_FILES }; // Stub with defaults pending two-pass
      }
      return {
        content: ensureTemplateFiles(validated.data),
        isValid: true, // Marked valid because it passed schema and has defaults
      };
    }
  }

  const legacySource =
    isObjectRecord(parsedInput.canvasSandbox) && parsedInput.canvasSandbox.enabled
      ? parsedInput.canvasSandbox
      : parsedInput;

  if (
    typeof legacySource.html === 'string' ||
    typeof legacySource.css === 'string' ||
    typeof legacySource.js === 'string'
  ) {
    const migratedCandidate = {
      title:
        typeof parsedInput.title === 'string' && parsedInput.title.trim()
          ? parsedInput.title
          : fallback.title,
      description:
        typeof parsedInput.description === 'string' && parsedInput.description.trim()
          ? parsedInput.description
          : fallback.description,
      template: 'vanilla',
      files: buildLegacyVanillaFiles(legacySource),
      hint: typeof parsedInput.hint === 'string' ? parsedInput.hint : fallback.hint,
      solutionText:
        typeof parsedInput.solutionText === 'string'
          ? parsedInput.solutionText
          : fallback.solutionText,
    };

    const migrated = SimulationBlockSchema.safeParse(migratedCandidate);
    if (migrated.success) {
      return {
        content: ensureTemplateFiles(migrated.data),
        isValid: false,
      };
    }
  }

  return {
    content: fallback,
    isValid: false,
  };
};

module.exports = {
  SimulationBlockSchema,
  getDefaultSimulationBlock,
  normalizeSimulationBlockContent,
};
