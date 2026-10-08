import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const roots = ['src', 'scripts', 'test', 'test-support'];

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  }));
  return nested.flat();
}

const files = (await Promise.all(roots.map(collectJavaScriptFiles))).flat().sort();
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) continue;
  failed = true;
  process.stderr.write(`${file}\n${result.stderr || result.error?.message || 'JavaScript syntax check failed'}\n`);
}

if (failed) process.exitCode = 1;
else console.log(`JavaScript syntax checks passed for ${files.length} files.`);
