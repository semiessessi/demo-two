import * as THREE from 'three';
import { generateFracture, fragmentArrays, DEFAULTS } from './fracture-gen.js';

// Web Worker: generates fracture variations off the main thread so the pool can grow without hitching
// the game. main posts the hull (pos[+index]) once; we generate `count` variations and post each back
// as transferable fragment arrays (the first one ASAP so deaths get debris quickly).

self.onmessage = (e) => {
  const m = e.data;
  if (m.type !== 'gen') return;
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  if (m.index) hull.setIndex(new THREE.BufferAttribute(m.index, 1));
  const count = m.count || 64;
  const opts = m.opts || {};

  for (let v = 0; v < count; v++) {
    let res;
    try {
      res = generateFracture(hull, { ...DEFAULTS, ...opts, seed: v + 1 });
    } catch (err) {
      self.postMessage({ type: 'error', seed: v + 1, msg: String(err && err.message || err) });
      continue;
    }
    const nodesOut = [];
    const transfer = [];
    for (const node of res.nodes) {
      const fa = fragmentArrays(node.geometry, node.centroid); // recentred on the node's COM
      nodesOut.push({
        id: node.id, parent: node.parent, depth: node.depth, rule: node.rule,
        centroid: [node.centroid.x, node.centroid.y, node.centroid.z],
        pos: fa.pos, nrm: fa.nrm, groups: fa.groups,
      });
      transfer.push(fa.pos.buffer);
      if (fa.nrm.length) transfer.push(fa.nrm.buffer);
    }
    self.postMessage({ type: 'variation', seed: v + 1, nodes: nodesOut, roots: res.roots }, transfer);
  }
  self.postMessage({ type: 'done', count });
};
