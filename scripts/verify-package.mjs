import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const manifestPath = join(dist, 'manifest.json');
const zipPath = join(root, 'package', 'alab-grade-tools.zip');
const expected = ['content.js', 'manifest.json', 'styles.css'];

if (!existsSync(manifestPath)) throw new Error('dist/manifest.json is missing.');
if (!existsSync(zipPath)) throw new Error('package/alab-grade-tools.zip is missing.');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const zip = new AdmZip(zipPath);
const entries = zip
  .getEntries()
  .filter((entry) => !entry.isDirectory)
  .map((entry) => entry.entryName)
  .sort();
const problems = [];

if (entries.join(',') !== expected.join(',')) {
  problems.push(
    `archive entries: expected ${expected.join(', ')}, got ${entries.join(', ') || 'none'}`,
  );
}

for (const file of expected) {
  if (!entries.includes(file)) continue;
  const archived = zip.readAsText(file);
  const onDisk = readFileSync(join(dist, file), 'utf8');
  if (archived !== onDisk) problems.push(`${file} in archive differs from dist`);
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
    if (!entries.includes(file)) problems.push(`archive is missing manifest file: ${file}`);
  }
}

if (problems.length) {
  console.error(problems.map((problem) => `- ${problem}`).join('\n'));
  process.exit(1);
}

console.log('Package verification passed');
