# ThichMacDep — local catalog

This workspace contains a local read-only catalog API, a Hono health endpoint, local D1/R2 binding proof and an Angular SSR sample. The sample remains static; provider sync and production infrastructure are not implemented.

## Fresh local setup

Use Node `^22.22.3`, `^24.15.0` or `^26.0.0` and Corepack with pnpm `12.18.0` (see `package.json`). From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate:local
corepack pnpm db:seed:local
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

For schema changes, `corepack pnpm db:generate` generates Drizzle migrations; apply them with `corepack pnpm db:migrate:local`, then run `corepack pnpm db:seed:local` for synthetic fixtures. Repeat seeding inserts missing fixture rows but does not overwrite existing rows or website settings. Wrangler persists local state under `.wrangler/`; do not commit it. D1's all-zero database ID is a placeholder. The configured bindings are local simulations, not remote resources.

## Local read-only API

After migrating and seeding, start `corepack pnpm dev:api` and use the URL Wrangler displays (normally `http://localhost:8787`). For example:

```sh
curl 'http://localhost:8787/api/products?page=1&pageSize=2&category=tops&keyword=linen'
curl 'http://localhost:8787/api/products/linen-shirt'
curl 'http://localhost:8787/api/categories'
curl 'http://localhost:8787/api/categories/tops'
curl 'http://localhost:8787/api/store-settings'
curl 'http://localhost:8787/api/health'
```

All catalog endpoints are GET-only. Successful catalog responses have `Cache-Control: public, max-age=60`.

| Endpoint | Response |
| --- | --- |
| `/api/health` | `{ "status": "ok" }` |
| `/api/products` | `{ "items": [Product], "total": number, "page": number, "pageSize": number }` |
| `/api/products/:slug` | Product with `images`, `variants`, and `categories` arrays; `images` is currently always empty. |
| `/api/categories` | Array of active Category objects. |
| `/api/categories/:slug` | One active Category. |
| `/api/store-settings` | `{ storeName, defaultCurrency, tiktokUrl, instagramUrl, zaloUrl, messengerUrl, otherContactUrl, logoUrl }`; URLs can be null. |

A Product has `id`, nullable `sku`, `slug`, `name`, nullable `shortDescription`, `description`, `brandName` and `priceMinor`, `currency`, and `website: { seoTitle, seoDescription, marketingDescription, isFeatured, displayOrder }`. The three website text fields can be null. Category is `{ id, name, slug, parentId }`, with nullable `parentId`. Variants have `id`, nullable `sku`, `name`, nullable `attributesJson` (a JSON string) and nullable `priceMinor`. Prices are integer VND by default. Only active, non-hidden products and active categories/variants are returned; provider and sync fields are private.

The product list accepts `page` (default 1), `pageSize` (default 20, maximum 100), `keyword` (literal substring of name or SKU), and `category` (exact active category slug). Pagination values must be positive safe integers with a safe offset; keyword and category must be nonblank and at most 200 characters. SQLite LIKE case folding is ASCII-oriented: Vietnamese non-ASCII case-insensitive matching is not guaranteed. Filters combine, and category filtering does not automatically include descendants. Unknown or repeated query parameters are rejected; other catalog routes accept no query parameters. Invalid queries return HTTP 400 `{ "error": { "code": "INVALID_QUERY", "message": "Invalid query parameters" } }`; missing or non-visible detail records and missing store settings return HTTP 404 `{ "error": { "code": "NOT_FOUND", "message": "Not found" } }`. Unexpected errors return HTTP 500 with code `INTERNAL_ERROR`.

See [the data model](docs/data-model.md), [the Phase 0 compatibility report](docs/phase-0-compatibility.md) and [storefront notes](apps/storefront/README.md) for scope and limitations. No remote production resources or deployment are implied.
