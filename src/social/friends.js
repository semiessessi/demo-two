// Friends + invites client API (M3) — thin wrappers over the demo-two-social worker via auth.api().
import { api } from './auth.js';

export const searchPlayers = (q) => api(`/players/search?q=${encodeURIComponent(q)}`).then((r) => (r && r.players) || []);
export const listFriends = () => api('/me/friends').then((r) => (r && r.friends) || []);
export const listRequests = (dir = 'in') => api(`/me/friend-requests?dir=${dir}`).then((r) => (r && r.requests) || []);
export const sendRequest = (addressee_id) => api('/friend-requests', { method: 'POST', body: { addressee_id } });
export const actRequest = (id, action) => api(`/friend-requests/${id}/${action}`, { method: 'POST' });
export const removeFriend = (id) => api(`/me/friends/${id}`, { method: 'DELETE' });
export const sendInvite = (invitee_id, room_code) => api('/invite', { method: 'POST', body: { invitee_id, room_code } });
export const listInvites = () => api('/me/invites').then((r) => (r && r.invites) || []);
export const actInvite = (id, action) => api(`/invite/${id}/${action}`, { method: 'POST' });
export const notifications = () => api('/me/notifications');
