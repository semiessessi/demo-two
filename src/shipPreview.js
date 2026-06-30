import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import GUI from 'lil-gui';

// Standalone dev viewer for the capital-ship models (open /ship-preview.html). Loads the raw source meshes
// in-browser (Saratoga STL, Chig battleship FBX), auto-centres + normalises them, and applies the procedural
// ship shaders so the look can be dialled live with the lil-gui panel — no texturing pipeline needed.

const app = document.getElementById('app');
const loadingEl = document.getElementById('loading');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); // dev tool: keep the buffer so screenshots work
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x05060a, 1);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 2000);
camera.position.set(8, 4, 14);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// lighting: a key "sun" + cool fill + a touch of ambient so bare geometry reads
const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
sun.position.set(6, 8, 4);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x9fc0ff, 0.6);
fill.position.set(-6, -2, -5);
scene.add(fill);
scene.add(new THREE.AmbientLight(0x223044, 0.6));
scene.add(new THREE.HemisphereLight(0x223044, 0x0a0c10, 0.5));

// a faint grid + stars so it doesn't feel like a void
const grid = new THREE.GridHelper(40, 40, 0x1b2630, 0x101820);
grid.position.y = -0.001;
scene.add(grid);
(() => {
  const g = new THREE.BufferGeometry();
  const n = 1500, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const r = 400 + Math.random() * 600, t = Math.random() * 6.283, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u); a[i*3]=r*s*Math.cos(t); a[i*3+1]=r*u; a[i*3+2]=r*s*Math.sin(t); }
  g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8899aa, size: 1.2, sizeAttenuation: false })));
})();

// ---------------------------------------------------------------------------
// Chig battleship shader: dark hull + glowing TRIANGULAR grid (side-projected,
// vertically stretched) + a bright cyan, noise-modulated band across the middle
// ("cuboid" section). Recess depth is modelled into the mesh later; this is the look.
// ---------------------------------------------------------------------------
const chigUniforms = {
  uTime: { value: 0 },
  uBase: { value: new THREE.Color(0x05130b) },      // near-black dark green
  uLine: { value: new THREE.Color(0x35e0ff) },      // glowing triangle-edge lines (cyan)
  uBandColor: { value: new THREE.Color(0x40e8ff) }, // cyan core band
  uLightDir: { value: new THREE.Vector3(6, 8, 4).normalize() },
  uCell: { value: 14.0 },        // grid frequency (cells across the model)
  uVStretch: { value: 0.5 },     // <1 = triangles stretched TALL
  uLineW: { value: 0.06 },       // glowing line thickness
  uGlow: { value: 1.6 },         // emissive strength of the lines
  uNoiseScale: { value: 5.0 },   // band noise frequency
  uBandCenter: { value: 0.0 },   // band position along uBandAxis (normalised object coords)
  uBandW: { value: 0.3 },        // band half-extent (narrow slice across the middle)
  uBandSoft: { value: 0.12 },    // band edge softness
  uProjAxis: { value: 0 },       // 0=X (left/right), 1=Y, 2=Z
  uBandAxis: { value: 1 },       // axis the central band runs across
};

