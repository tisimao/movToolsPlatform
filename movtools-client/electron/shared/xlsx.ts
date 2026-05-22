import * as fs from 'node:fs';

type XlsxModule = typeof import('xlsx');

export async function loadXlsx(): Promise<XlsxModule> {
  const module = await import('xlsx');
  const xlsx = (module.default ?? module) as XlsxModule & { set_fs?: (fsModule: typeof fs) => void };
  xlsx.set_fs?.(fs);
  return xlsx;
}
