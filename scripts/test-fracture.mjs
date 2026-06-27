// Headless smoke test for the CSG fracture path. Run: node scripts/test-fracture.mjs
import * as THREE from 'three';
import { Brush, Evaluator, INTERSECTION } from 'three-bvh-csg';
import { generateFracture } from '../src/fracture-gen.js';

// --- minimal CSG op: intersect a box hull (x in [-2,2]) with a slab (x in [0,20]) -> expect ~half ---
{
  const hull = new THREE.BoxGeometry(4, 2, 8);
  const cutter = new THREE.BoxGeometry(20, 20, 20).translate(10, 0, 0);
  const a = new Brush(hull); a.updateMatrixWorld();
  const b = new Brush(cutter); b.updateMatrixWorld();
  const ev = new Evaluator();
  const r = ev.evaluate(a, b, INTERSECTION);
  console.log('[minimal] result verts:', r.geometry?.attributes?.position?.count, 'groups:', r.geometry?.groups?.length);
}

// --- full generator ---
const hull = new THREE.BoxGeometry(4, 2, 8, 2, 2, 4);
const res = generateFracture(hull, { seed: 3, cellCount: 16, voidCount: 2, warp: 0.12, twist: 0.06 });
console.log('[full] fragments', res.nodes.length, '/ seeds', res.seedCount);
console.log('OK');
