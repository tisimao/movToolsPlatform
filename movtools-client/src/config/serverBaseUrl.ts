export const DEFAULT_SERVER_BASE_URL = 'http://localhost:5001';

export function normalizeServerBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function validateServerBaseUrl(value: string): { success: boolean; normalized?: string; error?: string } {
  const normalized = normalizeServerBaseUrl(value);

  if (!normalized) {
    return { success: false, error: '服务端地址不能为空。' };
  }

  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { success: false, error: '服务端地址必须以 http:// 或 https:// 开头。' };
    }
  } catch {
    return { success: false, error: '服务端地址格式无效，请输入完整 URL。' };
  }

  return { success: true, normalized };
}
