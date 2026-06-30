import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';

// Dynamic lighting + shadow system for the flight scene. Owns:
//   • the SUN shadows via Cascaded Shadow Maps (CSM) — self-shadowing + ship-to-ship shadows. The
//     cascade lights follow the camera frustum so near ships get dense shadow texels while distant
//     ones are still covered out to `maxFar`.
//   • (added in later phases) fixed pools of dynamic lights: thruster spots, muzzle flash, and the
//     proximity-driven "transient" shadow lights for shots/enemy engines that get close to a ship.
//
// Everything here obeys two hard rules so the forward renderer never recompiles on the hot path:
//   1. Lights are allocated ONCE and only ever moved / re-coloured / dimmed; an "off" light is parked
//      at intensity 0, never removed.
//   2. The only operations that recompile materials or rebuild the CSM (resolution / cascade changes,
//      castShadow flips, enabling/disabling shadows) happen on rare, rate-limited QUALITY TIER changes
//      driven by quality.js — never per frame.
//
// CSM gotchas handled here (verified against three r0.185 CSM.js):
//   • csm.setupMaterial() OVERWRITES material.onBeforeCompile. The Chig hull material already uses
//     onBeforeCompile for its fresnel rim, so registerMaterial() composes the two (CSM first, then the
//     original patch). The original patch is stashed in `basePatch` because…
//   • csm.dispose() DELETES material.onBeforeCompile outright — so on every (re)build we must re-apply
//     both the CSM patch and the stashed original patch from scratch.

