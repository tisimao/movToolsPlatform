/**
 * 图片附件能力模块
 *
 * 本模块将一级返修弹窗与返修记录编辑弹窗中共用的图片处理逻辑抽离为可复用单元：
 * - 选择图片（系统文件对话框）
 * - 粘贴图片（剪贴板）
 * - 图片排序（上移/下移）
 * - 图片移除
 * - 上传前临时态管理
 * - 服务端保存后路径/预览信息回填
 *
 * 本模块同时服务于制片一级返修和导演审片标注反馈，避免两套独立逻辑分叉。
 */

export interface ImageAttachmentItem {
  uid: string;
  localPath?: string;
  serverUrl?: string;
  previewUrl?: string;
  fileName: string;
  fileSize?: number;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  serverId?: string;
}

let uidCounter = 0;

export function generateUid(): string {
  uidCounter += 1;
  return `img_${Date.now()}_${uidCounter}`;
}

export function getBaseName(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return segments[segments.length - 1] || filePath;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export async function pickImageFiles(): Promise<string[]> {
  const filePaths = await window.movtools.dialog.pickFiles({
    title: '选择图片',
    filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
  });
  return filePaths ?? [];
}

export async function extractPastedImages(
  clipboardItems: DataTransferItemList,
): Promise<string[]> {
  const imageItems = Array.from(clipboardItems).filter(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );
  if (imageItems.length === 0) return [];

  const filePaths = await Promise.all(
    imageItems.map(async (item) => {
      const file = item.getAsFile();
      if (!file) return null;
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      return window.movtools.dialog.savePastedImage({
        dataUrl: `data:${file.type};base64,${base64}`,
      });
    }),
  );

  return filePaths.filter((fp): fp is string => Boolean(fp));
}

export function createPendingItemsFromPaths(paths: string[]): ImageAttachmentItem[] {
  return paths.map((path) => ({
    uid: generateUid(),
    localPath: path,
    previewUrl: path,
    fileName: getBaseName(path),
    status: 'pending' as const,
  }));
}

export function addPendingPaths(
  current: ImageAttachmentItem[],
  newPaths: string[],
): ImageAttachmentItem[] {
  const existingPaths = new Set(
    current.map((item) => item.localPath).filter(Boolean),
  );
  const deduped = newPaths.filter((p) => !existingPaths.has(p));
  return [...current, ...createPendingItemsFromPaths(deduped)];
}

export function removeItem(
  items: ImageAttachmentItem[],
  uid: string,
): ImageAttachmentItem[] {
  return items.filter((item) => item.uid !== uid);
}

export function moveItem(
  items: ImageAttachmentItem[],
  uid: string,
  direction: 'up' | 'down',
): ImageAttachmentItem[] {
  const index = items.findIndex((item) => item.uid === uid);
  if (index === -1) return items;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function markUploaded(
  items: ImageAttachmentItem[],
  uid: string,
  serverUrl: string,
  serverId: string,
): ImageAttachmentItem[] {
  return items.map((item) =>
    item.uid === uid
      ? { ...item, status: 'uploaded' as const, serverUrl, previewUrl: serverUrl, serverId }
      : item,
  );
}

export function markUploadFailed(
  items: ImageAttachmentItem[],
  uid: string,
): ImageAttachmentItem[] {
  return items.map((item) =>
    item.uid === uid ? { ...item, status: 'failed' as const } : item,
  );
}

export function getPendingPaths(items: ImageAttachmentItem[]): string[] {
  return items
    .filter((item) => item.status === 'pending' && item.localPath)
    .map((item) => item.localPath!);
}

export function getUploadedItems(items: ImageAttachmentItem[]): ImageAttachmentItem[] {
  return items.filter((item) => item.status === 'uploaded');
}
