import type { LensStatus } from '../../../src/types/lens';

export interface ParsedLensImportRow {
  lensCode: string;
  sceneNo: number;
  lensName: string;
  singleFrame: number;
  hasSingleFrame: boolean;
  maker: string;
  lensStatus: LensStatus;
  versionTag: string;
  versionNum: string;
  fileName: string;
}

export interface ParsedLensImportRowError {
  lensCode: string;
  error: string;
}

export function parseLensImportRow(
  row: Record<string, unknown>,
  options: { allowEmptySingleFrame?: boolean } = {},
): ParsedLensImportRow | ParsedLensImportRowError {
  const lensCode = readStringCell(row, ['镜头名称', 'lens_code']).trim();
  const sceneNoRaw = readStringCell(row, ['场次', 'scene_no']).trim();
  const singleFrameRaw = readStringCell(row, ['镜头时长（帧数）', 'single_frame', '帧数']).trim();
  const maker = readStringCell(row, ['制作人员', '负责人', 'maker']).trim();

  if (!lensCode) {
    return { error: '导入失败：存在空的镜头名称。', lensCode: '' };
  }

  const hasSingleFrame = singleFrameRaw.length > 0;
  const singleFrame = hasSingleFrame ? Number(singleFrameRaw) : 0;
  if (!hasSingleFrame && options.allowEmptySingleFrame) {
    return {
      lensCode,
      sceneNo: Number(sceneNoRaw) || 0,
      lensName: lensCode,
      singleFrame: 0,
      hasSingleFrame: false,
      maker,
      lensStatus: '制作',
      versionTag: 'ANI',
      versionNum: '',
      fileName: '',
    };
  }

  if (!Number.isInteger(singleFrame) || singleFrame <= 0) {
    return { error: `导入失败：镜头「${lensCode}」的帧数无效。`, lensCode };
  }

  const sceneNo = Number(sceneNoRaw) || 0;

  return {
    lensCode,
    sceneNo,
    lensName: lensCode,
    singleFrame,
    hasSingleFrame: true,
    maker,
    lensStatus: '制作',
    versionTag: 'ANI',
    versionNum: '',
    fileName: '',
  };
}

function readStringCell(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }

  return '';
}
