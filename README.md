# ThichMacDep — local catalog

This workspace contains a catalog API, local D1/R2 bindings and an Angular SSR storefront. Generic catalog synchronization components are locally testable with synthetic data only; production infrastructure is not implemented.

**Phase 2 is complete locally, not production-ready.** The owner configured Google sign-in, imported the workbook through admin and confirmed reimport works. The workbook contained 183 goods, 2 services and 73 product groups. Edge rate limits, deployed same-origin routing and production OAuth configuration remain outstanding. See the [import contract](docs/xlsx-import-contract.md) and [project plan](ThichMacDep_AI_AGENT_PROJECT_PLAN.md).

**Phase 3 is in progress, not complete.** The local Workers storefront uses the local catalog API and D1 state; it is not a production deployment.

## Fresh local setup

Use Node `^22.22.3`, `^24.15.0` or `^26.0.0` and Corepack with pnpm `12.18.0` (see `package.json`). From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate:local
corepack pnpm typecheck:api
corepack pnpm test:api
corepack pnpm test:sync
corepack pnpm test:storefront
corepack pnpm test:storefront:ssr
corepack pnpm test:storefront:proxy
corepack pnpm test:storefront:catalog
corepack pnpm test:storefront:browser # optional: installed Google Chrome and native Node WebSocket
corepack pnpm exec node --test tests/xlsx-rows.test.mjs tests/xlsx-input.test.mjs
```

The SSR smoke script builds the storefront, starts its own local Wrangler Worker on an available loopback port, checks the initial HTML and referenced JavaScript, and stops the Worker. It does not check browser hydration. The catalog proof uses isolated synthetic D1 state and exercises the multiworker SSR path. The API tests start separate local Workers and exercise local D1 and R2. The test-only Worker and `wrangler.test.jsonc` must never be deployed.

The optional browser test builds the storefront and uses local Workers, synthetic D1 data, and a temporary Chrome profile. It requires a supported Node version with native `WebSocket` and installed Google Chrome; set `CHROME_PATH` to its executable if it is not in a standard location. If either is unavailable the test reports a skip. Browser requests outside loopback are blocked; no screenshots are saved. It does not use local `.env` or existing D1 state.

## Run locally

In separate terminals as needed:

```sh
# API: GET http://127.0.0.1:8787/api/health
corepack pnpm dev:api

# Angular development server for admin and proxy work only
corepack pnpm dev:storefront

# Data-backed local storefront SSR: http://localhost:4200
corepack pnpm dev:storefront:worker
```

The two storefront commands both use port 4200; run only one at a time. **`dev:storefront` is not data-backed SSR**: use it with `dev:api` for admin/proxy development, not to verify the storefront catalog. `dev:storefront:worker` builds the storefront and starts the storefront and API Workers together, using the actual local D1 state under `.wrangler/state`; it does not connect to remote resources. Create a root `.env` as described below before starting it. Imported local catalog data remains in that state. Do not seed unless you explicitly want synthetic fixtures: `corepack pnpm db:seed:local` inserts missing fixture rows without overwriting existing rows or website settings. No contact links should be fabricated; configure real contacts in local settings when available.

`SITE_ORIGIN` is a trusted site configuration used for absolute SEO URLs, not a value taken from a request host. The local worker command fixes it to `http://localhost:4200`; a future deployment must configure its own trusted origin. Catalog API success responses are publicly cacheable for 60 seconds, so changes may not appear immediately in caches. For schema changes, `corepack pnpm db:generate` generates Drizzle migrations; apply them with `corepack pnpm db:migrate:local`. Do not commit `.wrangler/`. D1's all-zero database ID is a placeholder. The configured bindings are local simulations, not remote resources.

### SEO slugs and local migration

New product and category slugs are readable lowercase ASCII: Vietnamese tones are stripped, including conversion of `đ`/`Đ` to `d`. Collisions receive a short numeric suffix such as `-2`. Existing slugs remain stable on rename and reimport. Concurrent catalog writers do not share a universal lock: a slug uniqueness collision can fail safely and requires a manual retry after the competing write finishes.

To convert recognized legacy-generated product and category slugs in an existing **local** SQLite database, stop local writers and back up the SQLite database before running this one-shot script (replace the placeholder with the local database file path):

```sh
node scripts/migrate-local-slugs.mjs --local /path/to/local-d1.sqlite
```

Other existing slugs are left unchanged. Migrated URLs change and there are no redirects from legacy URLs. This script is local-only; no deployed migration is provided.

## Local admin sign-in

The Angular dev server proxies `/api/**` to `127.0.0.1:8787`, so use **http://localhost:4200** in the browser, not the API port or `127.0.0.1:4200`. Start both servers above. The API does not enable cross-origin access. For an owner-authorized local Google OAuth web client, add `http://localhost:4200` as an authorized JavaScript origin. Create a root `.env` file (ignored by Git), copying `.dev.vars.example` if needed, with these placeholders replaced as appropriate. `dev:api` reads this file explicitly:

