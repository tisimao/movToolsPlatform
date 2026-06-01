const lensCodeCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
});

export function compareLensCode(left: string | null | undefined, right: string | null | undefined): number {
  return lensCodeCollator.compare(left ?? '', right ?? '');
}
