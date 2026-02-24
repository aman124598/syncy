type QueueTask = () => Promise<void>;

export class JobQueue {
  private readonly tasks: QueueTask[] = [];
  private running = 0;

  public constructor(private readonly concurrency = 1) {}

  public push(task: QueueTask): void {
    this.tasks.push(task);
    this.runNext();
  }

  private runNext(): void {
    if (this.running >= this.concurrency) {
      return;
    }
    const task = this.tasks.shift();
    if (!task) {
      return;
    }
    this.running += 1;
    task()
      .catch(() => {
        // Task-specific failures are handled by callers.
      })
      .finally(() => {
        this.running -= 1;
        this.runNext();
      });
  }
}