```dotenv
GOOGLE_CLIENT_ID="YOUR_PUBLIC_GOOGLE_WEB_CLIENT_ID"
ADMIN_ORIGIN="http://localhost:4200"
ADMIN_ALLOW_INSECURE_LOCALHOST="true"
```

The Google client ID is public; do not put a client secret in this file or the frontend. Restart the API after changes. The insecure-cookie opt-in is for localhost development only. Without valid configuration, `/api/admin/auth/config` fails closed. No Google account is needed for the offline tests.

An existing ignored, uncommitted `.env` may contain legacy KiotViet values; it is not needed for the manual import and should not be modified or committed.

After migrations, the owner may explicitly provision an authorized local admin in local D1; there is no public provisioning endpoint. Replace the example with a unique ID and the owner's verified, lowercase `@gmail.com` address, using only trusted input and SQL-escaping any apostrophes. This is a manual local-only operation, not a seed or production command:

```sh
corepack pnpm exec wrangler d1 execute DB --local --command "INSERT INTO admin_users (id, email, role, is_enabled, created_at, updated_at) VALUES ('local-owner', 'owner@example.invalid', 'admin', 1, datetime('now'), datetime('now'))"
```

The example address is intentionally invalid and must be replaced; first successful sign-in binds the account's Google subject. Protect local D1 state, and disable an account by setting `is_enabled = 0` when no longer needed.

Once signed in, an existing enabled administrator can add another lowercase Gmail address on `/admin/import`. The protected `POST /api/admin/users` requires the admin session, exact configured origin, and CSRF token. It only inserts new enabled admins; an existing or disabled account is not changed. The new account's Google subject is bound on its first successful sign-in. There is no public signup or removal UI; the initial owner must still be provisioned manually.

**Deployment blockers:** local multiworker routing is not a deployed configuration. The Angular proxy applies only to `ng serve`. Implement and test deployed same-origin forwarding, preserve origin/cookie security, configure HTTPS and edge rate limits, and verify real Google sign-in before launch. Concurrent non-XLSX catalog writers do not share the XLSX lock; production multi-writer use is unsafe until coordinated. No production resources have been created.

## Local read-only API

After migrating and importing local data (or optionally seeding synthetic fixtures), start `corepack pnpm dev:api` and use the URL Wrangler displays (normally `http://localhost:8787`). For example (the sample slugs require matching local data):

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
| `/api/products/:slug` | Product with `images`, `variants`, and `categories` arrays; images contain permitted direct URLs. |
| `/api/categories` | Array of active Category objects. |
| `/api/categories/:slug` | One active Category. |
| `/api/store-settings` | `{ storeName, defaultCurrency, tiktokUrl, instagramUrl, zaloUrl, messengerUrl, otherContactUrl, logoUrl }`; URLs can be null. |

A Product has `id`, nullable `sku`, `slug`, `name`, nullable `shortDescription`, `description`, `brandName` and `priceMinor`, `currency`, and `website: { seoTitle, seoDescription, marketingDescription, isFeatured, displayOrder }`. The three website text fields can be null. Category is `{ id, name, slug, parentId }`, with nullable `parentId`. Variants have `id`, nullable `sku`, `name`, nullable `attributesJson` (a JSON string) and nullable `priceMinor`. Prices are integer VND by default. Only active, non-hidden products and active categories/variants are returned; provider and sync fields are private.

The product list accepts `page` (default 1), `pageSize` (default 20, maximum 100), `keyword` (literal substring of name or SKU), and `category` (exact active category slug). Pagination values must be positive safe integers with a safe offset; keyword and category must be nonblank and at most 200 characters. SQLite LIKE case folding is ASCII-oriented: Vietnamese non-ASCII case-insensitive matching is not guaranteed. Filters combine, and category filtering does not automatically include descendants. Unknown or repeated query parameters are rejected; other catalog routes accept no query parameters. Invalid queries return HTTP 400 `{ "error": { "code": "INVALID_QUERY", "message": "Invalid query parameters" } }`; missing or non-visible detail records and missing store settings return HTTP 404 `{ "error": { "code": "NOT_FOUND", "message": "Not found" } }`. Unexpected errors return HTTP 500 with code `INTERNAL_ERROR`.

Images use direct HTTPS URLs from `cdn2-retail-images.kiotviet.vn`, `cdn1-retail-images.kiotviet.vn`, or `cdn-images.kiotviet.vn`. These links can expire or become unavailable; the owner needs independent backups. They are not copied to R2. See [the data model](docs/data-model.md), [the Phase 0 compatibility report](docs/phase-0-compatibility.md) and [storefront notes](apps/storefront/README.md) for scope and limitations. No remote production resources or deployment are implied.
