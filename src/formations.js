// Formation slot offsets relative to the formation anchor, in the anchor's local frame:
//   x = lateral (right +),  y = vertical (up +),  z = fore/aft (behind the leader +)
// Slot 0 is the leader at the origin. Returns plain {x,y,z} offsets (count of them).

export function formationSlots(pattern, count, spacing = 7) {
  const s = spacing;
  const out = [{ x: 0, y: 0, z: 0 }]; // leader
  for (let i = 1; i < count; i++) {
    if (pattern === 'line') {
      const side = i % 2 === 1 ? 1 : -1;
      const rank = Math.ceil(i / 2);
      out.push({ x: side * rank * s, y: 0, z: 0 });
    } else if (pattern === 'box') {
      const col = i % 2 === 1 ? 1 : -1;
      const row = Math.ceil(i / 2);
      out.push({ x: col * s * 0.6, y: 0, z: row * s });
    } else if (pattern === 'echelon') {
      out.push({ x: i * s * 0.7, y: 0, z: i * s * 0.7 });
    } else {
      // 'vee' (default): wingmen fan out behind the leader
      const side = i % 2 === 1 ? 1 : -1;
      const rank = Math.ceil(i / 2);
      out.push({ x: side * rank * s * 0.8, y: 0, z: rank * s });
    }
  }
  return out.slice(0, count);
}

export const FORMATION_PATTERNS = ['vee', 'line', 'box', 'echelon'];
