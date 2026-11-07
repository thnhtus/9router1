// Per-model concurrency gate (ported idea from OmniRoute rateLimitSemaphore, minus rate-limit
// bookkeeping which accountFallback already owns). FIFO queue; rejects when the queue is full
// or the wait times out so the combo can cascade to the next model.
// ponytail: in-memory, per-process; move to shared store when running multiple instances.

const gates = new Map(); // model -> { running, queue: [{ resolve, reject, timer }] }

export class SemaphoreBusyError extends Error {
  constructor(model, reason) {
    super(`Model ${model} busy (${reason})`);
    this.code = "SEMAPHORE_BUSY";
  }
}

function gate(model) {
  let g = gates.get(model);
  if (!g) gates.set(model, (g = { running: 0, queue: [] }));
  return g;
}

/**
 * Wait for a slot on `model`. Resolves to an idempotent `release()`.
 * max <= 0 or non-finite = unlimited (no-op gate).
 */
export function acquire(model, { max = 0, timeoutMs = 30000, maxQueue = 50 } = {}) {
  if (!(max > 0) || !Number.isFinite(max)) return Promise.resolve(() => {});
  const g = gate(model);

  const makeRelease = () => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = g.queue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(makeRelease()); // hand the slot over directly; running unchanged
      } else {
        g.running--;
        if (g.running === 0) gates.delete(model);
      }
    };
  };

  if (g.running < max) {
    g.running++;
    return Promise.resolve(makeRelease());
  }
  if (g.queue.length >= maxQueue) return Promise.reject(new SemaphoreBusyError(model, "queue full"));

  return new Promise((resolve, reject) => {
    const entry = { resolve, reject, timer: null };
    entry.timer = setTimeout(() => {
      const i = g.queue.indexOf(entry);
      if (i !== -1) g.queue.splice(i, 1);
      reject(new SemaphoreBusyError(model, "timeout"));
    }, timeoutMs);
    g.queue.push(entry);
  });
}

/** Keep the slot until the response body is fully read, errors, or is cancelled. */
export function releaseOnBodyEnd(response, release) {
  if (!response?.body || typeof response.body.getReader !== "function") {
    release();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(ctrl) {
      try {
        const { done, value } = await reader.read();
        if (done) { release(); ctrl.close(); } else ctrl.enqueue(value);
      } catch (e) { release(); ctrl.error(e); }
    },
    cancel(reason) { release(); return reader.cancel(reason); },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export function getSemaphoreStats(model) {
  const g = gates.get(model);
  return { running: g?.running || 0, queued: g?.queue.length || 0 };
}
