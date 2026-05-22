import type { MediaTask } from '../../../src/types/task';

export class TaskStore {
  private readonly tasks = new Map<string, MediaTask>();

  list(): MediaTask[] {
    return Array.from(this.tasks.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  save(task: MediaTask): MediaTask {
    this.tasks.set(task.id, task);
    return task;
  }

  get(taskId: string): MediaTask | undefined {
    return this.tasks.get(taskId);
  }

  delete(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }
}
