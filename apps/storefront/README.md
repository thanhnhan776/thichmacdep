# Local storefront

From the repository root, follow the fresh setup in the [root README](../../README.md). Run `corepack pnpm dev:storefront:worker` for the data-backed local storefront at `http://localhost:4200`. It builds and starts both Workers against local D1. The Angular development server (`corepack pnpm dev:storefront`) is for admin/proxy work and is **not data-backed SSR**; it uses the same port.

The Workers Assets binding serves browser files. `corepack pnpm test:storefront` runs component tests; `corepack pnpm test:storefront:ssr` checks sample Worker HTML and JavaScript assets, and `corepack pnpm test:storefront:catalog` checks data-backed SSR with isolated synthetic data.

Phase 3 is complete locally with caveats: the owner accepted the storefront, and local SSR, synthetic import-to-render and Chrome hydration/responsive/keyboard smoke tests passed. This is not an exhaustive accessibility audit. Deployment and production host configuration remain unverified. See the [compatibility report](../../docs/phase-0-compatibility.md).
# Admin import configuration

The admin UI is at `/admin/import`. The public Google OAuth **client ID** comes from the API's `GOOGLE_CLIENT_ID` and must be authorized for the admin origin in Google Cloud. Never put a client secret in the browser. The API must be reachable at `/api` on the same origin, with `ADMIN_ORIGIN` set to that exact origin. The initial owner is provisioned manually; signed-in admins can add other lowercase Gmail addresses from the import screen. Google Identity Services must be allowed by the site's CSP. HTTPS is required except for the backend's explicit localhost development opt-in.

The browser requests a login challenge with a same-origin JSON `POST /api/admin/auth/challenge`. The API requires its `Origin` header to exactly match `ADMIN_ORIGIN`; missing or different origins are rejected. GET does not issue a challenge.
