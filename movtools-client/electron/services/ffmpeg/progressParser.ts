const TIME_PATTERN = /time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/;

export function parseProgress(stderrLine: string, durationSeconds: number): number | null {
  const match = stderrLine.match(TIME_PATTERN);
  if (!match) {
    return null;
  }

  const seconds = toSeconds(match[1]);
  if (durationSeconds <= 0) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round((seconds / durationSeconds) * 100)));
}

function toSeconds(value: string): number {
  const [hoursPart, minutesPart, secondsPart] = value.split(':');
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  const seconds = Number(secondsPart);

  return hours * 3600 + minutes * 60 + seconds;
}
