import * as THREE from 'three';
import { Brush, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Procedural fracture generator (CPU-only — runs in the browser editor AND headless Node).
// Voronoi-via-CSG: for each seed, the cell = hull ∩ (half-space boxes on the seed's side of the
// perpendicular bisector to each nearby seed). Cube/tetra VOIDS are subtracted from the hull first so
// fragments have torn interiors. Cut faces get material group 1 (interior); original hull faces stay
// group 0 — so the consumer renders each fragment with [hullMat, interiorMat]. Optional twist/skew/
// warp distortion per fragment. Seeding is asymmetric (surface-biased + anisotropic) to follow the
// hull. Deterministic from `seed`. Returns a flat node list (hierarchy added in a later pass).

export const DEFAULTS = {
  seed: 1,
  cellCount: 16,
  anisotropy: [1, 1, 1.6], // spread of interior seeds per axis (z = long axis)
  surfaceBias: 0.55, // fraction of seeds sampled on the hull surface (pushed inward) -> shell plates
  inset: 0.25,
  voidCount: 3,
  voidSize: 0.3,
  voidType: 'mix', // 'box' | 'tetra' | 'mix'
  twist: 0.08, // subtle (0..0.3, skewed low) — a nice default variation
  skew: 0.06,
  warp: 0.12,
  warpFreq: 1.5,
  kNeighbors: 12,
  minCellVolume: 1e-4,
  maxDepth: 1, // hierarchical re-break depth (0 = flat list of cells)
  childCount: 4, // sub-cells a chunk splits into
  splitProb: 0.45, // chance a top cell gets a child layer (for runtime re-break)
};

// ---- deterministic RNG + cheap value-noise (for warp) -----------------------------------------
function mulberry32(a) {
  a >>>= 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
           L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm(x, y, z) { let s = 0, a = 0.5; for (let i = 0; i < 3; i++) { s += a * vnoise(x, y, z); x *= 2.02; y *= 2.02; z *= 2.02; a *= 0.5; } return s; }

// ---- hull prep --------------------------------------------------------------------------------
function cleanHull(geo) {
  const g = geo.clone();
  g.deleteAttribute('uv');
  g.deleteAttribute('color');
  g.deleteAttribute('tangent');
  const merged = mergeVertices(g, 1e-4); // weld -> manifold-ish, indexed
  merged.computeVertexNormals();
  return merged;
}

// big oriented box whose near face lies on the perpendicular bisector of (si, sj), occupying si's side
const _xAxis = new THREE.Vector3(1, 0, 0);
function bisectorBoxGeo(si, sj, size) {
  const mid = si.clone().add(sj).multiplyScalar(0.5);
  const n = si.clone().sub(sj).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(_xAxis, n);
  const center = mid.addScaledVector(n, size * 0.5);
  const box = new THREE.BoxGeometry(size, size, size);
  box.applyMatrix4(new THREE.Matrix4().compose(center, q, new THREE.Vector3(1, 1, 1)));
  return box;
}

function voidGeo(opts, sphere, rng) {
  const s = opts.voidSize * sphere.radius * (0.6 + rng() * 0.8);
  const tetra = opts.voidType === 'tetra' || (opts.voidType === 'mix' && rng() < 0.5);
  const g = tetra ? new THREE.TetrahedronGeometry(s) : new THREE.BoxGeometry(s, s, s);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6.28, rng() * 6.28, rng() * 6.28));
  const p = new THREE.Vector3((rng() - 0.5) * sphere.radius, (rng() - 0.5) * sphere.radius, (rng() - 0.5) * sphere.radius * 1.4).add(sphere.center);
  g.applyMatrix4(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// asymmetric seeds: surface-biased (hug the hull -> shell plates) + anisotropic interior
function buildSeeds(geo, opts, rng) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  geo.computeBoundingBox();
  const center = geo.boundingBox.getCenter(new THREE.Vector3());
  const size = geo.boundingBox.getSize(new THREE.Vector3());

  const tris = [];
  let totalArea = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3(), nrm = new THREE.Vector3();
  const triCount = (idx ? idx.count : pos.count) / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    ab.subVectors(b, a); ac.subVectors(c, a); nrm.crossVectors(ab, ac);
    const area = nrm.length() * 0.5;
    if (area < 1e-9) continue;
    nrm.normalize();
    tris.push({ a: a.clone(), b: b.clone(), c: c.clone(), n: nrm.clone(), area });
    totalArea += area;
  }

  const seeds = [];
  const nSurf = Math.min(opts.cellCount, Math.round(opts.cellCount * opts.surfaceBias));
  for (let i = 0; i < nSurf && tris.length; i++) {
    let r = rng() * totalArea, tri = tris[tris.length - 1];
    for (const t of tris) { r -= t.area; if (r <= 0) { tri = t; break; } }
    let u = rng(), v = rng(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const p = tri.a.clone()
      .addScaledVector(new THREE.Vector3().subVectors(tri.b, tri.a), u)
      .addScaledVector(new THREE.Vector3().subVectors(tri.c, tri.a), v)
      .addScaledVector(tri.n, -opts.inset); // push inward
    seeds.push(p);
  }
  const anis = opts.anisotropy;
  for (let i = seeds.length; i < opts.cellCount; i++) {
    seeds.push(new THREE.Vector3(
      center.x + (rng() - 0.5) * size.x * 0.45 * anis[0],
      center.y + (rng() - 0.5) * size.y * 0.45 * anis[1],
      center.z + (rng() - 0.5) * size.z * 0.45 * anis[2],
    ));
  }
  return seeds;
}

function nearest(seeds, i, k) {
  const d = [];
  for (let j = 0; j < seeds.length; j++) { if (j !== i) d.push([seeds[i].distanceToSquared(seeds[j]), j]); }
  d.sort((p, q) => p[0] - q[0]);
  return d.slice(0, k).map((x) => x[1]);
}

function distort(g, c, opts, rng) {
  if (!opts.twist && !opts.skew && !opts.warp) return;
  const pos = g.attributes.position;
  const off = rng() * 100;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dx = v.x - c.x, dy = v.y - c.y, dz = v.z - c.z;
    if (opts.twist) { const ang = opts.twist * dz; const cs = Math.cos(ang), sn = Math.sin(ang); v.x = c.x + dx * cs - dy * sn; v.y = c.y + dx * sn + dy * cs; }
    if (opts.skew) v.x += opts.skew * dy;
    if (opts.warp) {
      const w = opts.warp, f = opts.warpFreq;
      v.x += w * (fbm(v.x * f + off, v.y * f, v.z * f) - 0.5);
      v.y += w * (fbm(v.x * f, v.y * f + off, v.z * f) - 0.5);
      v.z += w * (fbm(v.x * f, v.y * f, v.z * f + off) - 0.5);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
}

// Flatten a fragment's geometry into transferable non-indexed pos/nrm ordered [hull(group0) ...
// interior(group1)] with the new group ranges — for the worker boundary or a bake. Positions are
// recentred on the fragment centroid (so a mover can spin/shrink about its own centre); the centroid
// is returned separately for placement.
const _fa = new THREE.Vector3(), _fb = new THREE.Vector3(), _fc = new THREE.Vector3(), _fab = new THREE.Vector3(), _fac = new THREE.Vector3();
export function fragmentArrays(g, centroid) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const index = g.index;
  const cx = centroid ? centroid.x : 0, cy = centroid ? centroid.y : 0, cz = centroid ? centroid.z : 0;
  const get = (i) => (index ? index.getX(i) : i);
  const bins = [[], []];
  const nb = [[], []];
  const groups = (g.groups && g.groups.length) ? g.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
  for (const gr of groups) {
    const mi = gr.materialIndex ? 1 : 0;
    const end = gr.start + gr.count;
    for (let t = gr.start; t + 2 < end; t += 3) {
      const i0 = get(t), i1 = get(t + 1), i2 = get(t + 2);
      _fa.fromBufferAttribute(pos, i0); _fb.fromBufferAttribute(pos, i1); _fc.fromBufferAttribute(pos, i2);
      _fab.subVectors(_fb, _fa); _fac.subVectors(_fc, _fa);
      if (_fab.cross(_fac).lengthSq() < 1e-10) continue; // drop degenerate / sliver triangle
      for (const vi of [i0, i1, i2]) {
        bins[mi].push(pos.getX(vi) - cx, pos.getY(vi) - cy, pos.getZ(vi) - cz);
        if (nrm) nb[mi].push(nrm.getX(vi), nrm.getY(vi), nrm.getZ(vi));
      }
    }
  }
  const p = Float32Array.from(bins[0].concat(bins[1]));
  const n = Float32Array.from(nb[0].concat(nb[1]));
  const ranges = [];
  if (bins[0].length) ranges.push([0, bins[0].length / 3, 0]);
  if (bins[1].length) ranges.push([bins[0].length / 3, bins[1].length / 3, 1]);
  return { pos: p, nrm: n, groups: ranges };
}

// Build a cleaned, non-indexed, group-tagged geometry (degenerate triangles dropped) from a raw CSG
// cell geometry — used so both the editor and the worker emit optimized fragments.
function cleanGeometry(g) {
  const fa = fragmentArrays(g);
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.BufferAttribute(fa.pos, 3));
  if (fa.nrm.length) cg.setAttribute('normal', new THREE.BufferAttribute(fa.nrm, 3));
  for (const [s, c, mi] of fa.groups) cg.addGroup(s, c, mi);
  return cg;
}

