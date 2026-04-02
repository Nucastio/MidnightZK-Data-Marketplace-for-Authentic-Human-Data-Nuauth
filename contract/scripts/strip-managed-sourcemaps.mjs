/**
 * Compact emits sourcemaps whose sources include paths outside this repo.
 * Delete *.js.map and remove the trailing //# sourceMappingURL line from .js
 * so bundlers do not try to open a missing .map file (ENOENT).
 */
import fs from 'node:fs';
import path from 'node:path';

const roots = process.argv.slice(2).filter((r) => fs.existsSync(r));

function walk(dir, onFile) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, onFile);
    else onFile(p);
  }
}

function stripSourceMappingDirective(content) {
  const lines = content.split(/\r?\n/);
  const endedWithNewline = /\r?\n$/.test(content);
  while (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last === '' || /^\s*\/\/# sourceMappingURL=/.test(last)) {
      lines.pop();
    } else {
      break;
    }
  }
  const body = lines.join('\n');
  return endedWithNewline ? `${body}\n` : body;
}

for (const root of roots) {
  walk(root, (p) => {
    if (p.endsWith('.js.map')) {
      fs.unlinkSync(p);
      return;
    }
    if (p.endsWith('.js')) {
      const s = fs.readFileSync(p, 'utf8');
      const out = stripSourceMappingDirective(s);
      if (out !== s) {
        fs.writeFileSync(p, out);
      }
    }
  });
}
