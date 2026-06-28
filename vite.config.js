import { defineConfig } from 'vite';

// Modern ESM app with dynamic imports + top-level await in main.js, so build for a
// target (es2022) that supports it. Mirrors demo-1.
export default defineConfig({
  build: {
    target: 'es2022',
    // The only chunks over Vite's default 500 kB are VENDOR, not app code: three.js (~690 kB, its own
    // cached chunk, ~177 kB gzip) and the Draco decoder (loaded on demand for the compressed .glb models).
    // The app chunk itself is ~157 kB. Raise the warning to the real vendor baseline so it stops false-alarming.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Split three.js into its own chunk: it rarely changes (caches across app deploys)
        // and keeps the app chunk well under the 500 kB warning. Trailing slash so three-mesh-bvh /
        // three-bvh-csg (debug-only, dynamically imported) DON'T get pulled into the eager three chunk.
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
        },
      },
    },
  },
});
