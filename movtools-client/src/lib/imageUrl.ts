import { apiClient } from '../api/client';

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function isServerRelativePath(value: string): boolean {
  return value.startsWith('/uploads/') || value.startsWith('uploads/');
}

function toFileUrl(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('//')) {
    return new URL(`file:${normalized}`).toString();
  }
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return new URL(`file:///${normalized}`).toString();
  }
  if (normalized.startsWith('/')) {
    return new URL(`file://${normalized}`).toString();
  }
  return new URL(`file:///${normalized}`).toString();
}

export function resolveImageUrl(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('file://')) {
    return trimmed;
  }

  if (isWindowsAbsolutePath(trimmed)) {
    return toFileUrl(trimmed);
  }

  if (isServerRelativePath(trimmed)) {
    const normalizedRelativePath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `${apiClient.getBaseUrl()}${normalizedRelativePath}`;
  }

  return trimmed;
}