// Fracture one brush into cells (each: { brush, geometry: cleaned, centroid }). `seedGeo` provides the
// bounds for seeding; `brush` is what actually gets clipped (the hull, or a parent cell for re-break).
function fractureBrush(ev, matHull, matInterior, brush, seedGeo, opts, rng) {
  seedGeo.computeBoundingBox();
  const sphere = seedGeo.boundingBox.getBoundingSphere(new THREE.Sphere());
  const boxSize = Math.max(sphere.radius * 6, 1);
  const seeds = buildSeeds(seedGeo, opts, rng);
  const k = Math.min(opts.kNeighbors, Math.max(1, seeds.length - 1));
  const cells = [];
  for (let i = 0; i < seeds.length; i++) {
    let cell = brush;
    let ok = true;
    for (const j of nearest(seeds, i, k)) {
      const bb = new Brush(bisectorBoxGeo(seeds[i], seeds[j], boxSize), matInterior);
      bb.updateMatrixWorld();
      try { cell = ev.evaluate(cell, bb, INTERSECTION); cell.updateMatrixWorld(); } catch (e) { ok = false; break; }
    }
    if (!ok) continue;
    const g = cell.geometry;
    if (!g || !g.attributes.position || g.attributes.position.count < 12) continue;
    g.computeBoundingBox();
    const cs = g.boundingBox.getSize(new THREE.Vector3());
    if (cs.x * cs.y * cs.z < opts.minCellVolume) continue;
    const centroid = g.boundingBox.getCenter(new THREE.Vector3());
    distort(g, centroid, opts, rng);
    g.computeVertexNormals();
    cells.push({ brush: cell, geometry: cleanGeometry(g), centroid });
  }
  return cells;
}

