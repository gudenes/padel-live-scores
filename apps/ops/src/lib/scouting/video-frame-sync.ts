/** Drive a viewer from presented media frames, without rerendering React each frame. */
export function syncVideoFrames(video: HTMLVideoElement, publish: (time: number) => void) {
  let disposed = false;
  let pending: number | null = null;
  const native = typeof video.requestVideoFrameCallback === 'function';
  function cancel() {
    if (pending === null) return;
    if (native) video.cancelVideoFrameCallback(pending);
    else cancelAnimationFrame(pending);
    pending = null;
  }
  function schedule() {
    if (disposed || pending !== null) return;
    if (native) {
      pending = video.requestVideoFrameCallback((_now, metadata) => {
        pending = null;
        if (disposed) return;
        publish(metadata.mediaTime);
        schedule();
      });
    } else if (!video.paused && !video.ended) {
      pending = requestAnimationFrame(() => {
        pending = null;
        if (disposed) return;
        publish(video.currentTime);
        schedule();
      });
    }
  }
  function resync() {
    cancel();
    publish(video.currentTime);
    schedule();
  }
  const events = ['loadeddata', 'play', 'playing', 'pause', 'seeking', 'seeked', 'ratechange', 'ended'] as const;
  events.forEach(event => video.addEventListener(event, resync));
  resync();
  return () => {
    disposed = true;
    cancel();
    events.forEach(event => video.removeEventListener(event, resync));
  };
}
