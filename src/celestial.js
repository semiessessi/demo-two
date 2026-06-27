import * as THREE from 'three';

// Per-environment background bodies that sit at "infinity" (re-centred on the camera each frame, like
// the nebula/sun). Currently: Jupiter (textured sphere + a soft fresnel atmosphere limb, adapted from
// the stars-clone gas-giant limb-glow technique) and a basic Cerberus black hole (event horizon +
// tilted accretion disk + photon ring). Lit by the scene's existing sun direction.

// --- Jupiter -----------------------------------------------------------------
export function createJupiter(renderer) {
  const group = new THREE.Group();
  group.visible = false;

  const loader = new THREE.TextureLoader();
  const tex = loader.load('/jupiter.png');
  tex.colorSpace = THREE.NoColorSpace; // raw ShaderMaterial decodes sRGB manually (pow 2.2) below
  if (renderer) tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const R = 520; // apparent size; placed ~3400 units out (in front of the stars) -> a big sky planet
  // Custom-lit so its brightness / terminator / night-side ambient / saturation are independent of the
  // scene's gameplay lighting (otherwise it blows out + the dark side reads too bright). Tunable.
  const planetMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uSunDir: { value: new THREE.Vector3(-55, 30, -30).normalize() },
      uExposure: { value: 0.5 }, // overall brightness
      uAmbient: { value: 0.04 }, // night-side fill (keep low so the dark limb stays dark)
      uSat: { value: 0.6 }, // desaturate the (very saturated) Hubble map
    },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform vec3 uSunDir; uniform float uExposure; uniform float uAmbient; uniform float uSat;
      varying vec2 vUv; varying vec3 vN;
      void main(){
        vec3 base = pow(texture2D(uMap, vUv).rgb, vec3(2.2)); // sRGB -> linear
        float l = dot(base, vec3(0.299, 0.587, 0.114));
        base = mix(vec3(l), base, uSat);
        float ndl = max(dot(normalize(vN), normalize(uSunDir)), 0.0);
        float light = uAmbient + (1.0 - uAmbient) * ndl; // lambert + small ambient
        gl_FragColor = vec4(base * light * uExposure, 1.0); // linear; OutputPass tone-maps + encodes
      }`,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), planetMat);
  planet.renderOrder = -3; // behind the action, in front of stars/nebula

  // Soft atmosphere limb: a slightly larger additive shell glowing at the rim (fresnel), brightest on
  // the sunlit side so the terminator stays believable. No hard edge -> the planet fades into space.
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xcbb187) }, // warm jovian haze
      uSunDir: { value: new THREE.Vector3(-55, 30, -30).normalize() },
      uPower: { value: 3.2 },
      uStrength: { value: 1.15 },
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vWorld;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform vec3 uSunDir; uniform float uPower; uniform float uStrength;
      varying vec3 vN; varying vec3 vWorld;
      void main(){
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(normalize(vN), V), 0.0), uPower); // limb glow
        float lit = smoothstep(-0.35, 0.5, dot(normalize(vN), normalize(uSunDir))); // dimmer on the night limb
        float a = fres * uStrength * mix(0.25, 1.0, lit);
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.045, 96, 64), atmoMat);
  atmo.renderOrder = -2;
  group.add(planet, atmo);

  return { group, planet, planetMat, atmoMat, radius: R };
}

// --- Cerberus black hole (basic; iterate later) ------------------------------
export function createBlackHole() {
  const group = new THREE.Group();
  group.visible = false;

  const R = 320;
  // event horizon — pure black, writes depth so it occludes stars/nebula behind it
  const hole = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  hole.renderOrder = -3;

  // photon ring — a thin, very bright ring hugging the horizon
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const photon = new THREE.Mesh(new THREE.RingGeometry(R * 1.02, R * 1.14, 128), ringMat);
  photon.renderOrder = -1;

  // accretion disk — a hot annulus, tilted, hotter (whiter) toward the inner edge
  const diskMat = new THREE.ShaderMaterial({
    uniforms: { uInner: { value: new THREE.Color(0xfff1c0) }, uOuter: { value: new THREE.Color(0xb83a12) } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying float vR;
      void main(){ vUv = uv; vR = length(position.xy); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uInner; uniform vec3 uOuter; varying vec2 vUv; varying float vR;
      void main(){
        float t = clamp((vR - ${(R * 1.25).toFixed(1)}) / ${(R * 2.6 - R * 1.25).toFixed(1)}, 0.0, 1.0); // 0 inner -> 1 outer
        vec3 col = mix(uInner, uOuter, t);
        float edge = smoothstep(1.0, 0.7, t) * smoothstep(0.0, 0.18, t); // fade both rims
        gl_FragColor = vec4(col * (1.6 - t), edge);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const disk = new THREE.Mesh(new THREE.RingGeometry(R * 1.25, R * 2.6, 160, 1), diskMat);
  disk.rotation.x = -1.15; // tilt the disk toward the viewer
  disk.renderOrder = -2;

  group.add(hole, photon, disk);
  return { group, radius: R };
}
