import { readFile } from 'node:fs/promises';
import { createLinter } from 'actionlint';

const path = '.github/workflows/ci.yml';
const source = await readFile(path, 'utf8');
const lint = await createLinter();
const results = lint(source, path);

if (results.length) {
  for (const result of results) {
    console.error(
      `${result.file}:${result.line}:${result.column}: ${result.message} (${result.kind})`,
    );
  }
  process.exit(1);
}

console.log('Workflow lint passed');
