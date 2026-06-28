import * as THREE from 'three';

// Co-op netcode protocol: message type tags + an arrival-time interpolation buffer.
//
// Every transport message is a plain object with a `t` (type) field. Two logical streams over the one
// reliable channel for now (M5 splits the high-rate state onto an unreliable channel):
//   STATE (peer -> host) : own ship transform, ~STATE_HZ
//   WORLD (host -> peers): all ships + alive enemies, ~STATE_HZ
//   everything else      : lifecycle + discrete events (reliable, on occurrence)

export const M = {
  HELLO: 'hello',     // joiner -> host : { name, livery, loadout, ver }
  WELCOME: 'welcome', // host -> joiner : { yourId, hostId, roster, settings, started, en }
  ROSTER: 'roster',   // host -> peers  : { players:[{id,name,livery}] }
  START: 'start',     // host -> peers  : { settings }
  STATE: 's',         // peer -> host   : { id, p,q,v, th, f, hp?, seq, ts }
  WORLD: 'S',         // host -> peers  : { ships:[...], en:[{h,p,q,v}], wv, seq, ts }
  ESPAWN: 'espawn',   // host -> peers  : { en:[{h,kind,p,q}] }
  EDEATH: 'edeath',   // host -> peers  : { deaths:[{h,type,p}] }
  EFIRE: 'efire',     // host -> peers  : { fires:[{h,p,v}] }
  EHIT: 'ehit',       // peer -> host   : { h, dmg }
  PFIRE: 'pfire',     // peer<->host    : { id, p, v }
  PDEAD: 'pdead',     // peer -> peers  : { id }
  PRESPAWN: 'prespawn', // peer -> peers: { id }
  LEAVE: 'leave',     // peer -> peers  : { id }
  FULL: 'full',       // host -> joiner : lobby full (reject)
};

export const STATE_HZ = 20;          // own-ship send rate (Hz)
export const RENDER_DELAY_MS = 100;  // render remote entities this far behind the newest snapshot
export const DEADRECKON_MAX_MS = 250; // cap extrapolation when the buffer underruns
export const LOBBY_MAX = 4;          // host rejects beyond this

// compact wire forms
export const packV = (v) => [v.x, v.y, v.z];
export const packQ = (q) => [q.x, q.y, q.z, q.w];

// Arrival-time interpolation buffer for ONE networked entity (remote ship or enemy). Snapshots are
// pushed as they arrive (no clock sync needed); sample() returns an interpolated transform rendered
// ~RENDER_DELAY_MS behind the newest, and dead-reckons (extrapolates last velocity, capped) on
// underrun. The local player's own ship is never interpolated (always live/zero-latency).
export function createInterpolator() {
  const buf = []; // { t:arrivalMs, pos, quat, vel }
  return {
    push(now, posArr, quatArr, velArr) {
      buf.push({
        t: now,
        pos: new THREE.Vector3(posArr[0], posArr[1], posArr[2]),
        quat: new THREE.Quaternion(quatArr[0], quatArr[1], quatArr[2], quatArr[3]),
        vel: new THREE.Vector3(velArr[0], velArr[1], velArr[2]),
      });
      if (buf.length > 16) buf.shift();
    },
    // Write the interpolated transform into out.{pos,quat,vel}. Returns false if no data yet.
    sample(now, out) {
      if (buf.length === 0) return false;
      const target = now - RENDER_DELAY_MS;
      const first = buf[0];
      const last = buf[buf.length - 1];
      if (buf.length === 1 || target <= first.t) {
        out.pos.copy(first.pos); out.quat.copy(first.quat); out.vel.copy(first.vel);
        return true;
      }
      if (target >= last.t) { // dead-reckon ahead of the newest snapshot
        const dt = Math.min(target - last.t, DEADRECKON_MAX_MS) / 1000;
        out.pos.copy(last.pos).addScaledVector(last.vel, dt);
        out.quat.copy(last.quat); out.vel.copy(last.vel);
        return true;
      }
      for (let i = 0; i < buf.length - 1; i++) {
        const a = buf[i], b = buf[i + 1];
        if (target >= a.t && target <= b.t) {
          const u = (target - a.t) / Math.max(1, b.t - a.t);
          out.pos.copy(a.pos).lerp(b.pos, u);
          out.quat.copy(a.quat).slerp(b.quat, u);
          out.vel.copy(a.vel).lerp(b.vel, u);
          return true;
        }
      }
      out.pos.copy(last.pos); out.quat.copy(last.quat); out.vel.copy(last.vel);
      return true;
    },
  };
}
