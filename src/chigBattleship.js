import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// Chig battleship — the capital-ship enemy. Bare GLB geometry (chig-battleship.glb, converted from the FBX)
// shaded procedurally in-engine (no textures), the look dialled in the /ship-preview tool: dark-green hull,
// a glowing hex grid (hexagons split into six triangles, side-projected + vertically stretched, rotated
// 90deg) with recessed seams via normal perturbation, + a cyan noise core band that tilts up at the front.

const VERT = /* glsl */`
  varying vec3 vObj; varying vec3 vN; varying vec3 vWorld;
  void main(){
    vObj = position;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */`
  precision highp float;
  varying vec3 vObj; varying vec3 vN; varying vec3 vWorld;
  uniform float uTime, uCell, uVStretch, uLineW, uGlow, uNoiseScale, uBandCenter, uBandW, uBandSoft, uBandTilt, uTiltStart, uTiltSpan, uRecess, uSpecular, uShininess;
  uniform vec3 uBase, uLine, uBandColor, uLightDir;
  uniform int uProjAxis, uBandAxis, uTiltAxis, uView;
  float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float vnoise(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
  float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }
  float hexD(vec2 p){ p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }
  vec2 hexLocal(vec2 uv){
    vec2 r = vec2(1.0, 1.7320508);
    vec2 a = mod(uv, r) - r * 0.5;
    vec2 b = mod(uv - r * 0.5, r) - r * 0.5;
    return dot(a, a) < dot(b, b) ? a : b;
  }
  float gridEdge(vec2 p){
    vec2 gv = hexLocal(p);
    float edge = 0.5 - hexD(gv);
    float ang = atan(gv.y, gv.x);
    float k = floor((ang - 0.5235988) / 1.0471976 + 0.5);
    float aDiff = ang - (0.5235988 + k * 1.0471976);
    float spoke = length(gv) * abs(sin(aDiff));
    return min(edge, spoke);
  }
  void main(){
    vec2 p = uProjAxis == 0 ? vObj.zy : (uProjAxis == 1 ? vObj.xz : vObj.xy);
    p *= uCell; p.y *= uVStretch;
    p = vec2(p.y, -p.x);
    float edge = gridEdge(p);
    float line = 1.0 - smoothstep(0.0, uLineW, edge);
    float hh = 0.05;
    vec2 grad = vec2(gridEdge(p + vec2(hh, 0.0)) - edge, gridEdge(p + vec2(0.0, hh)) - edge) / hh;
    vec2 gradP = vec2(-grad.y, grad.x);
    vec3 inPlane = uProjAxis == 0 ? vec3(0.0, gradP.y, gradP.x) : (uProjAxis == 1 ? vec3(gradP.x, 0.0, gradP.y) : vec3(gradP.x, gradP.y, 0.0));
    float wall = 1.0 - smoothstep(0.0, uLineW * 2.0, edge);
    vec3 N = normalize(vN - inPlane * uRecess * wall);
    vec3 L = normalize(uLightDir);
    vec3 Vd = normalize(cameraPosition - vWorld);
    float ndl = max(dot(N, L), 0.0);
    vec3 Hh = normalize(L + Vd);
    float spec = pow(max(dot(N, Hh), 0.0), uShininess) * uSpecular * step(0.0, dot(vN, L));
    if (uView == 1) { gl_FragColor = vec4(N * 0.5 + 0.5, 1.0); return; }
    if (uView == 2) { gl_FragColor = vec4(vec3(spec), 1.0); return; }
    vec3 col = uBase * (0.22 + 0.95 * ndl);
    col += uLine * line * uGlow;
    col += vec3(spec);
    float bc = uBandAxis == 0 ? vObj.x : (uBandAxis == 1 ? vObj.y : vObj.z);
    float fa = uTiltAxis == 0 ? vObj.x : (uTiltAxis == 1 ? vObj.y : vObj.z);
    float frontDist = max(0.0, (fa - uTiltStart) * sign(uTiltSpan));
    float bcenter = uBandCenter + uBandTilt * frontDist;
    float band = 1.0 - smoothstep(uBandW, uBandW + uBandSoft, abs(bc - bcenter));
    if (band > 0.001) {
      float nz = fbm(vObj * uNoiseScale + vec3(0.0, uTime * 0.35, 0.0));
      col = mix(col, uBandColor * (0.45 + 1.5 * nz), band);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Dialled-in defaults from /ship-preview. `sunDir` aligns the hull lighting with the scene sun.
export async function loadChigBattleship(sunDir) {
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/gltf/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync('/chig-battleship.glb');
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // collect the mesh geometry (the FBX also carried a stray camera + light — skip those), in world space
  const geos = [];
  root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); geos.push(g); } });
  const box = new THREE.Box3();
  for (const g of geos) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // Normalise geometry to max-dim 10 so the procedural grid matches the /ship-preview density; the caller
  // scales the TEMPLATE (which doesn't touch object-space coords, so the grid stays put) for the in-game size.
  const norm = 10.0 / (Math.max(size.x, size.y, size.z) || 1);
  const normalizedHeight = size.y * norm;

  const uniforms = {
    uTime: { value: 0 },
    uBase: { value: new THREE.Color(0x05130b) },
    uLine: { value: new THREE.Color(0x35e0ff) },
    uBandColor: { value: new THREE.Color(0x40e8ff) },
    uLightDir: { value: (sunDir ? sunDir.clone() : new THREE.Vector3(0.4, 0.7, 0.5)).normalize() },
    uCell: { value: 3.0 }, uVStretch: { value: 0.35 }, uLineW: { value: 0.05 }, uGlow: { value: 1.1 },
    uNoiseScale: { value: 18.0 }, uBandCenter: { value: 0.0 }, uBandW: { value: 0.2 }, uBandSoft: { value: 0.35 },
    uProjAxis: { value: 0 }, uBandAxis: { value: 1 }, uBandTilt: { value: 0.5 }, uTiltAxis: { value: 2 },
    uTiltStart: { value: 1.0 }, uTiltSpan: { value: 2.0 }, uRecess: { value: 0.45 }, uSpecular: { value: 0.5 },
    uShininess: { value: 24.0 }, uView: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide });

  const template = new THREE.Group();
  for (const g of geos) {
    g.translate(-c.x, -c.y, -c.z);
    g.scale(norm, norm, norm);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    template.add(m);
  }

  return { template, material, uniforms, normalizedHeight, update(dt) { uniforms.uTime.value += dt; } };
}
