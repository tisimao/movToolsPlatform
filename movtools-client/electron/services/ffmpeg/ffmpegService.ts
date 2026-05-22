import { spawn, type ChildProcess } from 'node:child_process';

export interface FfmpegRunOptions {
  executable: string;
  args: string[];
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface FfmpegExecution {
  child: ChildProcess;
  completion: Promise<void>;
}

export function startFfmpeg(options: FfmpegRunOptions): FfmpegExecution {
  const child = spawn(options.executable, options.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const completion = new Promise<void>((resolve, reject) => {
    let stderrOutput = '';

    child.stdout.on('data', (chunk: Buffer) => {
      options.onStdout?.(chunk.toString());
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const value = chunk.toString();
      stderrOutput += value;
      options.onStderr?.(value);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderrOutput || `FFmpeg exited with code ${code ?? 'unknown'}`));
    });
  });

  return {
    child,
    completion,
  };
}

export function stopFfmpeg(execution: FfmpegExecution): void {
  if (!execution.child.killed) {
    execution.child.kill('SIGTERM');
  }
}
