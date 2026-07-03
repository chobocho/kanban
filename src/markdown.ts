// Minimal, dependency-free markdown for card descriptions. Parsing is pure
// (unit-testable in Node); rendering builds DOM nodes with textContent only,
// so untrusted input can never inject markup. Supported: # ## ### headings,
// -/* and 1. lists, ``` code fences, **bold**, *italic*, `code` and
// [text](https://…) links.

export type MdInline =
  | { kind: 'text' | 'bold' | 'italic' | 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: MdInline[] }
  | { kind: 'paragraph'; inline: MdInline[] }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  | { kind: 'code'; text: string };

/** Only plain web links are allowed; anything else renders as text. */
function isSafeHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

const INLINE_TOKEN =
  /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^()\s]+)\)/g;

/** Parse one line's inline spans (code, bold, italic, links). */
export function parseInline(src: string): MdInline[] {
  const spans: MdInline[] = [];
  let last = 0;
  for (const match of src.matchAll(INLINE_TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) spans.push({ kind: 'text', text: src.slice(last, at) });
    const [, code, bold, italic, linkText, href] = match;
    if (code !== undefined) spans.push({ kind: 'code', text: code });
    else if (bold !== undefined) spans.push({ kind: 'bold', text: bold });
    else if (italic !== undefined) spans.push({ kind: 'italic', text: italic });
    else if (linkText !== undefined && href !== undefined) {
      if (isSafeHref(href)) spans.push({ kind: 'link', text: linkText, href });
      else spans.push({ kind: 'text', text: match[0] });
    }
    last = at + match[0].length;
  }
  if (last < src.length) spans.push({ kind: 'text', text: src.slice(last) });
  return spans;
}

/** Parse markdown source into a flat list of blocks. */
export function parseMarkdown(src: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = src.split(/\r?\n/);
  let paragraph: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  for (const line of lines) {
    if (code !== null) {
      if (line.trim() === '```') {
        blocks.push({ kind: 'code', text: code.join('\n') });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (line.trim().startsWith('```')) {
      flushParagraph();
      code = [];
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        inline: parseInline(heading[2]),
      });
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      const item = parseInline((bullet ?? numbered)![1]);
      const prev = blocks[blocks.length - 1];
      if (prev && prev.kind === 'list' && prev.ordered === ordered) prev.items.push(item);
      else blocks.push({ kind: 'list', ordered, items: [item] });
      continue;
    }

    if (line.trim() === '') flushParagraph();
    else paragraph.push(line);
  }
  // An unclosed fence still renders as code rather than disappearing.
  if (code !== null) blocks.push({ kind: 'code', text: code.join('\n') });
  flushParagraph();
  return blocks;
}

function renderInline(target: HTMLElement, spans: MdInline[]): void {
  for (const span of spans) {
    if (span.kind === 'text') {
      target.appendChild(document.createTextNode(span.text));
    } else if (span.kind === 'link') {
      const a = document.createElement('a');
      a.textContent = span.text;
      a.href = span.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      target.appendChild(a);
    } else {
      const tag = span.kind === 'bold' ? 'strong' : span.kind === 'italic' ? 'em' : 'code';
      const node = document.createElement(tag);
      node.textContent = span.text;
      target.appendChild(node);
    }
  }
}

/** Render markdown into DOM nodes (XSS-safe: text is never parsed as HTML). */
export function renderMarkdown(src: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of parseMarkdown(src)) {
    if (block.kind === 'heading') {
      const h = document.createElement(`h${block.level}`);
      renderInline(h, block.inline);
      fragment.appendChild(h);
    } else if (block.kind === 'list') {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        renderInline(li, item);
        list.appendChild(li);
      }
      fragment.appendChild(list);
    } else if (block.kind === 'code') {
      const pre = document.createElement('pre');
      const codeEl = document.createElement('code');
      codeEl.textContent = block.text;
      pre.appendChild(codeEl);
      fragment.appendChild(pre);
    } else {
      const p = document.createElement('p');
      renderInline(p, block.inline);
      fragment.appendChild(p);
    }
  }
  return fragment;
}
