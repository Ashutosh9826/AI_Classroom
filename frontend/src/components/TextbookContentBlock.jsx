import React, { useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';

const CALL_OUT_META = {
  DEFINITION: { label: 'Definition', icon: 'menu_book', shell: 'border-sky-300/70 bg-sky-50 text-sky-900' },
  KEY_TERM: { label: 'Key Term', icon: 'label_important', shell: 'border-indigo-300/70 bg-indigo-50 text-indigo-900' },
  THEOREM: { label: 'Theorem', icon: 'functions', shell: 'border-purple-300/70 bg-purple-50 text-purple-900' },
  FORMULA: { label: 'Formula', icon: 'calculate', shell: 'border-fuchsia-300/70 bg-fuchsia-50 text-fuchsia-900' },
  EXAMPLE: { label: 'Example', icon: 'lightbulb', shell: 'border-emerald-300/70 bg-emerald-50 text-emerald-900' },
  NOTE: { label: 'Note', icon: 'edit_note', shell: 'border-amber-300/70 bg-amber-50 text-amber-900' },
  WARNING: { label: 'Warning', icon: 'warning', shell: 'border-rose-300/70 bg-rose-50 text-rose-900' },
};

const hasMarkdownStructure = (text) =>
  /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)/m.test(text) ||
  /\*\*[^*]+\*\*/.test(text) ||
  /_[^_\n]+_/.test(text);

const SAFE_DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i;

const safeMarkdownUrlTransform = (url, key, node) => {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) return '';

  if (key === 'src' && node?.tagName === 'img') {
    if (SAFE_DATA_IMAGE_RE.test(safeUrl)) return safeUrl;
    if (/^https:\/\//i.test(safeUrl)) return safeUrl;
    return '';
  }

  return defaultUrlTransform(safeUrl, key, node);
};

const flattenNodeText = (node) => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenNodeText).join('');
  if (React.isValidElement(node)) return flattenNodeText(node.props?.children);
  return '';
};

const normalizeToTextbookMarkdown = (rawContent) => {
  let text = String(rawContent || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/^\s+|\s+$/g, '');

  if (!text) return '';

  text = text
    .replace(/^\s*[•●◦▪]\s+/gm, '- ')
    .replace(/^\s*[–—]\s+/gm, '- ')
    .replace(/^\s*Step\s+(\d+)\s*:\s*/gim, '$1. ')
    .replace(
      /^\s*(Definition|Key Term|Theorem|Formula|Example|Note|Warning)\s*:\s*(.+)$/gim,
      (_full, kind, detail) => {
        const token = String(kind || '')
          .toUpperCase()
          .replace(/\s+/g, '_');
        return `> [!${token}] ${String(detail || '').trim()}`;
      }
    );

  if (!hasMarkdownStructure(text)) {
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length > 0) {
      const rebuilt = ['## Lesson Notes'];
      paragraphs.forEach((paragraph) => {
        const headingMatch = paragraph.match(/^([A-Z][A-Za-z0-9 ,()/+-]{3,80}):$/);
        if (headingMatch) {
          rebuilt.push(`### ${headingMatch[1]}`);
          return;
        }
        rebuilt.push(paragraph);
      });
      text = rebuilt.join('\n\n');
    }
  }

  return text;
};

const renderCallout = (kind, body, key = '') => {
  const safeKind = CALL_OUT_META[kind] ? kind : 'NOTE';
  const meta = CALL_OUT_META[safeKind];

  return (
    <div key={key || safeKind} className={`my-5 rounded-xl border px-4 py-3 ${meta.shell}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="material-symbols-outlined text-base leading-none">{meta.icon}</span>
        <span className="text-[11px] font-black uppercase tracking-widest">{meta.label}</span>
      </div>
      <p className="text-[0.95rem] leading-7 font-medium whitespace-pre-wrap">{body}</p>
    </div>
  );
};

export default function TextbookContentBlock({ content, className = '' }) {
  const markdown = useMemo(() => normalizeToTextbookMarkdown(content), [content]);

  return (
    <div className={`textbook-reading text-on-surface ${className}`.trim()}>
      <ReactMarkdown
        urlTransform={safeMarkdownUrlTransform}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-2 mb-4 text-3xl font-black tracking-tight text-on-surface">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-8 mb-3 text-2xl font-extrabold tracking-tight text-on-surface">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-6 mb-2 text-xl font-bold tracking-tight text-on-surface">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-5 mb-2 text-lg font-bold text-on-surface-variant">{children}</h4>
          ),
          p: ({ children }) => {
            const plainText = flattenNodeText(children).trim();
            const labeledCallout = plainText.match(
              /^(Definition|Key Term|Theorem|Formula|Example|Note|Warning)\s*:\s*(.+)$/i
            );
            if (labeledCallout) {
              const token = String(labeledCallout[1]).toUpperCase().replace(/\s+/g, '_');
              return renderCallout(token, labeledCallout[2]);
            }
            return <p className="my-4 text-[1.04rem] leading-8 text-on-surface-variant">{children}</p>;
          },
          blockquote: ({ children }) => {
            const plainText = flattenNodeText(children).trim();
            const markerMatch = plainText.match(/^\[!([A-Z_]+)\]\s*(.+)$/s);
            if (markerMatch) {
              const kind = markerMatch[1];
              const body = markerMatch[2];
              return renderCallout(kind, body);
            }
            return (
              <blockquote className="my-5 border-l-4 border-primary/60 bg-primary/5 rounded-r-lg px-4 py-3 text-[1rem] leading-8 text-on-surface-variant">
                {children}
              </blockquote>
            );
          },
          ul: ({ children }) => (
            <ul className="my-4 ml-5 list-disc space-y-2 text-[1.02rem] leading-8 text-on-surface-variant">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-4 ml-5 list-decimal space-y-2 text-[1.02rem] leading-8 text-on-surface-variant">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-extrabold text-on-surface bg-amber-100/70 rounded px-1">{children}</strong>
          ),
          em: ({ children }) => <em className="italic font-medium text-on-surface">{children}</em>,
          hr: () => <hr className="my-6 border-t border-outline-variant/30" />,
          code: ({ inline, children }) =>
            inline ? (
              <code className="rounded bg-surface-container px-1.5 py-0.5 text-[0.95em] text-primary font-semibold">
                {children}
              </code>
            ) : (
              <code className="block rounded-xl bg-surface-container-high p-4 text-sm leading-6 text-on-surface whitespace-pre-wrap">
                {children}
              </code>
            ),
          img: ({ src, alt, title }) => {
            const safeSrc = safeMarkdownUrlTransform(src || '', 'src', { tagName: 'img' });
            if (!safeSrc) {
              return (
                <p className="my-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Image could not be rendered because the source URL was not allowed.
                </p>
              );
            }

            const caption = String(title || alt || '').trim();
            return (
              <figure className="my-6 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
                <img
                  src={safeSrc}
                  alt={String(alt || 'Lesson visual')}
                  loading="lazy"
                  className="w-full max-h-[28rem] object-contain rounded-lg bg-white"
                />
                {caption ? (
                  <figcaption className="mt-2 text-xs leading-5 text-on-surface-variant">
                    {caption}
                  </figcaption>
                ) : null}
              </figure>
            );
          },
        }}
      >
        {markdown || 'No text content available.'}
      </ReactMarkdown>
    </div>
  );
}
