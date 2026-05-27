import type { ProducerTaskStatus } from '../types/review';

const DRAFT_ONLY_PRODUCER_STATUSES = new Set<ProducerTaskStatus>(['draft', 'pending-submit']);

function isDraftOnlyProducerStatus(status?: ProducerTaskStatus | string | null): boolean {
  return status ? DRAFT_ONLY_PRODUCER_STATUSES.has(status as ProducerTaskStatus) : false;
}

export function filterDirectorVisibleReviewTasks<T extends { status?: string; producerStatus?: ProducerTaskStatus | string | null }>(tasks: T[]): T[] {
  return tasks.filter((task) => !isDraftOnlyProducerStatus(task.producerStatus) && !isDraftOnlyProducerStatus(task.status));
}
