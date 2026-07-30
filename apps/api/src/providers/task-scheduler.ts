export interface TaskScheduler {
  schedule(task: () => Promise<void>, delayMs: number): void;
}

export class TimeoutTaskScheduler implements TaskScheduler {
  schedule(task: () => Promise<void>, delayMs: number): void {
    const timer = setTimeout(() => {
      void task().catch((error: unknown) => {
        console.error("Scheduled checkout task failed", error);
      });
    }, delayMs);
    timer.unref();
  }
}
