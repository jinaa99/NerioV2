/**
 * Small in-process work queue with bounded concurrency and per-key de-duplication. A failing task is logged and
 * never stops the others. State lives on globalThis (keyed by name) so every route bundle shares one queue.
 * Durable state is always on database rows; this only decides what runs now.
 */
export type JobQueue<T> = {
  /** Queue tasks; keys already queued or running are skipped (a running key is re-run once if `rerun` is set). */
  enqueue(items: { key: string; payload: T }[], options?: { rerun?: boolean }): { accepted: string[]; done: Promise<void> };
  has(key: string): boolean;
  size(): { pending: number; running: number };
};

type State<T> = { pending: { key: string; payload: T }[]; running: Set<string>; dirty: Map<string, T> };
const store = globalThis as typeof globalThis & { __nerioQueues?: Map<string, State<unknown>> };

export function createJobQueue<T>(name: string, concurrency: () => number, run: (payload: T, key: string) => Promise<unknown>): JobQueue<T> {
  const queues = (store.__nerioQueues ??= new Map());
  const state = (queues.get(name) ?? { pending: [], running: new Set(), dirty: new Map() }) as State<T>;
  queues.set(name, state as State<unknown>);

  const pump = (): Promise<void>[] => {
    const started: Promise<void>[] = [];
    while (state.running.size < Math.max(1, concurrency()) && state.pending.length) {
      const index = state.pending.findIndex(item => !state.running.has(item.key));
      if (index < 0) break;
      const [next] = state.pending.splice(index, 1);
      state.running.add(next.key);
      started.push(Promise.resolve().then(() => run(next.payload, next.key))
        .then(() => undefined, error => { console.error(`[${name}] ${next.key} failed:`, error instanceof Error ? error.message : error); })
        .finally(() => {
          state.running.delete(next.key);
          const again = state.dirty.get(next.key);
          if (again !== undefined) { state.dirty.delete(next.key); state.pending.push({ key: next.key, payload: again }); }
        })
        .then(() => Promise.all(pump())).then(() => undefined));
    }
    return started;
  };

  return {
    enqueue(items, options = {}) {
      const accepted: string[] = [];
      for (const item of items) {
        if (state.pending.some(p => p.key === item.key)) continue;
        if (state.running.has(item.key)) {
          if (options.rerun) { state.dirty.set(item.key, item.payload); accepted.push(item.key); }
          continue;
        }
        state.pending.push(item); accepted.push(item.key);
      }
      return { accepted, done: Promise.all(pump()).then(() => undefined) };
    },
    has: key => state.running.has(key) || state.pending.some(item => item.key === key) || state.dirty.has(key),
    size: () => ({ pending: state.pending.length, running: state.running.size }),
  };
}
