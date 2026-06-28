// Campaign registry: the ordered list of missions + unlock helpers. Progress (which are complete) lives
// in localStorage via settings.js (loadCampaign). A mission unlocks when its `requires` mission is done.

import { m1 } from './m1-shakedown.js';
import { m2 } from './m2-belt.js';

export const MISSIONS = [m1, m2];

export const byId = (id) => MISSIONS.find((m) => m.id === id) || null;

export function isUnlocked(id, progress) {
  const m = byId(id);
  if (!m) return false;
  if (!m.requires) return true;
  return !!(progress && progress.completed && progress.completed[m.requires]);
}

export function nextMission(id) {
  const i = MISSIONS.findIndex((m) => m.id === id);
  return i >= 0 ? MISSIONS[i + 1] || null : null;
}