export function createLighting(scene, camera, renderer, opts = {}) {
  const sunColor = new THREE.Color(opts.sunColor ?? 0xffb070);
  const sunDir = (opts.sunDir ? opts.sunDir.clone() : new THREE.Vector3(-55, 30, -30)).normalize(); // points TO the sun
  const sunIntensity = opts.sunIntensity ?? 2.6;
  let sunMult = opts.sunMult ?? 1; // live brightness multiplier (debug slider), persists across CSM rebuilds
  const travelDir = sunDir.clone().negate(); // direction the sunlight travels (scene-ward)

  // Plain (non-shadow) sun used on the lowest tiers where CSM is disabled, and while the debug viewer
  // owns the frame. Parallel light → direction is all that matters.
  const plainSun = new THREE.DirectionalLight(sunColor.getHex(), sunIntensity * sunMult);
  plainSun.position.copy(sunDir).multiplyScalar(200);
  plainSun.visible = false;
  scene.add(plainSun);

  // Materials registered to receive CSM shadows, and a stash of each one's ORIGINAL onBeforeCompile
  // (or null) so we can survive csm.dispose() deleting it.
  const tracked = new Set();
  const basePatch = new Map();

  let csm = null;
  let suspended = false; // debug viewer owns the frame
  let cascades = 3;
  let shadowMapSize = 2048;
  const CASTER_DIST2 = 160 * 160; // beyond this from the camera, a Chig stops casting sun shadows (few px on screen)

  function normalBiasFor(size) {
    return size >= 4096 ? 0.05 : size >= 2048 ? 0.08 : 0.12;
  }

  function applyCSMToMaterial(mat) {
    csm.setupMaterial(mat); // installs CSM's own onBeforeCompile (+ USE_CSM defines)
    const csmOBC = mat.onBeforeCompile;
    const base = basePatch.get(mat);
    if (base) {
      // run CSM's patch first (sets cascade uniforms), then the original (e.g. the Chig rim)
      mat.onBeforeCompile = function (shader, r) {
        csmOBC.call(this, shader, r);
        base.call(this, shader, r);
      };
    }
    mat.needsUpdate = true;
  }

  function buildCSM() {
    csm = new CSM({
      camera,
      parent: scene,
      cascades,
      maxFar: 600, // ships beyond this are tiny; keep texels dense up close
      mode: 'practical',
      shadowMapSize,
      lightDirection: travelDir.clone(),
      lightIntensity: sunIntensity * sunMult,
      shadowBias: -0.0001,
      lightNear: 1,
      lightFar: 2000,
      lightMargin: 200,
    });
    csm.fade = true; // smooth blend across cascade seams
    const nb = normalBiasFor(shadowMapSize);
    for (const l of csm.lights) {
      l.color.copy(sunColor);
      l.shadow.normalBias = nb;
    }
    csm.updateFrustums();
    for (const m of tracked) applyCSMToMaterial(m);
  }

  function teardownCSM() {
    if (!csm) return;
    csm.dispose(); // strips USE_CSM defines + deletes onBeforeCompile on every tracked material
    csm.remove(); // removes the cascade lights + targets from the scene
    csm = null;
    // dispose() deleted onBeforeCompile, so restore each material's original patch
    for (const m of tracked) {
      const base = basePatch.get(m);
      if (base) m.onBeforeCompile = base;
      else delete m.onBeforeCompile;
      m.needsUpdate = true;
    }
  }

  // Register a lit material so it receives CSM shadows. Idempotent + rebuild-safe: the original
  // onBeforeCompile is captured exactly once.
  function registerMaterial(mat) {
    if (!mat) return;
    if (!basePatch.has(mat)) {
      const own = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') ? mat.onBeforeCompile : null;
      basePatch.set(mat, own || null);
    }
    tracked.add(mat);
    if (csm) applyCSMToMaterial(mat);
  }

  // Collect + register every unique MeshStandardMaterial under a root (ships are multi-part with a
  // couple of cloned materials).
  function registerTree(root) {
    root.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m.isMeshStandardMaterial) registerMaterial(m);
      }
    });
  }

  // --- quality-tier hooks (called only on rare tier changes) ---------------------------------------

  // Rebuild the sun shadows at a new resolution / cascade count. Disposing + recreating is the only
  // reliable way to change CSM resolution; it's off the hot path (tier changes are rate-limited).
  function setSunShadow({ enabled = true, size = shadowMapSize, casc = cascades } = {}) {
    if (suspended) return;
    if (!enabled) {
      teardownCSM();
      plainSun.visible = true;
      return;
    }
    if (csm && size === shadowMapSize && casc === cascades) {
      plainSun.visible = false;
      return;
    }
    shadowMapSize = size;
    cascades = casc;
    teardownCSM();
    buildCSM();
    plainSun.visible = false;
  }

  // --- player thruster lights ----------------------------------------------------------------------
  // Real PointLights at the engine nozzles so the exhaust actually spills colored light onto the rear
  // hull and any ship close behind (not just the emissive glow + bloom). Illumination only — dynamic
  // SHADOWS from the engines are produced by the proximity transient pool (so they only cost a shadow
  // map when there's actually a ship near a thruster to shadow). Intensity tracks thrust each frame.
  const thrusterLights = [];
  // Confined to a small bubble around the nozzles (short `distance`) so the engines light just their
  // immediate hull + anything right behind, instead of washing the whole rear blue.
  const thrusterParams = { color: 0x66c0ff, peak: 20, idle: 1, distance: 12 };

  function attachThrusters(pivot, nozzles, rearDir, shipRadius) {
    thrusterParams.distance = shipRadius * 2.5;
    for (const noz of nozzles) {
      const pl = new THREE.PointLight(thrusterParams.color, 0, thrusterParams.distance, 2);
      pl.position.copy(noz);
      pl.castShadow = false;
      pivot.add(pl);
      thrusterLights.push(pl);
    }
  }

  let thrust01 = 0;
  function setThrusterParams(p) {
    Object.assign(thrusterParams, p);
    for (const pl of thrusterLights) {
      pl.color.set(thrusterParams.color);
      pl.distance = thrusterParams.distance;
    }
  }

  // --- muzzle flash pool ----------------------------------------------------------------------------
  // A tiny pool of warm PointLights pulsed at the gun on each shot (world-space; the gun gimbals). At
  // 27 rounds/s with a ~60ms decay the two lights cross-fade into a steady muzzle glow that lights the
  // nose + any enemy in front. Pooled + parked at intensity 0 when idle (no shader recompiles).
  const MUZZLE_LIFE = 0.06;
  const muzzleParams = { color: 0xffffff, peak: 90, distance: 55 }; // pure-white muzzle flash (sprite + light)
  const muzzlePool = [];
  for (let i = 0; i < 2; i++) {
    const pl = new THREE.PointLight(muzzleParams.color, 0, muzzleParams.distance, 2);
    pl.castShadow = false;
    scene.add(pl);
    muzzlePool.push({ light: pl, life: 0 });
  }
  let muzzleRR = 0;
  function muzzleFlash(pos) {
    muzzleRR = (muzzleRR + 1) % muzzlePool.length;
    const m = muzzlePool[muzzleRR];
    m.light.position.copy(pos);
    m.light.color.set(muzzleParams.color);
    m.light.distance = muzzleParams.distance;
    m.life = MUZZLE_LIFE;
  }

  // --- transient shadow spotlights (proximity: shots / engines that get close to a ship) -----------
  // A small pool of shadow-capable SpotLights re-aimed each frame at the highest-priority emitter->ship
  // pairs: a passing bolt, the player's engine on an enemy's tail, or (strongly preferred) an enemy
  // engine on the Hammerhead's tail. Each both LIGHTS and SHADOWS the receiving ship. How many actually
  // cast = the tier budget (set by quality.js); within a tier we only move/redirect them (no recompile,
  // because the lights stay visible — three.js recounts only VISIBLE lights, so we never toggle that).
  const MAX_TRANSIENT = 3;
  const HAMMERHEAD_BOOST = 4; // strongly prefer lighting/shadowing the player
  const transientParams = { range: 70, angle: 0.7, penumbra: 0.6, intensity: 150, maxDist: 48 };
  const transient = [];
  for (let i = 0; i < MAX_TRANSIENT; i++) {
    const spot = new THREE.SpotLight(0xffffff, 0, transientParams.range, transientParams.angle, transientParams.penumbra, 2);
    spot.castShadow = false; // raised to the tier budget by setTransientBudget (one recompile per change)
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0004;
    spot.shadow.normalBias = 0.4;
    spot.shadow.camera.near = 0.4;
    spot.shadow.camera.far = transientParams.range;
    spot.position.set(0, -1e6, 0); // parked far away until assigned
    const tgt = new THREE.Object3D();
    scene.add(tgt);
    spot.target = tgt;
    scene.add(spot);
    transient.push({ spot, tgt });
  }
  let transientBudget = 0;
  function setTransientBudget(n) {
    transientBudget = THREE.MathUtils.clamp(n | 0, 0, MAX_TRANSIENT);
    for (let i = 0; i < transient.length; i++) {
      const want = i < transientBudget;
      if (transient[i].spot.castShadow !== want) transient[i].spot.castShadow = want; // recompile only on change
    }
  }

  // reused candidate buffer (no per-frame allocation)
  const CAND_MAX = 192;
  const candPool = [];
  for (let i = 0; i < CAND_MAX; i++) candPool.push({ px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, cr: 1, cg: 1, cb: 1, score: 0, dist: 0, bright: 0 });
  let candN = 0;
  const _wp = new THREE.Vector3();

  function addCandidate(px, py, pz, cr, cg, cb, bright, owner, ctx) {
    const player = ctx.player;
    const enemies = ctx.enemies || [];
    let bestD2 = Infinity, bestIsP = false, bx = 0, by = 0, bz = 0, found = false;
    if (owner !== 'player') {
      const dx = player.pos.x - px, dy = player.pos.y - py, dz = player.pos.z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestIsP = true; bx = player.pos.x; by = player.pos.y; bz = player.pos.z; found = true; }
    }
    for (const e of enemies) {
      if (!e.alive || e === owner) continue;
      const dx = e.pos.x - px, dy = e.pos.y - py, dz = e.pos.z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestIsP = false; bx = e.pos.x; by = e.pos.y; bz = e.pos.z; found = true; }
    }
    if (!found) return;
    const dist = Math.sqrt(bestD2);
    if (dist > transientParams.maxDist) return;
    const score = (bright / Math.max(bestD2, 1)) * (bestIsP ? HAMMERHEAD_BOOST : 1);
    if (score <= 1e-5 || candN >= CAND_MAX) return;
    const c = candPool[candN++];
    c.px = px; c.py = py; c.pz = pz; c.tx = bx; c.ty = by; c.tz = bz;
    c.cr = cr; c.cg = cg; c.cb = cb; c.score = score; c.dist = dist; c.bright = bright;
  }

  function assignTransient(ctx) {
    for (const t of transient) t.spot.intensity = 0; // park all
    if (transientBudget === 0 || !ctx || !ctx.player) return;
    candN = 0;
    const enemies = ctx.enemies || [];
    // A) player engines (real nozzle world positions), only while thrusting -> shadow an enemy on the tail
    if (thrust01 > 0.02) {
      for (const pl of thrusterLights) {
        pl.getWorldPosition(_wp);
        addCandidate(_wp.x, _wp.y, _wp.z, 0.40, 0.75, 1.0, thrust01, 'player', ctx);
      }
    }
    // B) enemy engines (always thrusting) -> shadow the Hammerhead (boosted) or another enemy
    for (const e of enemies) {
      if (!e.alive) continue;
      addCandidate(e.pos.x, e.pos.y, e.pos.z, 0.70, 0.55, 1.0, 1.0, e, ctx);
    }
    // C) live bolts whizzing past a ship
    const projs = ctx.projectiles;
    if (projs && projs.live) {
      for (const b of projs.live) addCandidate(b.pos.x, b.pos.y, b.pos.z, 1.0, 0.95, 0.85, 1.0, null, ctx);
    }
    // assign the top `transientBudget` by score to the (shadow-casting) spotlights
    const k = Math.min(transientBudget, candN);
    for (let slot = 0; slot < k; slot++) {
      let mi = -1, ms = -Infinity;
      for (let i = 0; i < candN; i++) if (candPool[i].score > ms) { ms = candPool[i].score; mi = i; }
      if (mi < 0) break;
      const c = candPool[mi];
      c.score = -Infinity; // consume
      const t = transient[slot];
      t.spot.position.set(c.px, c.py, c.pz);
      t.tgt.position.set(c.tx, c.ty, c.tz);
      t.tgt.updateMatrixWorld();
      t.spot.color.setRGB(c.cr, c.cg, c.cb);
      const d = Math.max(transientParams.range, c.dist * 1.6);
      t.spot.distance = d;
      t.spot.shadow.camera.far = d;
      t.spot.shadow.camera.updateProjectionMatrix();
      t.spot.intensity = transientParams.intensity * Math.min(1, c.bright);
    }
  }

  // --- per-frame -----------------------------------------------------------------------------------

  function update(dt, ctx) {
    if (suspended) return;
    if (csm) csm.update(); // reposition cascades onto the current camera frustum (before render)

    // engine light spill tracks throttle (a soft idle glow even at zero thrust)
    thrust01 = THREE.MathUtils.clamp((ctx && ctx.thrust) || 0, 0, 1.5);
    const ti = thrusterParams.idle + (thrusterParams.peak - thrusterParams.idle) * thrust01;
    for (const pl of thrusterLights) pl.intensity = ti;

    // muzzle flashes decay to nothing
    for (const m of muzzlePool) {
      if (m.life > 0) {
        m.life -= dt;
        m.light.intensity = muzzleParams.peak * Math.max(0, m.life / MUZZLE_LIFE);
      } else if (m.light.intensity !== 0) {
        m.light.intensity = 0;
      }
    }

    // Distant-caster LOD: a Chig far from the camera is a few pixels — drop it from the sun shadow pass.
    // Toggling a CASTER's castShadow is free (no recompile); cache state and only traverse on a change.
    const enemies = ctx && ctx.enemies;
    if (enemies) {
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (const e of enemies) {
        if (!e.alive || !e.obj) continue;
        const dx = e.pos.x - cx, dy = e.pos.y - cy, dz = e.pos.z - cz;
        const near = dx * dx + dy * dy + dz * dz < CASTER_DIST2;
        if (e._castLOD !== near) {
          e._castLOD = near;
          e.obj.traverse((o) => { if (o.isMesh) o.castShadow = near; });
        }
      }
    }

    // proximity light+shadow: re-aim the transient spotlights at the closest emitter->ship pairs
    assignTransient(ctx);
  }

  function onResize() {
    if (csm) csm.updateFrustums();
  }

  // Live sun-brightness control (debug slider). `mult` is a multiplier on the base intensity (1..10);
  // applied to the active cascade lights + the plain fallback sun, and remembered so CSM rebuilds keep it.
  function setSunIntensity(mult) {
    sunMult = mult;
    const v = sunIntensity * mult;
    plainSun.intensity = v;
    if (csm) for (const l of csm.lights) l.intensity = v;
  }

  // Per-environment star colour (the cast sunlight): red-dwarf, yellow-white Sol, blue-white dwarf, etc.
  function setSunColor(hex) {
    sunColor.set(hex);
    plainSun.color.set(hex);
    if (csm) for (const l of csm.lights) l.color.set(hex);
  }

  // --- debug viewer interplay ----------------------------------------------------------------------
  // The localhost model-viewer builds its own neutral key + shadow rig and needs the flight sun gone.
  // CSM globally patches lights_fragment_begin (guarded by USE_CSM), and registered model materials
  // carry USE_CSM, so we fully TEAR DOWN CSM while the viewer owns the frame, then rebuild on return.
  let wasCSM = false;
  function setActive(on) {
    for (const pl of thrusterLights) pl.visible = on; // engine lights belong to the flight scene only
    for (const m of muzzlePool) { m.light.visible = on; if (!on) { m.life = 0; m.light.intensity = 0; } }
    if (!on) for (const t of transient) t.spot.intensity = 0; // park transient lights in the viewer
    if (!on) {
      if (suspended) return;
      suspended = true;
      wasCSM = !!csm;
      teardownCSM();
      plainSun.visible = false;
    } else {
      suspended = false;
      if (wasCSM) buildCSM();
      plainSun.visible = !wasCSM;
    }
  }

  // initial build
  buildCSM();

  return {
    registerMaterial,
    registerTree,
    update,
    onResize,
    setSunShadow,
    setSunIntensity,
    setSunColor,
    attachThrusters,
    setThrusterParams,
    thrusterParams,
    muzzleFlash,
    muzzleParams,
    setTransientBudget,
    transientParams,
    get transientBudget() {
      return transientBudget;
    },
    setActive,
    get csm() {
      return csm;
    },
    get sunMult() {
      return sunMult;
    },
    get sunDir() {
      return sunDir;
    },
  };
}
