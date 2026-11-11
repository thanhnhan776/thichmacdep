# ThichMacDep — Phase 0 local proof

This workspace contains a Hono health endpoint, local D1/R2 binding proof and an Angular SSR sample. The sample is static; a product catalog, provider sync and production infrastructure are not implemented.

## Fresh local setup

Use Node `^22.22.3`, `^24.15.0` or `^26.0.0` and Corepack with pnpm `12.18.0` (see `package.json`). From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate:local
corepack pnpm typecheck:api
corepack pnpm test:api
corepack pnpm test:storefront
corepack pnpm test:storefront:ssr
```

The SSR smoke script builds the storefront, starts its own local Wrangler Worker on an available loopback port, checks the initial HTML and referenced JavaScript, and stops the Worker. It does not check browser hydration. The API tests start separate local Workers and exercise local D1 and R2. The test-only Worker and `wrangler.test.jsonc` must never be deployed.

## Run locally

In separate terminals as needed:

```sh
# API: GET http://localhost:8787/api/health
corepack pnpm dev:api

# Angular development server: http://localhost:4200/products/sample
corepack pnpm dev:storefront

# Local Workers SSR: request /products/sample at Wrangler's displayed URL
corepack pnpm build:storefront
corepack pnpm dev:storefront:worker
```

For schema changes, `corepack pnpm db:generate` generates Drizzle migrations; apply them with `corepack pnpm db:migrate:local`. The proof table is not a catalog schema. Wrangler persists local state under `.wrangler/`; do not commit it. D1's all-zero database ID is a placeholder. The configured bindings are local simulations, not remote resources. The API's only public proof endpoint is `GET /api/health`; it has no write route.

See [the compatibility report](docs/phase-0-compatibility.md) and [storefront notes](apps/storefront/README.md) for scope and limitations. No deployment or production resources are implied.
