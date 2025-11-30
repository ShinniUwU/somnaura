type Timer = { handle: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>; type: 'timeout' | 'interval' };

export class TimerManager {
  private timers: Set<Timer> = new Set();

  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const handle = setTimeout(() => {
      this.clear(handle);
      fn();
    }, ms);
    const t: Timer = { handle, type: 'timeout' };
    this.timers.add(t);
    return handle;
  }

  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
    const handle = setInterval(fn, ms);
    const t: Timer = { handle, type: 'interval' };
    this.timers.add(t);
    return handle;
  }

  clear(handle: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void {
    const timer = Array.from(this.timers).find((t) => t.handle === handle);
    if (!timer) return;
    if (timer.type === 'timeout') clearTimeout(timer.handle as ReturnType<typeof setTimeout>);
    else clearInterval(timer.handle as ReturnType<typeof setInterval>);
    this.timers.delete(timer);
  }

  clearAll(): void {
    for (const t of this.timers) {
      if (t.type === 'timeout') clearTimeout(t.handle as ReturnType<typeof setTimeout>);
      else clearInterval(t.handle as ReturnType<typeof setInterval>);
    }
    this.timers.clear();
  }
}
