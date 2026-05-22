const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidFeedbackRoundId(value?: string | null): boolean {
  return typeof value === 'string' && GUID_PATTERN.test(value.trim());
}

export function createFeedbackRoundId(): string {
  return crypto.randomUUID();
}

export function normalizeFeedbackRoundId(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return isValidFeedbackRoundId(normalized) ? normalized : undefined;
}
