import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const sourcePngPath = path.join(projectRoot, 'icon.png');
const buildDir = path.join(projectRoot, 'build');
const targetPngPath = path.join(buildDir, 'icon.png');
const targetIcoPath = path.join(buildDir, 'icon.ico');

await mkdir(buildDir, { recursive: true });

const pngBuffer = await readFile(sourcePngPath);
if (!isPng(pngBuffer)) {
  throw new Error(`Icon file is not a valid PNG: ${sourcePngPath}`);
}

await writeFile(targetPngPath, pngBuffer);
await writeFile(targetIcoPath, createIcoFromPng(pngBuffer));

console.log(`Prepared icon assets:\n- ${targetPngPath}\n- ${targetIcoPath}`);

function isPng(buffer) {
  return buffer.length > 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
}

function createIcoFromPng(pngBuffer) {
  const width = pngBuffer.readUInt32BE(16);
  const height = pngBuffer.readUInt32BE(20);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const directory = Buffer.alloc(16);
  directory.writeUInt8(width >= 256 ? 0 : width, 0);
  directory.writeUInt8(height >= 256 ? 0 : height, 1);
  directory.writeUInt8(0, 2);
  directory.writeUInt8(0, 3);
  directory.writeUInt16LE(1, 4);
  directory.writeUInt16LE(32, 6);
  directory.writeUInt32LE(pngBuffer.length, 8);
  directory.writeUInt32LE(header.length + directory.length, 12);

  return Buffer.concat([header, directory, pngBuffer]);
}
