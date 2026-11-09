import React, { useEffect, useRef, useState, useId } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'strict',
  fontFamily: 'Inter, system-ui, sans-serif',
});

/**
 * Remove all orphan Mermaid error/render elements that get appended to document.body.
 * Mermaid v11 injects `<div id="d...">` containers and `<div id="mermaid-...">` SVG
 * wrappers directly into the body; on errors it also leaves `<div>` elements with
 * the class "error-icon" or containing the text "Syntax error in text".
 */
const cleanupMermaidOrphans = () => {
  document.querySelectorAll(
    'body > div[id^="d"], body > div[id^="mermaid_"], body > svg[id^="mermaid_"]'
  ).forEach((el) => el.remove());

  // Mermaid error displays are generic <div> elements with distinctive inner text
  document.querySelectorAll('body > div').forEach((el) => {
    if (
      el.textContent?.includes('Syntax error in text') ||
      el.querySelector?.('.error-icon')
    ) {
      el.remove();
    }
  });
};

const stripMermaidFences = (value) =>
  String(value || '')
    .replace(/```(?:mermaid)?/gi, '')
    .replace(/```/g, '')
    .trim();

const quoteFlowchartSquareLabels = (value) =>
  String(value || '').replace(
    /\b([A-Za-z_][A-Za-z0-9_-]*)\[([^\]\n]+)\]/g,
    (_match, nodeId, labelText) => {
      const label = String(labelText || '').trim();
      if (!label) return `${nodeId}[${label}]`;
      if (
        (label.startsWith('"') && label.endsWith('"')) ||
        (label.startsWith("'") && label.endsWith("'"))
      ) {
        return `${nodeId}[${label}]`;
      }

      // Mermaid flowchart parser can choke on unquoted label tokens like h(n).
      const requiresQuotes = /[(){}:*|,]/.test(label);
      if (!requiresQuotes) return `${nodeId}[${label}]`;

      const escaped = label.replace(/"/g, '\\"');
      return `${nodeId}["${escaped}"]`;
    }
  );

const sanitizeMermaidSource = (value) => {
  let source = stripMermaidFences(value);
  const firstLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (/^(graph|flowchart)\b/i.test(firstLine || '')) {
    source = quoteFlowchartSquareLabels(source);
  }

  return source.trim();
};

const buildSafeFallbackDiagram = (source) => {
  const firstLine = stripMermaidFences(source)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  const directionMatch = String(firstLine || '').match(/^(?:graph|flowchart)\s+([A-Za-z]{2})/i);
  const direction = directionMatch?.[1]?.toUpperCase() || 'TD';

  return [
    `graph ${direction};`,
    '  A["Core Concept"] --> B["Mechanism"];',
    '  B --> C["Step-by-step Process"];',
    '  B --> D["Common Pitfall"];',
    '  C --> E["Practical Application"];',
  ].join('\n');
};

export default function MermaidBlock({ code }) {
  const containerRef = useRef(null);
  const uniqueId = useId().replace(/:/g, '_');
  const [error, setError] = useState(null);
  const [svg, setSvg] = useState('');

  useEffect(() => {
    if (!code || typeof code !== 'string' || !code.trim()) {
      setError('No Mermaid diagram code provided.');
      setSvg('');
      return;
    }

    let cancelled = false;

    const renderDiagram = async () => {
      const renderSource = async (sourceText) => {
        const elementId = `mermaid_${uniqueId}_${Date.now()}`;
        const { svg: renderedSvg } = await mermaid.render(elementId, sourceText);
        return renderedSvg;
      };

      try {
        const rawSource = code.trim();
        let renderedSvg = await renderSource(rawSource);

        if (!renderedSvg) {
          const sanitizedSource = sanitizeMermaidSource(rawSource);
          if (sanitizedSource && sanitizedSource !== rawSource) {
            renderedSvg = await renderSource(sanitizedSource);
          }
        }

        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (primaryErr) {
        try {
          const sanitizedSource = sanitizeMermaidSource(code);
          if (sanitizedSource && sanitizedSource !== code.trim()) {
            const renderedSvg = await renderSource(sanitizedSource);
            if (!cancelled) {
              setSvg(renderedSvg);
              setError(null);
            }
            return;
          }
        } catch {
          // Ignore secondary error and surface the primary parse error.
        }

        const fallbackSource = buildSafeFallbackDiagram(code);
        try {
          const fallbackSvg = await renderSource(fallbackSource);
          if (!cancelled) {
            setSvg(fallbackSvg);
            setError(
              `Diagram syntax error: ${primaryErr?.message || 'Invalid Mermaid syntax'}. Showing safe fallback diagram.`
            );
          }
        } catch {
          if (!cancelled) {
            setError(`Diagram syntax error: ${primaryErr?.message || 'Invalid Mermaid syntax'}`);
            setSvg('');
          }
        }
      } finally {
        // Always clean up orphan DOM nodes Mermaid may have injected into <body>
        cleanupMermaidOrphans();
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
      cleanupMermaidOrphans();
    };
  }, [code, uniqueId]);

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-outline-variant/20 bg-surface-container-low">
        <span className="material-symbols-outlined text-sm text-primary">account_tree</span>
        <span className="text-xs font-bold uppercase tracking-widest text-outline">Mermaid Diagram</span>
      </div>
      <div className="p-6 flex items-center justify-center min-h-[120px]" ref={containerRef}>
        {error ? (
          <div className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-medium">
            <span className="material-symbols-outlined text-sm align-middle mr-1">error</span>
            {error}
          </div>
        ) : svg ? (
          <div
            className="mermaid-output w-full overflow-x-auto flex justify-center"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="text-outline-variant text-sm italic">Rendering diagram...</div>
        )}
      </div>
    </div>
  );
}
