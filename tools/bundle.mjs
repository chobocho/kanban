// Self-contained bundler (no external libraries). It inlines styles.css and all
// compiled ES modules into a single release/index.html so the app ships as one
// artifact. ES module imports/exports are rewritten into a tiny CommonJS-like
// runtime, which sidesteps name collisions and evaluation-order concerns.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const srcDir = path.join(root, 'js', 'src');
const outDir = path.join(root, 'release');

/** Rewrite one compiled module's source into a runtime module function body. */
function transform(src) {
  const exported = new Set();
  let out = src;

  // import { a, b as c } from './mod.js';  ->  const { a, b: c } = __require('mod');
  out = out.replace(
    /import\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w.\-/]+)\.js['"];?/g,
    (_m, names, mod) => {
      const cleaned = names
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const parts = s.split(/\s+as\s+/);
          return parts.length === 2 ? `${parts[0].trim()}: ${parts[1].trim()}` : parts[0].trim();
        })
        .join(', ');
      return `const { ${cleaned} } = __require(${JSON.stringify(path.basename(mod))});`;
    },
  );

  // export function/class/const/let NAME ...  ->  strip `export`, record NAME.
  out = out.replace(/export\s+(async\s+)?(function|class)\s+(\w+)/g, (_m, asyncKw, kind, name) => {
    exported.add(name);
    return `${asyncKw ?? ''}${kind} ${name}`;
  });
  out = out.replace(/export\s+(const|let)\s+(\w+)/g, (_m, kind, name) => {
    exported.add(name);
    return `${kind} ${name}`;
  });
  // export { a, b as c };  ->  record names, drop the statement.
  out = out.replace(/export\s*\{([^}]*)\};?/g, (_m, names) => {
    names.split(',').forEach((n) => {
      const id = n.trim().split(/\s+as\s+/).pop().trim();
      if (id) exported.add(id);
    });
    return '';
  });

  const tail = [...exported].map((n) => `__exports.${n} = ${n};`).join('\n');
  return `${out}\n${tail}\n`;
}

function buildBundle() {
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'));
  let body = '';
  for (const file of files) {
    const key = path.basename(file, '.js');
    const code = fs.readFileSync(path.join(srcDir, file), 'utf8');
    body += `__modules[${JSON.stringify(key)}] = function(__exports, __require){\n${transform(code)}\n};\n`;
  }
  return [
    '(function(){',
    'const __modules = {}, __cache = {};',
    'function __require(id){',
    '  if (__cache[id]) return __cache[id];',
    '  const e = {}; __cache[id] = e;',
    '  __modules[id](e, __require);',
    '  return e;',
    '}',
    body,
    "__require('main');",
    '})();',
  ].join('\n');
}

function main() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const bundle = buildBundle();

  let out = html.replace(
    /<link[^>]*href="\.\/styles\.css"[^>]*>/,
    `<style>\n${css}\n</style>`,
  );
  out = out.replace(
    /<script[^>]*src="\.\/js\/src\/main\.js"[^>]*><\/script>/,
    `<script>\n${bundle}\n</script>`,
  );

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), out, 'utf8');
  const bytes = Buffer.byteLength(out, 'utf8');
  console.log(`release/index.html written (${bytes} bytes, ${files()} modules inlined)`);
}

function files() {
  return fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).length;
}

main();
