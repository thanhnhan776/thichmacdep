# Storefront Phase 0 proof

From the repository root, follow the fresh setup in the [root README](../../README.md). `corepack pnpm dev:storefront` runs Angular's development server at `http://localhost:4200/products/sample`.

For the local Workers runtime, run `corepack pnpm build:storefront` followed by `corepack pnpm dev:storefront:worker`, then request `/products/sample` at the displayed URL. The Workers Assets binding serves browser files. `corepack pnpm test:storefront` runs component tests; `corepack pnpm test:storefront:ssr` builds and checks the local Worker HTML and JavaScript asset automatically.

This is static sample content, not catalog data. Local Workers SSR has been exercised, but deployment and production host configuration remain unverified. See the [compatibility report](../../docs/phase-0-compatibility.md).