const CHIG_VERT = /* glsl */`
  varying vec3 vObj; varying vec3 vN;
  void main(){
    vObj = position;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const CHIG_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vObj; varying vec3 vN;
  uniform float uTime, uCell, uVStretch, uLineW, uGlow, uNoiseScale, uBandCenter, uBandW, uBandSoft;
  uniform vec3 uBase, uLine, uBandColor, uLightDir;
  uniform int uProjAxis, uBandAxis;
  float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float vnoise(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
  float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }
  // equilateral triangular grid: three line families 60deg apart -> distance to nearest line (0 on a line)
  float gridEdge(vec2 p){
    float a = abs(fract(p.x) - 0.5);
    float b = abs(fract(dot(p, vec2(0.5, 0.8660254))) - 0.5);
    float c = abs(fract(dot(p, vec2(-0.5, 0.8660254))) - 0.5);
    return min(min(a,b),c);
  }
  void main(){
    // side projection: the grid is painted from one axis (default X = left/right)
    vec2 p = uProjAxis == 0 ? vObj.zy : (uProjAxis == 1 ? vObj.xz : vObj.xy);
    p *= uCell; p.y *= uVStretch;
    float edge = gridEdge(p);
    float line = 1.0 - smoothstep(0.0, uLineW, edge);   // glowing triangle lines

    vec3 col = uBase;
    float ndl = max(dot(normalize(vN), normalize(uLightDir)), 0.0);
    col *= 0.22 + 0.95 * ndl;                            // hull shading
    col += uLine * line * uGlow;                         // emissive triangle grid

    // bright cyan, noise-modulated band across the central ("cuboid") section
    float bc = uBandAxis == 0 ? vObj.x : (uBandAxis == 1 ? vObj.y : vObj.z);
    float band = 1.0 - smoothstep(uBandW, uBandW + uBandSoft, abs(bc - uBandCenter));
    if (band > 0.001) {
      float nz = fbm(vObj * uNoiseScale + vec3(0.0, uTime * 0.35, 0.0));
      vec3 bandCol = uBandColor * (0.45 + 1.5 * nz);
      col = mix(col, bandCol, band);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;
const chigMat = new THREE.ShaderMaterial({ uniforms: chigUniforms, vertexShader: CHIG_VERT, fragmentShader: CHIG_FRAG, side: THREE.DoubleSide });

// Saratoga: lit metal placeholder (triplanar procedural detail comes later)
const saratogaMat = new THREE.MeshStandardMaterial({ color: 0x8b929c, metalness: 0.7, roughness: 0.5, flatShading: false, side: THREE.DoubleSide });

// ---------------------------------------------------------------------------
let current = null; // the loaded model group/mesh in the scene

function clearCurrent() {
  if (current) { scene.remove(current); current.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); current = null; }
}

// centre the geometry on its bounding-box centre and scale so the max dimension == `size`
function normalizeGeometry(geo, size = 10) {
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);
  const d = geo.boundingBox.getSize(new THREE.Vector3());
  const m = Math.max(d.x, d.y, d.z) || 1;
  geo.scale(size / m, size / m, size / m);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
}

function frameModel() {
  const r = 8; // normalized models are ~10 across
  camera.position.set(r * 1.1, r * 0.5, r * 1.6);
  controls.target.set(0, 0, 0);
  controls.update();
}

function loadSaratoga() {
  clearCurrent();
  loadingEl.style.display = 'flex'; loadingEl.textContent = 'loading Saratoga STL…';
  new STLLoader().load('/preview/Saratoga.stl', (geo) => {
    normalizeGeometry(geo, 12);
    const mesh = new THREE.Mesh(geo, saratogaMat);
    current = mesh; scene.add(mesh);
    loadingEl.style.display = 'none'; frameModel();
  }, undefined, (e) => { loadingEl.textContent = 'failed to load Saratoga.stl'; console.error(e); });
}

function loadChig() {
  clearCurrent();
  loadingEl.style.display = 'flex'; loadingEl.textContent = 'loading Chig battleship FBX…';
  new FBXLoader().load('/preview/chig-battleship.fbx', (obj) => {
    // merge into one normalized mesh-group: collect geometry, apply the chig shader
    const group = new THREE.Group();
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (o.isMesh && o.geometry) {
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        group.userData._geos = group.userData._geos || [];
        group.userData._geos.push(g);
      }
    });
    // normalize using the combined bounds, then add each piece with the chig material
    const box = new THREE.Box3();
    for (const g of group.userData._geos) { g.computeBoundingBox(); box.union(g.boundingBox); }
    const c = box.getCenter(new THREE.Vector3());
    const d = box.getSize(new THREE.Vector3());
    const s = 10 / (Math.max(d.x, d.y, d.z) || 1);
    for (const g of group.userData._geos) {
      g.translate(-c.x, -c.y, -c.z); g.scale(s, s, s); g.computeVertexNormals();
      group.add(new THREE.Mesh(g, chigMat));
    }
    current = group; scene.add(group);
    loadingEl.style.display = 'none'; frameModel();
  }, undefined, (e) => { loadingEl.textContent = 'failed to load chig-battleship.fbx'; console.error(e); });
}

// ---------------------------------------------------------------------------
const params = { model: 'Chig battleship', autoRotate: false, showGrid: true };
const gui = new GUI({ title: 'Ship Preview' });
gui.add(params, 'model', ['Chig battleship', 'Saratoga']).name('Model').onChange((v) => { v === 'Saratoga' ? loadSaratoga() : loadChig(); });
gui.add(params, 'autoRotate').name('Auto-rotate');
gui.add(params, 'showGrid').name('Floor grid').onChange((v) => { grid.visible = v; });

const cf = gui.addFolder('Chig hull');
cf.addColor({ base: '#' + chigUniforms.uBase.value.getHexString() }, 'base').name('Hull colour').onChange((v) => chigUniforms.uBase.value.set(v));
cf.addColor({ line: '#' + chigUniforms.uLine.value.getHexString() }, 'line').name('Grid lines').onChange((v) => chigUniforms.uLine.value.set(v));
cf.add(chigUniforms.uCell, 'value', 2, 60, 0.5).name('Cell size');
cf.add(chigUniforms.uVStretch, 'value', 0.1, 2.0, 0.05).name('Vertical stretch');
cf.add(chigUniforms.uLineW, 'value', 0.005, 0.25, 0.005).name('Line width');
cf.add(chigUniforms.uGlow, 'value', 0, 4, 0.1).name('Line glow');
cf.add(chigUniforms.uProjAxis, 'value', { 'Project from X (sides)': 0, 'from Y': 1, 'from Z': 2 }).name('Grid projection');

const bf = gui.addFolder('Chig core band');
bf.addColor({ c: '#' + chigUniforms.uBandColor.value.getHexString() }, 'c').name('Band colour').onChange((v) => chigUniforms.uBandColor.value.set(v));
bf.add(chigUniforms.uBandAxis, 'value', { 'X': 0, 'Y': 1, 'Z': 2 }).name('Band axis');
bf.add(chigUniforms.uBandCenter, 'value', -6, 6, 0.05).name('Band center');
bf.add(chigUniforms.uBandW, 'value', 0, 5, 0.05).name('Band width');
bf.add(chigUniforms.uBandSoft, 'value', 0.01, 3, 0.05).name('Band softness');
bf.add(chigUniforms.uNoiseScale, 'value', 0.5, 20, 0.5).name('Noise scale');

// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  chigUniforms.uTime.value += dt;
  if (params.autoRotate && current) current.rotation.y += dt * 0.3;
  controls.update();
  renderer.render(scene, camera);
}
animate();
loadChig(); // default to the model we're actively designing
