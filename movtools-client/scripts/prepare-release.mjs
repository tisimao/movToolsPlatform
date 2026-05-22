import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

await mkdir(releaseDir, { recursive: true });

const entries = await readdir(releaseDir, { withFileTypes: true });
for (const entry of entries) {
  if (entry.isDirectory() && entry.name === 'win-unpacked') {
    await rm(path.join(releaseDir, entry.name), { recursive: true, force: true });
    continue;
  }

  if (!entry.isFile()) {
    continue;
  }

  if (entry.name.endsWith('.exe') || entry.name.endsWith('.exe.blockmap') || entry.name === 'builder-debug.yml') {
    await rm(path.join(releaseDir, entry.name), { force: true });
  }
}

console.log(`Prepared clean release directory: ${releaseDir}`);
