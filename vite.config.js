import { defineConfig } from 'vite';

// Modern ESM app with dynamic imports + top-level await in main.js, so build for a
// target (es2022) that supports it. Mirrors demo-1.
export default defineConfig({
  build: {
    target: 'es2022',
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
