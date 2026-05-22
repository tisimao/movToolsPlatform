import { spawn } from 'node:child_process';
import path from 'node:path';
import { app } from 'electron';

export interface ExecutableValidationResult {
  success: boolean;
  error?: string;
}

interface ResolveExecutableOptions {
  commandName: string;
  validationArgs: string[];
  candidates: string[];
}

export function getBundledRuntimeRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'runtime');
  }

  return path.join(app.getAppPath(), 'build', 'runtime');
}

export function getBundledToolPath(...segments: string[]): string {
  return path.join(getBundledRuntimeRoot(), ...segments);
}

export async function validateExecutable(commandPath: string, validationArgs: string[]): Promise<ExecutableValidationResult> {
  return new Promise<ExecutableValidationResult>((resolve) => {
    const child = spawn(commandPath, validationArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let errorOutput = '';
    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
        return;
      }

      resolve({ success: false, error: errorOutput || `exit code ${code ?? 'unknown'}` });
    });
  });
}

export async function resolveExecutablePath(options: ResolveExecutableOptions): Promise<string | null> {
  const { commandName, validationArgs, candidates } = options;

  for (const candidate of uniquePaths(candidates)) {
    if (!candidate) {
      continue;
    }

    const validation = await validateExecutable(candidate, validationArgs);
    if (!validation.success) {
      continue;
    }

    if (path.isAbsolute(candidate)) {
      return candidate;
    }

    const located = await locateExecutableOnPath(commandName);
    return located ?? candidate;
  }

  return locateExecutableOnPath(commandName);
}

async function locateExecutableOnPath(commandName: string): Promise<string | null> {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = await runCommand(locator, [commandName]);
  if (!result.success) {
    return null;
  }

  const firstMatch = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstMatch ?? null;
}

function uniquePaths(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function runCommand(command: string, args: string[]): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({ success: false, stdout, stderr: error.message });
    });

    child.on('close', (code) => {
      resolve({ success: code === 0, stdout, stderr });
    });
  });
}
