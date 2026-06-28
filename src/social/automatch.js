// Quick-Match client: join the queue + poll until paired, then hand back { room_code, role } so main
// can startCoop. Reuses auth.api() (sends the bearer token; quick-match requires sign-in).
import { api } from './auth.js';

let cancelled = false;

export function cancelQuickMatch() {
  cancelled = true;
  api('/automatch/leave', { method: 'POST' }); // best-effort dequeue
}

// Resolves { room_code, role } when paired, or null on cancel / timeout / error.
export async function quickMatch(ruleset, { onWaiting } = {}) {
  cancelled = false;
  const first = await api('/automatch/join', { method: 'POST', body: { ruleset_id: ruleset } });
  if (!first || first.error) return null; // not signed in / server error
  if (first.paired) return { room_code: first.room_code, role: first.role };
  if (onWaiting) onWaiting(first.waiting || 1);
  const deadline = Date.now() + 60000; // give up after a minute
  while (!cancelled && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    if (cancelled) break;
    const s = await api('/automatch/status');
    if (s && s.paired) return { room_code: s.room_code, role: s.role };
  }
  api('/automatch/leave', { method: 'POST' }); // clean up on timeout/cancel
  return null;
}
