// Leaderboard client API (M4). submitRun records a run for the signed-in player (no-op if signed out,
// since the worker 401s); getLeaderboard is public for the global board, auth-scoped for friends.
import { api } from './auth.js';

export const submitRun = (body) => api('/me/runs', { method: 'POST', body });
export const getLeaderboard = (metric = 'wave', scope = 'global') =>
  api(`/leaderboard?metric=${metric}&scope=${scope}`).then((r) => (r && r.rows) || []);
