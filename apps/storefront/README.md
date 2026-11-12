# Storefront Phase 0 proof

From the repository root, follow the fresh setup in the [root README](../../README.md). `corepack pnpm dev:storefront` runs Angular's development server at `http://localhost:4200/products/sample`.

For the local Workers runtime, run `corepack pnpm build:storefront` followed by `corepack pnpm dev:storefront:worker`, then request `/products/sample` at the displayed URL. The Workers Assets binding serves browser files. `corepack pnpm test:storefront` runs component tests; `corepack pnpm test:storefront:ssr` builds and checks the local Worker HTML and JavaScript asset automatically.

This is static sample content, not catalog data. Local Workers SSR has been exercised, but deployment and production host configuration remain unverified. See the [compatibility report](../../docs/phase-0-compatibility.md).
# Admin import configuration

The admin UI is at `/admin/import`. The public Google OAuth **client ID** comes from the API's `GOOGLE_CLIENT_ID` and must be authorized for the admin origin in Google Cloud. Never put a client secret in the browser. The API must be reachable at `/api` on the same origin, with `ADMIN_ORIGIN` set to that exact origin. The initial owner is provisioned manually; signed-in admins can add other lowercase Gmail addresses from the import screen. Google Identity Services must be allowed by the site's CSP. HTTPS is required except for the backend's explicit localhost development opt-in.

The browser requests a login challenge with a same-origin JSON `POST /api/admin/auth/challenge`. The API requires its `Origin` header to exactly match `ADMIN_ORIGIN`; missing or different origins are rejected. GET does not issue a challenge.
