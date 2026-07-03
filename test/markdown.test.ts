// Unit tests for the pure markdown parser in src/markdown.ts.

import { test, assert, assertEqual } from './harness.js';
import { parseMarkdown, parseInline } from '../src/markdown.js';

test('plain text becomes a single paragraph', () => {
  const blocks = parseMarkdown('hello world');
  assertEqual(blocks.length, 1, 'one block');
  assertEqual(blocks[0].kind, 'paragraph', 'paragraph');
});

test('blank lines split paragraphs', () => {
  const blocks = parseMarkdown('one\n\ntwo');
  assertEqual(blocks.length, 2, 'two paragraphs');
});

test('headings parse with levels 1-3', () => {
  const blocks = parseMarkdown('# a\n## b\n### c');
  assertEqual(blocks.map((b) => b.kind).join(','), 'heading,heading,heading', 'all headings');
  assertEqual(
    blocks.map((b) => (b.kind === 'heading' ? b.level : 0)).join(','),
    '1,2,3',
    'levels detected',
  );
});

test('consecutive dash/star lines group into one unordered list', () => {
  const blocks = parseMarkdown('- one\n* two\n- three');
  assertEqual(blocks.length, 1, 'one list block');
  assert(blocks[0].kind === 'list' && !blocks[0].ordered, 'unordered');
  if (blocks[0].kind === 'list') assertEqual(blocks[0].items.length, 3, 'three items');
});

test('numbered lines group into an ordered list', () => {
  const blocks = parseMarkdown('1. one\n2. two');
  assert(blocks[0].kind === 'list' && blocks[0].ordered, 'ordered list');
});

test('code fences capture raw lines without inline parsing', () => {
  const blocks = parseMarkdown('```\n**not bold**\nline2\n```');
  assertEqual(blocks.length, 1, 'one block');
  assert(blocks[0].kind === 'code', 'code block');
  if (blocks[0].kind === 'code') {
    assertEqual(blocks[0].text, '**not bold**\nline2', 'raw text kept');
  }
});

test('inline bold, italic and code parse', () => {
  const spans = parseInline('a **b** *c* `d`');
  assertEqual(spans.map((s) => s.kind).join(','), 'text,bold,text,italic,text,code', 'kinds');
  assertEqual(spans[1].kind === 'bold' ? spans[1].text : '', 'b', 'bold text');
});

test('links parse and unsafe schemes are rejected', () => {
  const ok = parseInline('[site](https://example.com)');
  assert(ok[0].kind === 'link', 'https link parsed');
  if (ok[0].kind === 'link') assertEqual(ok[0].href, 'https://example.com', 'href kept');

  const bad = parseInline('[x](javascript:alert(1))');
  assert(
    bad.every((s) => s.kind !== 'link'),
    'javascript: link renders as plain text',
  );
});
