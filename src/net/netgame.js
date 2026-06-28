import * as THREE from 'three';
import { createAlly } from '../ally.js';
import { createThrusters } from '../thruster.js';
import { createRcs } from '../rcs.js';
import { M, STATE_HZ, createInterpolator, packV, packQ } from './protocol.js';

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

  // --- transport wiring ------------------------------------------------------------------------------
  transport.onConnected(() => {
    if (isHost) {
      // wait for the joiner's hello, then welcome + roster (handled in onMessage)
    } else {
      transport.send({ t: M.HELLO, id: myId, name: myName, livery: myLivery, ver: 1 });
    }
  });

  transport.onMessage((msg) => {
    if (!msg || !msg.t) return;
    switch (msg.t) {
      case M.HELLO: { // host: a joiner announced itself
        if (!isHost) return;
        if (!roster.find((p) => p.id === msg.id)) roster.push({ id: msg.id, name: msg.name, livery: msg.livery });
        makeRemoteShip(msg.id, msg.name, msg.livery);
        transport.send({ t: M.WELCOME, yourId: msg.id, hostId: myId, host: { name: myName, livery: myLivery },
          roster: roster.map((p) => ({ id: p.id, name: p.name, livery: p.livery })),
          settings: opts.getSettings ? opts.getSettings() : null, started });
        if (opts.onRoster) opts.onRoster(rosterWithSelf());
        break;
      }
      case M.WELCOME: { // joiner: learn the host + roster, build remote proxies
        makeRemoteShip(msg.hostId, msg.host?.name || 'Host', msg.host?.livery);
        roster.length = 0;
        for (const p of msg.roster || []) if (p.id !== myId) { roster.push(p); if (!remotes.has(p.id)) makeRemoteShip(p.id, p.name, p.livery); }
        if (msg.settings && opts.onSettings) opts.onSettings(msg.settings);
        if (msg.started && opts.onStart) opts.onStart(msg.settings);
        if (opts.onRoster) opts.onRoster(rosterWithSelf());
        break;
      }
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
      case M.EDEATH: { for (const d of msg.deaths || []) { enemyMgr.killByHash(d.h, d.type); enemyProxies.delete(d.h); } break; }
      case M.EFIRE: { for (const f of msg.fires || []) spawnEnemyBolt(f); break; }
      case M.EHIT: { if (isHost) applyEnemyHit(msg.h, msg.dmg); break; }
      case M.PFIRE: { /* cosmetic remote tracer — visual only, handled via firing flag for now */ break; }
      case M.PDEAD: { const r = remotes.get(msg.id); if (r && r.ally.destroy) r.ally.destroy(); break; }
      case M.PRESPAWN: { const r = remotes.get(msg.id); if (r && r.ally.patch) r.ally.patch(); break; }
      case M.LEAVE: case M.FULL: { if (opts.onLeave) opts.onLeave(msg); break; }
      default: break;
    }
  });

  transport.onDisconnected(() => { if (opts.onDisconnect) opts.onDisconnect(); });

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
  function applyEnemyHit(hash, dmg) {
    for (const e of enemyMgr.enemies) {
      if (e.hash === hash && e.alive) {
        e.hp -= dmg;
        if (e.hp <= 0) { enemyMgr.kill(e); /* edeath emitted in flushHost via death scan */ }
        return;
      }
    }
  }
  // HOST: enemy-hit callback for combat — applies locally + (deaths broadcast in flushHost).
  if (isHost && combat.setOnEnemyHit) combat.setOnEnemyHit((e, dmg) => applyEnemyHit(e.hash, dmg));
  // JOINER: report the hit to the host; the spark is already drawn by combat.
  if (!isHost && combat.setOnEnemyHit) combat.setOnEnemyHit((e, dmg) => transport.send({ t: M.EHIT, h: e.hash, dmg }));

  // HOST: detect spawns/deaths since last tick to emit espawn/edeath.
  const knownHashes = new Set();
  function hostEnemyEvents() {
    const espawn = [], edeath = [];
    const now = new Set();
    for (const e of enemyMgr.enemies) {
      now.add(e.hash);
      if (e.alive && !knownHashes.has(e.hash)) espawn.push({ h: e.hash, kind: 0, p: packV(e.pos), q: packQ(e.obj.quaternion) });
      if (!e.alive && knownHashes.has(e.hash)) edeath.push({ h: e.hash, type: e.death?.type || 'instant', p: packV(e.pos) });
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

  return { myId, isHost, captureLocal, applyRemotes, targetFor, rosterWithSelf,
    get started() { return started; }, setStarted(v) { started = v; },
    broadcastStart(settings) { if (isHost) transport.send({ t: M.START, settings }); },
    end };
}
