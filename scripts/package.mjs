import { copyFileSync, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver');
const dist = fileURLToPath(new URL('../dist', import.meta.url));
const outputDir = fileURLToPath(new URL('../package', import.meta.url));

if (!existsSync(dist)) {
  throw new Error('Build output is missing. Run npm run build before packaging.');
}

mkdirSync(outputDir, { recursive: true });

const outputPath = join(outputDir, 'alab-grade-tools.zip');
const xpiPath = join(outputDir, 'alab-grade-tools.xpi');
const output = createWriteStream(outputPath);
const archive = new ZipArchive({ zlib: { level: 9 } });

output.on('close', () => {
  copyFileSync(outputPath, xpiPath);
  console.log(`${outputPath} (${archive.pointer()} bytes)`);
  console.log(`${xpiPath} (${archive.pointer()} bytes)`);
});

archive.on('error', (error) => {
  throw error;
});

archive.pipe(output);
archive.directory(dist, false);
await archive.finalize();