// Per-node runtime behaviour weights: chunks with children may re-break to reveal finer pieces; the
// rest detach; a few vaporize. (Applied with randomness at burst time.)
function ruleFor(depth, hasChildren) {
  return { reBreak: hasChildren ? 0.55 : 0, destroy: depth === 0 ? 0.15 : 0.3 };
}

// Main entry. `geometry` is the hull in final (template) space. Returns { nodes, roots, materials }.
export function generateFracture(geometry, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const rng = mulberry32(opts.seed);
  const ev = new Evaluator();
  ev.useGroups = true;
  ev.attributes = ['position', 'normal']; // ignore uv so hull (no uv) and cutter boxes (uv) match
  const matHull = new THREE.MeshStandardMaterial({ name: 'hull' }); // group 0 (consumer swaps these)
  const matInterior = new THREE.MeshStandardMaterial({ name: 'interior' }); // group 1 (cut faces)

  const hullGeo = cleanHull(geometry);
  hullGeo.computeBoundingBox();
  const sphere = hullGeo.boundingBox.getBoundingSphere(new THREE.Sphere());
  const boxSize = sphere.radius * 6;

  // voids first (shared matInterior so all cut faces land in one group)
  let hullBrush = new Brush(hullGeo, matHull);
  hullBrush.updateMatrixWorld();
  for (let i = 0; i < opts.voidCount; i++) {
    const vb = new Brush(voidGeo(opts, sphere, rng), matInterior);
    vb.updateMatrixWorld();
    try {
      const out = ev.evaluate(hullBrush, vb, SUBTRACTION);
      out.updateMatrixWorld();
      hullBrush = out;
    } catch (e) { /* skip a bad void */ }
  }

  // Build the fracture TREE: top cells, then re-fracture some of them into children (one+ levels) so
  // the runtime can choose to detach a whole chunk or re-break it into finer pieces.
  const nodes = [];
  const roots = [];
  const NODE_CAP = 48; // bound total fragments per variation

  function recurse(brush, seedGeo, parentId, depth) {
    const sub = depth > 0;
    const childOpts = sub
      ? { ...opts, cellCount: opts.childCount, voidCount: 0, surfaceBias: 0.3, kNeighbors: Math.min(opts.kNeighbors, opts.childCount + 2) }
      : opts;
    const cells = fractureBrush(ev, matHull, matInterior, brush, seedGeo, childOpts, rng);
    for (const cell of cells) {
      const node = { id: nodes.length, geometry: cell.geometry, centroid: cell.centroid, parent: parentId, depth, children: [], rule: null };
      nodes.push(node);
      if (parentId == null) roots.push(node.id); else nodes[parentId].children.push(node.id);
      if (depth < opts.maxDepth && nodes.length < NODE_CAP && rng() < opts.splitProb) {
        recurse(cell.brush, cell.brush.geometry, node.id, depth + 1);
      }
      node.rule = ruleFor(depth, node.children.length > 0);
    }
  }
  recurse(hullBrush, hullGeo, null, 0);

  return { nodes, roots, materials: [matHull, matInterior] };
}
