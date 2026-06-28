$ErrorActionPreference = "Stop"
npm ci
npm run build
npm run deploy

# Social/multiplayer backend (sign-in, friends, leaderboards): apply D1 migrations + deploy the worker.
# Uses the root-installed wrangler (npx walks up to ./node_modules). Secrets are set once via
# `wrangler secret put` and persist across deploys; the /api/* route is added once in the dashboard.
Push-Location worker
try {
  npx wrangler d1 migrations apply demo-two-social --remote
  npx wrangler deploy
} finally {
  Pop-Location
}
