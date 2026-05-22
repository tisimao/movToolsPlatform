import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MediaTask } from '../../../src/types/task';
import { buildCommandArguments } from '../ffmpeg/commandBuilder';
import { probeVideoMetadata } from '../ffmpeg/ffprobeService';

export interface TaskRunnerResult {
  commandExecutable: string;
  commandArguments: string[];
  cleanupPaths?: string[];
  outputPath: string;
}

export class TaskRunner {
  async prepare(task: MediaTask, ffmpegPath: string, ffprobePath: string): Promise<TaskRunnerResult> {
    const outputPath = this.getOutputPath(task);
    const mergeOverlayTexts = task.payload.type === 'merge-video' ? task.payload.config.overlayTexts : undefined;
    const concatFilePath = task.payload.type === 'merge-video' && task.payload.config.mode === 'fast'
      ? await this.createConcatFile(task.payload.config.inputPaths)
      : undefined;
    const mergeInputs = task.payload.type === 'merge-video' && task.payload.config.mode === 'compatible'
      ? await Promise.all(task.payload.config.inputPaths.map(async (inputPath, index) => {
        try {
          const metadata = await probeVideoMetadata(ffprobePath, inputPath);
          return {
            path: inputPath,
            width: metadata.width ?? undefined,
            height: metadata.height ?? undefined,
            overlayText: mergeOverlayTexts?.[index]?.trim() || undefined,
            fileNameText: path.basename(inputPath),
          };
        } catch {
          return {
            path: inputPath,
            overlayText: mergeOverlayTexts?.[index]?.trim() || undefined,
            fileNameText: path.basename(inputPath),
          };
        }
      }))
      : undefined;

    return {
      commandExecutable: ffmpegPath,
      commandArguments: buildCommandArguments(task.payload, task.inputPath, outputPath, { concatFilePath, mergeInputs }),
      cleanupPaths: concatFilePath ? [concatFilePath] : undefined,
      outputPath,
    };
  }

  private getOutputPath(task: MediaTask): string {
    return task.outputPath || path.join(path.dirname(task.inputPath), `${path.parse(task.inputPath).name}-output`);
  }

  private async createConcatFile(inputPaths: string[]): Promise<string> {
    const directoryPath = path.join(tmpdir(), 'movtools-merge');
    await mkdir(directoryPath, { recursive: true });
    const filePath = path.join(directoryPath, `${randomUUID()}.txt`);
    const content = inputPaths.map((entry) => `file '${entry.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
    await writeFile(filePath, `${content}\n`, 'utf8');
    return filePath;
  }
}
