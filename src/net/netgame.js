import * as THREE from 'three';
import { createAlly } from '../ally.js';
import { createThrusters } from '../thruster.js';
import { createRcs } from '../rcs.js';
import { M, STATE_HZ, LOBBY_MAX, createInterpolator, packV, packQ } from './protocol.js';

// Co-op netplay glue (modeled on attract.js's remote-ship recipe). Two roles share this module:
//   HOST   — authoritative for the Chig AI + waves. Runs enemyMgr/waves locally; each tick broadcasts a
//            WORLD snapshot (all ships + alive enemies) + discrete enemy events; resolves enemy hp.
//   JOINER — runs no enemy AI. Renders enemies as host-driven proxies, its own ship locally, the host's
//            ship as an interpolated remote; reports its enemy hits to the host.
// Each peer OWNS its own ship's hp (enemy bolts are replicated to every peer and tested per-peer).
//
// M1 = 2 players (host + 1 joiner; no joiner<->joiner relay). The WORLD snapshot already carries every
// ship keyed by id, so generalising to a host relay (M5) is additive.

const SEND_DT = 1 / STATE_HZ;

function randId() {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

export function createNetGame(scene, opts) {
  const { transport, role, ship, enemyMgr, projectiles, vfx, combat, lighting, getLocalPlayer } = opts;
  const isHost = role === 'host';
  const myId = randId();
  const myName = opts.localName || 'Pilot';
  const myLivery = opts.localLivery || null;

  // remote PLAYER ships (everyone except me) — network-driven createAlly proxies (AI never ticked)
  const remotes = new Map(); // id -> { ally, thr, rcs, interp, firing, name, livery }
  // JOINER: host-authoritative ENEMY proxies, keyed by Chig hash
  const enemyProxies = new Map(); // hash -> { enemy, interp }
  // HOST: latest received ship state per joiner (for rebroadcast in WORLD)
  const latestShip = new Map(); // id -> { p,q,v,th,f,hp }
  const seenBolts = new WeakSet(); // HOST: enemy bolts already broadcast as efire

  const roster = []; // [{ id, name, livery }] (excludes me)
  let started = false;
  let sendAcc = 0;
  let seq = 0;
  let myKills = 0; // co-op: enemies killed by MY shots (for an honest per-player leaderboard)
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const sample = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3() };

  // --- remote ship construction (mirror of attract.js's clone path) ----------------------------------
  function makeRemoteShip(id, name, livery) {
    const align = ship.align.clone(true);
    align.traverse((o) => { if (o.isMesh) o.castShadow = false; }); // clones don't cast shadows (heavy)
    const pivot = new THREE.Group();
    pivot.add(align);
    scene.add(pivot);
    const thr = createThrusters(pivot, ship.nozzles, ship.rearDir, ship.radius);
    lighting.attachThrusters(pivot, ship.nozzles, ship.rearDir, ship.radius);
    lighting.registerTree(pivot); // idempotent — CSM material registration
    const rcs = createRcs(scene, { pivot });
    const ally = createAlly(scene, {
      pivot, model: align, radius: ship.radius, engineMaterials: ship.engineMaterials,
      thrusters: thr, projectiles, vfx, lighting, team: 'player', mortal: false,
    });
    const r = { ally, thr, rcs, interp: createInterpolator(), firing: false, name, livery };
    remotes.set(id, r);
    return r;
  }
  function dropRemoteShip(id) {
    const r = remotes.get(id);
    if (!r) return;
    if (r.ally.destroy) r.ally.destroy(); else scene.remove(r.ally.pivot);
    remotes.delete(id);
  }
  // Reconcile our remote-ship proxies to a full roster (everyone, including self). Used by joiners on
  // WELCOME + ROSTER so a late joiner builds proxies for all the others (not just the host).
  function syncRoster(list) {
    const ids = new Set();
    for (const p of list || []) {
      if (p.id === myId) continue;
      ids.add(p.id);
      if (!remotes.has(p.id)) makeRemoteShip(p.id, p.name, p.livery);
    }
    for (const id of [...remotes.keys()]) if (!ids.has(id)) dropRemoteShip(id); // someone left
    roster.length = 0;
    for (const p of list || []) if (p.id !== myId) roster.push(p);
    if (opts.onRoster) opts.onRoster(rosterWithSelf());
  }
  const wireRoster = () => rosterWithSelf().map((p) => ({ id: p.id, name: p.name, livery: p.livery }));

  // --- transport wiring ------------------------------------------------------------------------------
  transport.onConnected(() => {
    if (isHost) {
      // wait for the joiner's hello, then welcome + roster (handled in onMessage)
    } else {
      transport.send({ t: M.HELLO, id: myId, name: myName, livery: myLivery, ver: 1 });
    }
  });

  transport.onMessage((msg, conn) => {
    if (!msg || !msg.t) return;
    switch (msg.t) {
      case M.HELLO: { // host: a joiner announced itself
        if (!isHost) return;
        if (roster.length >= LOBBY_MAX - 1 && !roster.find((p) => p.id === msg.id)) { transport.sendTo(conn, { t: M.FULL }); break; } // lobby full
        if (conn) conn._d2id = msg.id; // tag the connection so we can clean up on its leave
        if (!roster.find((p) => p.id === msg.id)) roster.push({ id: msg.id, name: msg.name, livery: msg.livery });
        makeRemoteShip(msg.id, msg.name, msg.livery);
        transport.sendTo(conn, { t: M.WELCOME, yourId: msg.id, roster: wireRoster(), // targeted to the new joiner
          settings: opts.getSettings ? opts.getSettings() : null, started });
        transport.send({ t: M.ROSTER, players: wireRoster() }); // tell everyone the roster grew
        if (opts.onRoster) opts.onRoster(rosterWithSelf());
        break;
      }
      case M.WELCOME: { // joiner: learn the full roster, build a proxy per other player
        syncRoster(msg.roster);
        if (msg.settings && opts.onSettings) opts.onSettings(msg.settings);
        if (msg.started && opts.onStart) opts.onStart(msg.settings);
        break;
      }
      case M.ROSTER: { syncRoster(msg.players); break; } // a player joined/left -> reconcile proxies
      case M.START: { if (!isHost && opts.onStart) opts.onStart(msg.settings); break; }
      case M.STATE: { // peer ship transform
        latestShip.set(msg.id, msg);
        const r = remotes.get(msg.id);
        if (r) { r.interp.push(Date.now(), msg.p, msg.q, msg.v); r.firing = !!msg.f; if (msg.hp) applyRemoteHp(r, msg.hp); }
        break;
      }
      case M.WORLD: { // host -> peers: all ships + enemies
        for (const s of msg.ships || []) {
          if (s.id === myId) continue;
          const r = remotes.get(s.id);
          if (r) { r.interp.push(Date.now(), s.p, s.q, s.v); r.firing = !!s.f; if (s.hp) applyRemoteHp(r, s.hp); }
        }
        for (const en of msg.en || []) {
          const ep = enemyProxies.get(en.h);
          if (ep) ep.interp.push(Date.now(), en.p, en.q, en.v);
        }
        break;
      }
      case M.ESPAWN: { for (const en of msg.en || []) { if (!enemyProxies.has(en.h)) { const e = enemyMgr.spawnProxy({ hash: en.h, pos: arrV(en.p), quat: arrQ(en.q) }); enemyProxies.set(en.h, { enemy: e, interp: createInterpolator() }); } } break; }
      case M.EDEATH: { for (const d of msg.deaths || []) { if (d.by === myId) myKills++; enemyMgr.killByHash(d.h, d.type); enemyProxies.delete(d.h); } break; }
      case M.EFIRE: { for (const f of msg.fires || []) spawnEnemyBolt(f); break; }
      case M.EHIT: { if (isHost) applyEnemyHit(msg.h, msg.dmg, msg.by); break; }
      // player events: the host relays joiner->joiner so everyone sees them (sender ignores its own id)
      case M.PFIRE: { if (isHost) transport.send(msg); break; } // cosmetic tracer (visual TODO) + relay
      case M.PDEAD: { const r = remotes.get(msg.id); if (r && r.ally.destroy) r.ally.destroy(); if (isHost) transport.send(msg); break; }
      case M.PRESPAWN: { const r = remotes.get(msg.id); if (r && r.ally.patch) r.ally.patch(); if (isHost) transport.send(msg); break; }
      case M.LEAVE: { dropRemoteShip(msg.id); const i = roster.findIndex((p) => p.id === msg.id); if (i >= 0) roster.splice(i, 1); if (opts.onRoster) opts.onRoster(rosterWithSelf()); break; }
      case M.FULL: { if (opts.onLeave) opts.onLeave(msg); break; }
      default: break;
    }
  });

  transport.onDisconnected(() => { if (opts.onDisconnect) opts.onDisconnect(); });
  // host: a joiner's connection closed -> drop its ship, prune the roster, tell the rest
  if (transport.onPeerLeft) transport.onPeerLeft((conn) => {
    const id = conn && conn._d2id;
    if (!id) return;
    const i = roster.findIndex((p) => p.id === id); if (i >= 0) roster.splice(i, 1);
    dropRemoteShip(id);
    transport.send({ t: M.LEAVE, id });
    transport.send({ t: M.ROSTER, players: wireRoster() });
    if (opts.onRoster) opts.onRoster(rosterWithSelf());
  });

  function rosterWithSelf() { return [{ id: myId, name: myName, livery: myLivery, self: true }, ...roster]; }
  function arrV(a) { return new THREE.Vector3(a[0], a[1], a[2]); }
  function arrQ(a) { return new THREE.Quaternion(a[0], a[1], a[2], a[3]); }
  function applyRemoteHp(/* r, hp */) { /* M1: cosmetic only; per-zone replication is M4 polish */ }

  // --- enemy bolt replication (host -> joiners) ------------------------------------------------------
  function spawnEnemyBolt(f) {
    projectiles.spawn({ pos: arrV(f.p), vel: arrV(f.v), color: 0xffffff, team: 'enemy',
      damage: enemyMgr.params.pulseDamage, life: 2.6, radius: 0.7, scale: 1.35, width: 2, glow: 2.8, noise: 0.6 });
  }
  // HOST: each tick, find newly-spawned enemy bolts and batch them into an efire event.
  function collectEnemyFires() {
    const fires = [];
    const live = projectiles.live || [];
    for (const b of live) {
      if (b.team !== 'enemy' || seenBolts.has(b)) continue;
      seenBolts.add(b);
      fires.push({ p: packV(b.pos), v: packV(b.vel) });
    }
    return fires;
  }

  // --- enemy hp authority (host) ---------------------------------------------------------------------
  function applyEnemyHit(hash, dmg, by) {
    for (const e of enemyMgr.enemies) {
      if (e.hash === hash && e.alive) {
        e._lastBy = by; // remember the last damager for kill credit
        e.hp -= dmg;
        if (e.hp <= 0) enemyMgr.kill(e); // edeath (with credit) emitted in hostEnemyEvents
        return;
      }
    }
  }
  // HOST: enemy-hit callback for combat — applies locally (host's own bolt credits the host).
  if (isHost && combat.setOnEnemyHit) combat.setOnEnemyHit((e, dmg) => applyEnemyHit(e.hash, dmg, myId));
  // JOINER: report the hit (+ who shot) to the host; the spark is already drawn by combat.
  if (!isHost && combat.setOnEnemyHit) combat.setOnEnemyHit((e, dmg) => transport.send({ t: M.EHIT, h: e.hash, dmg, by: myId }));

  // HOST: detect spawns/deaths since last tick to emit espawn/edeath.
  const knownHashes = new Set();
  function hostEnemyEvents() {
    const espawn = [], edeath = [];
    const now = new Set();
    for (const e of enemyMgr.enemies) {
      now.add(e.hash);
      if (e.alive && !knownHashes.has(e.hash)) espawn.push({ h: e.hash, kind: 0, p: packV(e.pos), q: packQ(e.obj.quaternion) });
      if (!e.alive && knownHashes.has(e.hash)) { edeath.push({ h: e.hash, type: e.death?.type || 'instant', p: packV(e.pos), by: e._lastBy }); if (e._lastBy === myId) myKills++; }
    }
    for (const h of knownHashes) if (!now.has(h)) edeath.push({ h, type: 'instant' }); // pruned before we saw the death
    knownHashes.clear();
    for (const e of enemyMgr.enemies) if (e.alive) knownHashes.add(e.hash);
    return { espawn, edeath };
  }

  // --- public per-frame API --------------------------------------------------------------------------
  function captureLocal(player, info) {
    sendAcc += info?.dt ?? (1 / 60);
    if (sendAcc < SEND_DT) return;
    sendAcc = 0;
    seq++;
    const s = { t: M.STATE, id: myId, p: packV(player.pos), q: packQ(player.quat), v: packV(player.vel),
      th: info?.throttle ?? 0, f: info?.firing ? 1 : 0, seq, ts: Date.now() };
    if (isHost) {
      latestShip.set(myId, s);
      const ships = [];
      for (const v of latestShip.values()) ships.push(v);
      const en = [];
      for (const e of enemyMgr.enemies) if (e.alive) en.push({ h: e.hash, p: packV(e.pos), q: packQ(e.obj.quaternion), v: packV(e.vel) });
      const { espawn, edeath } = hostEnemyEvents();
      if (espawn.length) transport.send({ t: M.ESPAWN, en: espawn });
      if (edeath.length) transport.send({ t: M.EDEATH, deaths: edeath });
      const fires = collectEnemyFires();
      if (fires.length) transport.send({ t: M.EFIRE, fires });
      transport.send({ t: M.WORLD, ships, en, wv: opts.getWave ? opts.getWave() : 0, seq, ts: s.ts });
    } else {
      transport.send(s);
    }
  }

  function applyRemotes(dt) {
    const now = Date.now();
    for (const r of remotes.values()) {
      if (!r.ally.alive) continue;
      if (r.interp.sample(now, sample)) {
        r.ally.pivot.position.copy(sample.pos);
        r.ally.pivot.quaternion.copy(sample.quat);
        if (r.ally.vel) r.ally.vel.copy(sample.vel);
      }
      r.thr.update(r.firing ? 1 : 0.5, dt); // cosmetic plume
      if (r.rcs) r.rcs.update(dt, true);
    }
    if (!isHost) { // JOINER: drive enemy proxy transforms from the host snapshot
      for (const ep of enemyProxies.values()) {
        if (!ep.enemy.alive) continue;
        if (ep.interp.sample(now, sample)) { ep.enemy.pos.copy(sample.pos); ep.enemy.obj.position.copy(sample.pos); ep.enemy.obj.quaternion.copy(sample.quat); ep.enemy.vel.copy(sample.vel); }
      }
    }
  }

  // HOST: enemies pick targets across all humans (local + remotes). Mirrors attract.targetFor.
  function targetFor(e) {
    let best = getLocalPlayer(); let bd = e.pos.distanceToSquared(best.pos);
    for (const r of remotes.values()) {
      if (!r.ally.alive) continue;
      const d = e.pos.distanceToSquared(r.ally.pos);
      if (d < bd) { bd = d; best = r.ally; }
    }
    return best;
  }

  function end() {
    for (const id of [...remotes.keys()]) dropRemoteShip(id);
    enemyProxies.clear();
    try { transport.close(); } catch { /* ignore */ }
  }

  // local player died -> peers remove our ship proxy (instead of it freezing in place)
  function localDead() { transport.send({ t: M.PDEAD, id: myId }); }
  // local player respawned / re-launched -> peers re-show our ship
  function localRespawn() { transport.send({ t: M.PRESPAWN, id: myId }); }

  return { myId, isHost, captureLocal, applyRemotes, targetFor, rosterWithSelf, localDead, localRespawn,
    get myKills() { return myKills; },
    get started() { return started; }, setStarted(v) { started = v; },
    broadcastStart(settings) { if (isHost) transport.send({ t: M.START, settings }); },
    end };
}
