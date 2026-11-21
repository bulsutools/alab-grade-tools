import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const manifestPath = join(dist, 'manifest.json');
const archives = [
  ['zip', join(root, 'package', 'alab-grade-tools.zip')],
  ['xpi', join(root, 'package', 'alab-grade-tools.xpi')],
];
const expected = ['content.js', 'manifest.json', 'styles.css'];
const problems = [];

if (!existsSync(manifestPath)) throw new Error('dist/manifest.json is missing.');

for (const [, path] of archives) {
  if (!existsSync(path)) throw new Error(`${path} is missing.`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

for (const [label, path] of archives) {
  const archive = new AdmZip(path);
  const entries = archive
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.entryName)
    .sort();

  if (entries.join(',') !== expected.join(',')) {
    problems.push(
      `${label} entries: expected ${expected.join(', ')}, got ${entries.join(', ') || 'none'}`,
    );
  }

  for (const file of expected) {
    if (!entries.includes(file)) continue;
    const archived = archive.readAsText(file);
    const onDisk = readFileSync(join(dist, file), 'utf8');
    if (archived !== onDisk) problems.push(`${file} in ${label} differs from dist`);
  }
}

if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
if (!manifest.content_scripts?.length) problems.push('content_scripts is empty');

const script = manifest.content_scripts?.[0];
if (script) {
  if (!script.matches?.includes('https://alabsms.bulsu.edu.ph/grades*')) {
    problems.push('content script does not match the ALAB grades URL');
  }
  for (const file of [...(script.js ?? []), ...(script.css ?? [])]) {
    if (!existsSync(join(dist, file))) problems.push(`manifest references missing file: ${file}`);
  }
}

if (problems.length) {
  console.error(problems.map((problem) => `- ${problem}`).join('\n'));
  process.exit(1);
}

console.log('Package verification passed');
