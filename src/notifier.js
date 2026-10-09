export class PollNotifier {
  constructor() {
    this.waitersByKey = new Map();
  }

  wait(timeoutMs, key = '*') {
    if (timeoutMs <= 0) return Promise.resolve(false);
    return new Promise((resolve) => {
      const waiter = { timer: null, resolve: null, key };
      let waiters = this.waitersByKey.get(key);
      if (!waiters) {
        waiters = new Set();
        this.waitersByKey.set(key, waiters);
      }
      waiter.resolve = (notified) => {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        if (waiters.size === 0) this.waitersByKey.delete(key);
        resolve(notified);
      };
      waiter.timer = setTimeout(() => waiter.resolve(false), timeoutMs);
      waiter.timer.unref?.();
      waiters.add(waiter);
    });
  }

  notify(key = '*') {
    const waiters = new Set([
      ...(this.waitersByKey.get(key) || []),
      ...(this.waitersByKey.get('*') || []),
    ]);
    for (const waiter of waiters) waiter.resolve(true);
  }
}
