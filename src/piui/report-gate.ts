/** Decide whether a telemetry line should hit the bridge now or on a timer. */
export function planReport(
  lastSent: string,
  next: string,
  timerPending: boolean,
): { sendNow: boolean; armTimer: boolean } {
  if (!next || next === lastSent) return { sendNow: false, armTimer: false };
  const urgent = /^(waiting|error|idle|interrupted)\|/.test(next);
  if (urgent) return { sendNow: true, armTimer: false };
  if (timerPending) return { sendNow: false, armTimer: false };
  return { sendNow: false, armTimer: true };
}
