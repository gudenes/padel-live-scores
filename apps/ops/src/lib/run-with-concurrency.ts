//
// Run an async worker over items with a fixed concurrency limit. Cooperative
// stop: before pulling the next item each lane checks shouldStop(). A worker
// that throws is swallowed (the caller records per-item outcomes) so one
// failure never aborts the batch.

export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      if (shouldStop()) return
      const i = next++
      if (i >= items.length) return
      try {
        await worker(items[i], i)
      } catch {
        // swallowed by design; worker records its own outcome
      }
    }
  })
  await Promise.all(lanes)
}
