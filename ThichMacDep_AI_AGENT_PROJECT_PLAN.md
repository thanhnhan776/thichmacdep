# Standalone Product Catalog --- AI Agent Implementation Plan

**Status:** Approved architecture\
**Document purpose:** Source of truth for coding agents implementing the
first version\
**Last updated:** 2026-11-11\
**Shop name:** ThichMacDep\
**Initial provider:** KiotViet\
**Future provider:** MISA (specific product not selected)\
**Product scope:** Public product catalog only; no checkout, orders,
customer accounts, or customer management

------------------------------------------------------------------------

## 1. Instructions for AI agents

Treat this document as the approved project direction.

1.  Read this document before making architectural or implementation
    decisions.
2.  Implement in small, testable phases. Do not attempt the entire
    application in one change.
3.  Do not deploy, create production resources, spend money, register
    webhooks, or change external account settings without explicit human
    approval.
4.  Do not ask the human to perform an action that can safely be
    completed locally by an agent.
5.  Mark all required human actions using the `HUMAN ACTION REQUIRED`
    format in Section 12.
6.  Do not invent KiotViet API behavior. Verify endpoint paths, scopes,
    authentication, pagination, webhook payloads, rate limits, and
    subscription requirements against current official documentation or
    a real test account.
7.  Keep secrets out of source control, logs, test fixtures,
    screenshots, and generated documentation.
8.  Do not introduce extra infrastructure or dependencies without
    explaining why they are necessary.
9.  Preserve provider independence. The storefront and normalized
    catalog must not depend on KiotViet-specific field names or
    identifiers.
10. Before declaring a phase complete, run its tests and report changed
    files, commands run, results, limitations, and any human actions
    still required.

### Agent task handoff format

For each implementation task, report:

-   **Goal**
-   **Files changed**
-   **Implementation summary**
-   **Commands/tests run**
-   **Acceptance criteria passed/failed**
-   **Assumptions**
-   **Human actions required**
-   **Next recommended task**

Agents must not mark a human action complete unless the human has
performed it or supplied evidence that it is complete.

------------------------------------------------------------------------

## 2. Product goal and scope

Build a standalone, mobile-first website for **ThichMacDep** that
displays a product catalog. Product and category data are synchronized from an external
retail/inventory platform into an application-owned database.

The website is not the system of record for inventory operations. It
owns the public presentation layer and website-specific merchandising
content.

### In scope for v1

-   Public homepage.
-   Product listing with pagination.
-   Category listing and category navigation.
-   Product detail pages.
-   Search by product name and SKU/product code.
-   Basic filtering (category and, if useful, price range/availability).
-   Product images.
-   Product variants/attributes where the source exposes them.
-   Store-configurable contact links (TikTok, Instagram, Zalo,
    Messenger, or other URLs).
-   SEO metadata, canonical URLs, sitemap, robots.txt, Open Graph
    metadata, structured product data where accurate.
-   KiotViet product/category synchronization.
-   Scheduled reconciliation as a safety net for missed webhooks.
-   Local development and tests before production deployment.

### Explicitly out of scope for v1

-   Shopping cart.
-   Checkout.
-   Payment processing.
-   Shipping integration.
-   Order creation or order synchronization.
-   Customer accounts or customer management.
-   Loyalty points or promotions requiring transaction logic.
-   Admin dashboard. Website-specific settings may initially be managed
    through seed data or a documented database workflow.
-   MISA integration. Keep the provider boundary ready, but do not
    implement until the exact MISA product and supported API are
    confirmed.

------------------------------------------------------------------------

## 3. Approved technology stack

  -----------------------------------------------------------------------
  Layer                               Approved technology
  ----------------------------------- -----------------------------------
  Frontend                            Angular v22 (latest stable release)

  Rendering                           Angular SSR for dynamic
                                      product/category pages; SSG only
                                      for genuinely static pages

  Backend/API                         TypeScript + Hono

  Runtime/deployment                  Cloudflare Workers

  ORM/query layer                     Drizzle ORM

  Database                            Cloudflare D1 (SQLite-compatible
                                      SQL)

  Schema migrations                   Drizzle Kit migrations

  Object/image storage                Cloudflare R2

  Scheduled synchronization           Cloudflare Cron Triggers

  Asynchronous jobs                   Direct Worker processing initially;
                                      Cloudflare Queues only when needed

  Local Cloudflare simulation         Wrangler + Miniflare/workerd

  Package manager                     pnpm (unless the existing
                                      repository establishes another
                                      choice)

  Monorepo                            pnpm workspaces
  -----------------------------------------------------------------------

### Important database decision

D1 is selected to keep the first deployment Cloudflare-native and
simple. D1 is SQLite-based, not PostgreSQL.

-   Use SQLite-compatible SQL and D1-supported Drizzle features.
-   Do not use PostgreSQL-only types, extensions, SQL syntax, or
    assumptions.
-   Store money as integer minor units where practical (e.g. VND integer
    amount) or use a carefully validated decimal representation. Do not
    use floating-point arithmetic for prices.
-   Store timestamps consistently as UTC ISO-8601 strings or integer
    epoch values. Choose one representation and document it.
-   Store image binaries in R2, never in D1.
-   Keep schema and repository logic sufficiently isolated that a future
    move to PostgreSQL remains possible, but do not prematurely build a
    multi-database abstraction.

### Important rendering decision

Use Angular SSR for pages whose content changes as the synchronized
catalog changes. SSR renders the latest database-backed data at request
time, so product changes do not require rebuilding the Angular
application.

Use SSG/prerendering only for content that is genuinely static
(e.g. About, Contact, policy pages). A product page generated with SSG
becomes stale until rebuilt.

**Deployment validation gate:** Cloudflare's official Angular Workers
guide documents Angular deployment with Workers Assets. Confirm the
exact Angular SSR runtime/build configuration works on the current
Workers runtime before committing to the SSR deployment adapter. Build a
minimal SSR proof of concept early. Do not silently fall back to CSR for
product pages because SEO is a project requirement.

### Mandatory Angular engineering standards

The storefront must use **Angular v22**, targeting the latest stable v22
release available when implementation begins. Pin compatible dependency
versions and verify the installed Angular CLI, framework, compiler, and
SSR packages are all aligned on v22. Do not silently scaffold an older
major version or mix Angular major versions.

Use a signal-first, standalone Angular architecture:

- Every application component, directive, and pipe must be standalone.
  Do not introduce NgModules or an NgModule-based application structure.
- Use Angular signals (`signal`, `computed`, and `effect`) for local and
  shared reactive state. Prefer `computed` for derived state and avoid
  manually maintaining values that can be derived.
- Use signal-based component APIs (`input`, `output`, and `model`) where
  appropriate instead of legacy decorator-based inputs/outputs.
- Use modern dependency injection with `inject()` where appropriate.
- Use Angular's modern template control flow (`@if`, `@for`, `@switch`)
  rather than the legacy structural directives (`*ngIf`, `*ngFor`,
  `*ngSwitch`). Track repeated items by stable IDs/keys.
- Prefer `ChangeDetectionStrategy.OnPush` and immutable data patterns.
- Use typed reactive forms or the current recommended Angular form APIs;
  do not introduce untyped forms.
- Keep RxJS where it is the right tool for streams and interoperability
  (for example, HTTP/event streams). Bridge to signals deliberately with
  Angular interop APIs; do not force every asynchronous stream into a
  signal or create redundant subscriptions.
- Use `HttpClient` with typed API contracts and functional interceptors
  where needed. Keep API access in injectable data-access services, not
  directly in presentation components.
- Follow current Angular v22 guidance for SSR, hydration, routing,
  accessibility, testing, and performance. Avoid deprecated APIs and
  legacy patterns.
- Enable strict TypeScript and Angular template checking. Keep linting
  and tests aligned with the chosen standalone/signal-first architecture.

Agents must check current Angular v22 documentation before choosing
specific APIs, because framework APIs and recommended SSR integration
can change between major releases. These standards do not override the
Cloudflare Workers SSR compatibility proof required below.

------------------------------------------------------------------------

## 4. High-level architecture

``` mermaid
flowchart TD
    Visitor[Customer browser] --> Storefront[Angular storefront - SSR]
    Storefront --> API[Hono API on Cloudflare Workers]
    API --> D1[(Cloudflare D1)]
    API --> R2[(Cloudflare R2)]

    KiotViet[KiotViet API] --> Sync[Provider sync service]
    Webhook[KiotViet webhook] --> API
    Cron[Cloudflare Cron Trigger] --> Sync
    Sync --> KiotViet
    Sync --> D1
    Sync --> R2

    FutureMISA[MISA API - future] -.-> MISAAdapter[MISA provider adapter - future]
    MISAAdapter -.-> Sync
```

### Core boundaries

-   Angular communicates with the application's API, not directly with
    KiotViet or MISA.
-   The API reads normalized product data from D1.
-   The provider adapter communicates with the upstream retail platform.
-   The synchronization service maps provider records into the
    normalized catalog.
-   R2 stores product image copies. D1 stores image metadata and R2
    object keys.
-   Webhooks trigger synchronization of affected records where the
    provider supports them.
-   Cron reconciliation detects missed events and repairs drift.
-   No provider-specific identifier should be exposed as the
    application's permanent product ID.

### Local-first development

The complete application must be developable locally before production
Cloudflare resources are created.

Use Wrangler's local runtime and local bindings: - Workers execute
locally using workerd/Miniflare. - D1 uses a local-only database. - R2,
Queues, and other supported bindings are simulated locally. - Local
binding state is persisted under `.wrangler/state` by default. - Use
local fixtures and test credentials. Never point local development at
production resources by default.

Cloudflare documentation: -
https://developers.cloudflare.com/workers/local-development/ -
https://developers.cloudflare.com/workers/local-development/local-data/ -
https://developers.cloudflare.com/d1/best-practices/local-development/ -
https://developers.cloudflare.com/queues/configuration/local-development/

Local simulation is not a perfect substitute for production validation.
Verify production credentials, bucket permissions, public image
delivery, webhook reachability, custom domains, scheduled trigger
execution, quotas, and caching after deploying to a staging/production
environment.

------------------------------------------------------------------------

## 5. Suggested monorepo structure

Keep the repository lean. Do not create separate microservices.

``` text
product-catalog/
├── apps/
│   ├── storefront/                 # Angular SSR storefront
│   └── api/                        # Hono Worker: API, webhooks, cron handler
│
├── packages/
│   └── shared/                     # Shared API contracts/types only
│
├── drizzle/
│   ├── schema.ts                   # Drizzle D1 schema
│   └── migrations/                 # Generated/versioned migrations
│
├── scripts/
│   ├── seed-local.ts
│   └── sync-local-fixtures.ts
│
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   └── operations.md
│
├── .dev.vars.example               # Placeholder names only; no secrets
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

The exact placement of Drizzle schema/migrations may be adjusted to
match Drizzle Kit and Wrangler conventions. Keep one authoritative
schema definition and one migration history.

### API module structure

``` text
apps/api/src/
├── index.ts                        # Hono app and Worker entry point
├── routes/
│   ├── products.ts
│   ├── categories.ts
│   ├── webhooks.ts
│   └── health.ts
├── integrations/
│   ├── provider.ts                 # Provider interfaces
│   └── kiotviet/
│       ├── client.ts
│       ├── auth.ts
│       ├── products.ts
│       ├── categories.ts
│       ├── webhooks.ts
│       └── mapper.ts
├── services/
│   ├── catalog.service.ts
│   ├── sync.service.ts
│   └── image.service.ts
├── repositories/
│   ├── products.repository.ts
│   ├── categories.repository.ts
│   └── sync.repository.ts
├── db/
│   └── index.ts
├── scheduled.ts                    # Cron entry point
└── types/
    └── bindings.ts
```

Do not create empty placeholder modules for future MISA work unless they
help define a real interface. The provider contract is enough initially.

------------------------------------------------------------------------

## 6. Data model requirements

Design the schema around the normalized catalog, not KiotViet's raw
response shape.

Minimum entities:

### `products`

-   `id`: stable internal ID (UUID or generated text ID).
-   `sku`: nullable; do not assume globally unique unless validated.
-   `slug`: stable public URL slug; unique.
-   `name`.
-   `short_description`: nullable.
-   `description`: nullable.
-   `brand_name`: nullable.
-   `price_minor`: nullable integer or validated integer amount in the
    store's currency.
-   `currency`: store currency, initially VND unless confirmed
    otherwise.
-   `is_active`.
-   `source_updated_at`: nullable provider timestamp.
-   `last_synced_at`.
-   `created_at`, `updated_at`.

### `categories`

-   `id`: stable internal ID.
-   `name`.
-   `slug`.
-   `parent_id`: nullable self-reference.
-   `is_active`.
-   `source_updated_at`, `last_synced_at`.
-   `created_at`, `updated_at`.

### `product_images`

-   `id`.
-   `product_id`.
-   `source_url`: original provider image URL for traceability.
-   `r2_key`: nullable until copied successfully.
-   `alt_text`.
-   `position`.
-   `content_type`, `size_bytes`, `etag` where available.
-   `created_at`, `updated_at`.

### `product_variants`

Only implement fields supported by the actual KiotViet product model. Do
not flatten variants into fake independent products without a documented
reason.

-   `id`.
-   `product_id`.
-   `external_variant_id`: nullable.
-   `sku`: nullable.
-   `name`.
-   `attributes_json`.
-   `price_minor`: nullable.
-   `is_active`.

### `product_category` (only if products can belong to multiple categories)

Use a join table if the provider supports multiple category
relationships. Otherwise use `category_id` on products. Confirm actual
provider semantics before choosing.

### `external_product_mappings`

This table is essential for future migration.

-   `id`.
-   `provider` (e.g. `kiotviet`, later `misa:<product>`).
-   `external_id`.
-   `product_id`.
-   `external_variant_id`: nullable if needed.
-   `created_at`, `updated_at`.

Add a unique constraint on `(provider, external_id)` and appropriate
indexes.

Do not use the external ID as the internal product ID. Do not assume
KiotViet and MISA product IDs will match.

### `website_product_settings`

Keep website-owned content separate from provider-managed content.

-   `product_id`.
-   `seo_title`.
-   `seo_description`.
-   `marketing_description`.
-   `is_featured`.
-   `display_order`.
-   `is_hidden`.
-   `created_at`, `updated_at`.

A provider sync must never overwrite these fields.

### `store_settings`

For store-wide contact URLs and presentation configuration:

-   Store name.
-   Default currency.
-   TikTok URL.
-   Instagram URL.
-   Zalo URL.
-   Messenger URL.
-   Other contact URL(s).
-   Logo and branding references if needed.

### `sync_runs` / `sync_events`

Record synchronization execution and failures:

-   Provider.
-   Trigger type (`initial`, `cron`, `webhook`, `manual`).
-   Started/completed timestamps.
-   Status.
-   Counts (created, updated, deactivated, skipped, failed).
-   Error summary.
-   Cursor/watermark where applicable.

Avoid storing full sensitive webhook bodies or credentials. If payload
retention is needed for debugging, redact and limit retention.

### Indexes

At minimum, evaluate indexes for: - `products.slug` unique. -
`products.sku`. - `products.is_active`. - `products.name` (use SQLite
FTS only if basic LIKE search is inadequate). - `categories.slug`
unique. - `products.category_id` or join-table keys. -
`external_product_mappings(provider, external_id)` unique. -
`product_images(product_id, position)`.

Use `EXPLAIN QUERY PLAN` for search/listing queries before adding
unnecessary indexes.

------------------------------------------------------------------------

## 7. Provider abstraction and synchronization

### Provider interface

The provider interface should represent normalized retrieval
capabilities without exposing KiotViet-specific types to the rest of the
application.

Illustrative TypeScript contract:

``` ts
export interface CatalogProvider {
  listProducts(input: {
    updatedSince?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: ExternalProduct[];
    nextPage?: number;
    hasMore: boolean;
  }>;

  getProduct(externalId: string): Promise<ExternalProduct>;

  listCategories(): Promise<ExternalCategory[]>;
}
```

The exact interface may change after examining KiotViet's API. Include
methods for branch/price/inventory only if those fields are genuinely
required for the storefront.

### Synchronization rules

1.  Initial sync retrieves all pages of products and categories.
2.  Normalize and validate each record.
3.  Upsert by `(provider, external_id)` mapping.
4.  Preserve the internal product ID and website-owned settings.
5.  Synchronize product images to R2 when appropriate.
6.  Record source timestamps and sync status.
7.  Treat missing fields carefully: distinguish "field absent" from
    "explicitly empty".
8.  Do not deactivate every local product merely because it was absent
    from a partial page or failed sync.
9.  Handle provider deletion/inactivation events explicitly.
10. Make sync idempotent: replaying the same product update must not
    create duplicates or corrupt website-managed fields.

### Pagination and rate limits

-   Use the provider's documented pagination mechanism.
-   Respect API page-size limits and rate limits.
-   Add bounded retries with exponential backoff and jitter for
    transient errors.
-   Do not retry permanent validation/authentication errors
    indefinitely.
-   Avoid a full catalog download on every webhook.
-   Store a sync watermark only after a batch is safely committed.
-   Ensure a partial failure can resume without skipping updates.

### Webhook strategy

Investigate current KiotViet support for product create/update/delete
and inventory events.

A previous KiotViet Public API manual describes webhook event types
including `product.update`, `product.delete`, and `stock.update`.
However, this documentation may be old. Before implementation, verify
the current supported API version, webhook registration endpoint, event
payload, signature/authentication mechanism, delivery retry policy, and
subscription requirements with current official documentation or
KiotViet support.

If current webhook support is unavailable or unsuitable: - Use Cron
Triggers and incremental `lastModifiedFrom`-style polling if
supported. - Keep a manual full reconciliation command. - Do not claim
real-time synchronization.

### Webhook processing

-   Validate authenticity according to the current KiotViet
    specification. Never invent a signature scheme.
-   Acknowledge quickly after durable acceptance/processing, according
    to provider delivery expectations.
-   Deduplicate events if an event ID exists. Otherwise use a safe
    idempotency key derived from documented fields.
-   For product update events, fetch the latest product by external ID
    when possible, then upsert the authoritative state.
-   For delete events, deactivate/soft-delete rather than hard-delete
    immediately.
-   Handle out-of-order events using source update timestamps where
    reliable.
-   Do not let webhook payloads overwrite website-owned fields.
-   Log event outcome without leaking secrets.

### Cron reconciliation

Start with a conservative schedule, such as every 15--30 minutes, after
confirming API quotas and store update frequency.

Cron should: - Fetch incremental changes using provider modification
timestamps if available. - Resume safely from the last successful
watermark. - Reconcile missed deletions/inactive products if the
provider exposes a suitable mechanism. - Record a sync run. - Alert/log
repeated failures.

A daily deeper reconciliation may be added if API quotas permit.

### Queue decision

Do not introduce Cloudflare Queues in the first implementation unless
webhook processing or image copying requires asynchronous work that
cannot safely finish in one Worker invocation.

Start with: - Cron Trigger -\> bounded sync batch. - Webhook -\> process
one affected product or enqueue only if necessary.

If Queues are introduced: - Use idempotent consumers. - Configure
retries and a dead-letter queue. - Avoid unbounded fan-out. - Document
queue retention and retry behavior. - Keep a manual reprocessing path.

------------------------------------------------------------------------

## 8. Product image handling

Use R2 for copies of product images.

Expected flow: 1. Read image URL from provider data. 2. Validate URL
scheme and host against an allowlist where feasible. 3. Fetch image from
provider. 4. Enforce maximum size and allowed content types. 5. Upload
to R2 using a deterministic key,
e.g. `products/{internalProductId}/{imageHash}.{ext}`. 6. Save the R2
key and image metadata in D1. 7. Serve images through a configured
public custom domain or an authorized Worker route.

Important: - Do not blindly fetch arbitrary URLs from upstream data;
defend against SSRF. - Do not assume image URLs are permanent. - Avoid
downloading the same image repeatedly; use hash/ETag/last-modified
checks where possible. - Preserve image ordering. - Handle
deleted/replaced images and orphan cleanup. - Do not expose R2
credentials to the browser. - Do not store image binaries in D1. - Do
not make public bucket access changes without human approval.

For local development, use Wrangler's local R2 binding simulation.
Production public delivery, custom-domain configuration, and bucket
access must be tested separately.

------------------------------------------------------------------------

## 9. Public API contract

The storefront must use the application's own API.

Initial endpoints:

``` http
GET /api/health
GET /api/products?page=1&pageSize=24
GET /api/products?category=shoes
GET /api/products?keyword=shirt
GET /api/products/:slug
GET /api/categories
GET /api/categories/:slug
GET /api/store-settings
```

Requirements: - Validate query parameters. - Enforce a maximum page
size. - Return stable internal IDs and public slugs, not provider IDs. -
Return only active and website-visible products. - Return website
overrides alongside provider-sourced fields. - Avoid leaking internal
sync metadata or credentials. - Use consistent error response shapes. -
Add appropriate cache headers for public GET endpoints. - Ensure cache
invalidation/expiry does not keep product data stale for an unacceptable
period.

No public endpoint should allow catalog writes in v1. Webhook routes are
separate and protected.

------------------------------------------------------------------------

## 10. Angular storefront and SEO

### Pages

-   `/` --- homepage.
-   `/products` --- all products.
-   `/categories/:slug` --- category page.
-   `/products/:slug` --- product detail.
-   `/about` --- optional static page.
-   `/contact` --- optional static page.

### SEO requirements

For each product/category route: - Server-rendered HTML must contain the
main page title and meaningful product/category content. - Unique
`<title>` and meta description. - Canonical URL. - Open Graph and social
sharing metadata. - Correct heading hierarchy. - Descriptive image alt
text. - Product structured data only when fields are accurate (price,
currency, availability, image, name, URL). - Sitemap includes active
public product/category pages. - robots.txt is correct. - Avoid indexing
internal API routes, preview environments, and duplicate filter URLs. -
Provide a useful 404 for missing/inactive product slugs.

### Rendering behavior

-   Product detail pages: SSR.
-   Category pages: SSR.
-   Product listing/search: SSR where it improves initial content and
    crawlability.
-   Static About/Contact pages: SSG or static output.
-   Interactive controls hydrate in the browser.

SSR should query the normalized application API/database at request
time. A product update should be visible on the next uncached render; it
must not require a full Angular rebuild.

### Caching

Keep caching conservative initially: - Cache public product/category GET
responses for a short configurable period. - Invalidate or bypass
relevant cached content after successful sync if practical. - Do not
cache webhook/API secrets or private data. - Test whether the Angular
SSR response and API response can become inconsistent. - Document the
maximum expected product-update visibility delay.

------------------------------------------------------------------------

## 11. Local development and testing

### Local development is the default

Do not create Cloudflare production resources as a prerequisite for
application development.

Use: - Angular CLI dev server or the configured Angular SSR local
server. - `wrangler dev` for the Hono Worker. - Local D1 binding managed
by Wrangler/Miniflare. - Local R2 binding managed by
Wrangler/Miniflare. - Local Queues simulation only if queues are
implemented. - `.dev.vars` for local secrets; commit only
`.dev.vars.example`. - Local fixture data for deterministic tests.

Cloudflare local development documentation: -
https://developers.cloudflare.com/workers/local-development/ -
https://developers.cloudflare.com/workers/local-development/local-data/ -
https://developers.cloudflare.com/d1/best-practices/local-development/ -
https://developers.cloudflare.com/queues/configuration/local-development/

### Local data and commands

The implementation agent must configure Wrangler with bindings for D1
and R2. Local bindings should be used by default. Do not set
`remote: true` for production resources in normal local development.

Wrangler local state is generally persisted under `.wrangler/state`.
Ensure this directory is ignored by Git.

Use Drizzle migrations against the local D1 database. Confirm the exact
Drizzle Kit/Wrangler commands against the selected package versions and
document them in README.

### Required tests

**Provider tests** - Authentication/token refresh behavior. -
Pagination. - Mapping of products/categories. - Optional/missing
fields. - Rate limit response. - Transient errors and retries. -
Malformed upstream payload.

**Sync tests** - Initial sync. - Repeated sync is idempotent. - Product
update preserves website settings. - Product deletion/inactivation. -
Partial page failure does not advance watermark incorrectly. -
Out-of-order webhook event. - Image fetch failure does not corrupt
product record.

**API tests** - Pagination and maximum page size. - Search and category
filter. - Hidden/inactive product excluded. - Unknown slug returns
404. - No provider credentials or internal identifiers leaked.

**Frontend tests** - Mobile responsive layout. - Product/category route
SSR HTML includes content. - Metadata is unique and correct. - Image
failure fallback. - Contact links work. - 404 behavior. -
Keyboard/accessibility basics.

**Integration tests** - Local Worker + local D1 + local R2. - Simulated
KiotViet API responses. - Webhook test endpoint. - Cron event
invocation. - Full local user journey from catalog data to rendered
product page.

------------------------------------------------------------------------

## 12. Human actions required

Agents may prepare code, instructions, and checklists for these tasks,
but must not perform account-level actions, accept commercial terms,
reveal credentials, or deploy production resources without explicit
human approval.

### HUMAN ACTION H1 --- Confirm KiotViet API access

**Platform:** KiotViet merchant/admin portal and KiotViet
support/developer documentation.

**Input needed:** - Store/retailer account. - Current KiotViet
subscription/package. - Administrator access. - API application
credentials if enabled.

**Steps:** 1. Sign in to the KiotViet administration portal. 2. Find the
API connection/developer integration settings (exact menu labels may
vary). 3. Check whether Public API access is enabled for the
subscription. 4. Register/create an API application if required. 5.
Obtain the required client/application ID, client secret, and retailer
identifier according to current KiotViet instructions. 6. Ask KiotViet
support to confirm current product/category API access, rate limits,
webhook availability, and webhook authentication. 7. Do not paste
secrets into chat, source files, issue trackers, or agent prompts. Put
them only in a local ignored `.dev.vars` file or approved secret
manager.

**Expected output:** - Confirmation that API access is enabled. - Client
ID, client secret, retailer identifier stored securely by the human. -
Current official API documentation/version. - Confirmation of webhook
event types and registration requirements, or confirmation that polling
is required.

**Agent follow-up:** Once credentials are locally configured, run a
read-only authentication and product-list smoke test. Do not modify
products in KiotViet.

### HUMAN ACTION H2 --- Provide sample catalog data

**Platform:** KiotViet admin/export function or API test results.

**Input needed:** - A small representative selection of products,
categories, images, and variants. - Include examples of products with
and without variants, multiple images, missing descriptions, inactive
products, and different price values if present.

**Steps:** 1. Export or retrieve a small sample through the official
API. 2. Redact customer or unrelated sensitive data. 3. Save sanitized
JSON fixtures in the project test-fixtures directory. 4. Do not commit
access tokens or secrets.

**Expected output:** - Sanitized sample product/category payloads. -
Confirmed field semantics and representative edge cases.

**Agent follow-up:** Build and test the provider mapper against these
fixtures.

### HUMAN ACTION H3 --- Confirm product presentation rules

**Platform:** Project owner decision; no external platform required.

**Input needed:** - Store name and brand assets. - Currency (assume VND
until confirmed). - Whether prices should be displayed. - Whether
stock/availability should be displayed. - Which contact channels should
appear. - Whether products/categories can be hidden from the website
independently of KiotViet.

**Steps:** 1. Provide store name/logo/brand colors if available. 2.
Confirm contact URLs for TikTok, Instagram, Zalo, Messenger, or other
channels. 3. Confirm whether all source products should be public by
default or require a website visibility flag. 4. Confirm whether product
variants should be shown on product detail pages.

**Expected output:** - Store presentation settings. - Contact URLs. -
Visibility and pricing rules.

### HUMAN ACTION H4 --- Create Cloudflare account and production resources (deferred)

**Platform:** Cloudflare Dashboard --- https://dash.cloudflare.com/

**Do this only when local development and tests pass.**

**Input needed:** - Human-controlled email/account. - Account
authentication and any required billing details. - Project name. -
Domain name if using a custom domain.

**Steps:** 1. Create/sign in to Cloudflare. 2. Enable Workers. 3. Create
the production D1 database. 4. Create the production R2 bucket. 5.
Create Queues only if the implementation actually uses them. 6.
Configure production bindings and secrets. 7. Configure custom domain
and public image delivery. 8. Configure Cron Triggers. 9. Verify plan
limits and any paid features before enabling them.

**Expected output:** - Cloudflare account ID. - Production D1 database
ID. - R2 bucket name. - Worker deployment target. - Custom domain status
(if applicable). - Secrets stored in Cloudflare's secret manager.

**Security:** The human should enter credentials in Cloudflare or a
secure local terminal. Do not ask the human to paste account API tokens
into chat.

### HUMAN ACTION H5 --- Configure Git repository and CI/CD (deferred)

**Platform:** GitHub and Cloudflare Workers Builds/Git integration, or
GitHub Actions.

**Input needed:** - GitHub account/repository. - Repository access. -
Cloudflare deployment authorization.

**Steps:** 1. Create a private repository if the project should remain
private. 2. Push source code after confirming secrets and local state
are excluded. 3. Connect repository to Cloudflare deployment tooling or
configure GitHub Actions. 4. Configure preview/staging and production
environments separately. 5. Add deployment secrets through the
platform's secret settings.

**Expected output:** - Repository URL. - CI workflow. - Successful
preview deployment. - Human-approved production deployment process.

### HUMAN ACTION H6 --- Verify production webhook registration (deferred)

**Platform:** KiotViet API/admin portal and Cloudflare deployed Worker
endpoint.

**Input needed:** - Public HTTPS webhook URL. - Verified KiotViet
webhook event specification. - Required authentication/signature
details. - API credentials.

**Steps:** 1. Confirm current webhook documentation and registration
endpoint. 2. Deploy the webhook handler to a staging/production
endpoint. 3. Register only the required product update/delete events. 4.
Update a test product in KiotViet with human approval. 5. Verify
delivery, authentication, idempotency, logs, and D1 update. 6. Confirm
deletion/inactivation behavior. 7. Keep Cron reconciliation enabled even
after webhooks work.

**Expected output:** - Verified event payload examples. - Successful
end-to-end update/delete test. - Documented webhook reliability and
fallback polling schedule.

------------------------------------------------------------------------

## 13. Implementation phases and acceptance criteria

### Phase 0 --- Repository and architecture proof

**Progress:** Complete (owner-approved deferral: fresh-clone setup verification has not been performed). Local migration, D1/R2 smoke tests, health endpoint, Angular server-rendered sample route, and local Workers SSR/asset proof passed. Production deployment compatibility remains unverified. See `docs/phase-0-compatibility.md` and commit `ceeb3be`.

**Tasks** - Create monorepo and package scripts. - Scaffold Angular SSR
application. - Scaffold Hono Worker. - Configure local Wrangler D1 and
R2 bindings. - Configure Drizzle and first migration. - Prove Angular
SSR can run locally and can be packaged for Cloudflare Workers. - Add
health endpoint and basic smoke tests.

**Acceptance criteria** - Fresh clone can install dependencies and run
locally using documented commands. - Local D1 and R2 work without
production Cloudflare resources. - Migration can be applied to local
D1. - Angular product-like route renders meaningful HTML on the
server. - A minimal deployment compatibility proof exists for Angular
SSR on Workers, or a documented blocker/alternative is raised before
further storefront implementation.

### Phase 1 --- Normalized catalog and API

**Progress:** Complete locally. The normalized schema and migration, repeatable fixtures, and read-only catalog API pass local integration tests for pagination, filtering, visibility, provider-ID separation, and preservation of website settings. SQLite LIKE does not provide full Unicode case-insensitive search; provider image URLs are withheld until application-controlled delivery is implemented in Phase 3. No KiotViet integration or production resources have been created.

**Tasks** - Implement D1 schema and migrations. - Implement repositories
and catalog services. - Implement public product/category endpoints. -
Add local fixture seeding. - Add search, pagination, category filtering.

**Acceptance criteria** - API returns fixture-backed product/category
data. - Pagination and filtering tests pass. - Provider-specific IDs are
not used as public IDs. - Website-managed settings remain separate from
provider fields.

### Phase 2 --- KiotViet provider and initial sync

**Tasks** - Verify current KiotViet API documentation. - Implement
authentication and token handling. - Implement product/category
retrieval and pagination. - Implement mapping and idempotent upsert. -
Implement initial full sync. - Add sync logs and bounded retries.

**Acceptance criteria** - Read-only API smoke test succeeds with
human-provided local credentials. - Initial sync imports all pages from
test/store data. - Re-running sync creates no duplicates. - Failures do
not silently skip products. - Secrets are not logged or committed.

**Human dependency:** H1 and H2.

### Phase 3 --- Product images in R2

**Tasks** - Implement image validation/download. - Upload images to
local R2 in development. - Store R2 keys/metadata in D1. - Serve images
through a stable public URL strategy. - Handle failed downloads and
replaced/deleted images.

**Acceptance criteria** - Local image sync works. - Duplicate image
downloads are avoided where possible. - Invalid or oversized image URLs
are rejected safely. - Product page uses R2-backed image references.

### Phase 4 --- Angular storefront and SEO

**Tasks** - Build homepage, product listing, category and product detail
pages. - Implement search/filtering/pagination. - Add contact links. -
Add SSR metadata, canonical links, sitemap and robots.txt. - Add
loading/error/empty states and responsive layout.

**Acceptance criteria** - Product/category content appears in initial
HTML. - Unique SEO metadata is rendered per route. - Product updates
appear without an Angular rebuild (subject to documented cache TTL). -
Mobile and desktop layouts work. - No cart/order/customer-management
features are added.

### Phase 5 --- Webhooks and reconciliation

**Tasks** - Verify current KiotViet webhook capability. - Implement
protected webhook endpoint. - Process product create/update/delete
events. - Add scheduled incremental reconciliation. - Add event
deduplication and sync observability.

**Acceptance criteria** - Test product update is reflected in D1 and
storefront. - Delete/inactive event hides product safely. - Duplicate
and out-of-order events do not corrupt data. - Reconciliation can repair
a deliberately missed webhook. - Webhook failure is visible in logs/sync
records.

**Human dependency:** H6.

### Phase 6 --- Cloudflare deployment

**Tasks** - Create production resources after approval. - Apply
migrations to production D1. - Create/configure production R2 bucket. -
Deploy Workers and Angular SSR storefront. - Configure secrets, custom
domain, cache behavior, cron and webhook URL. - Configure CI/CD and
monitoring.

**Acceptance criteria** - Production smoke tests pass. - No local
binding points to production accidentally. - No secret appears in
browser bundles or logs. - Public product pages return server-rendered
HTML. - Image delivery works over HTTPS. - Cron and webhook
synchronization work end-to-end. - Free-tier usage and limits are
documented.

**Human dependency:** H4, H5, H6.

### Phase 7 --- Future MISA migration (not part of v1)

Do not start until the owner chooses a MISA product.

**Tasks** - Confirm that exact MISA product exposes supported
product/category/image/price/variant APIs. - Implement a MISA adapter
against the same provider interface. - Map MISA external IDs to existing
internal product IDs where matching is possible. - Run a dry-run
comparison before switching. - Switch provider only after reconciliation
and human approval.

**Acceptance criteria** - Storefront API contract remains unchanged. -
Website-managed fields survive migration. - Product identity mapping is
documented. - Rollback plan exists.

------------------------------------------------------------------------

## 14. Operational and security requirements

-   Store KiotViet client secrets and tokens as Worker secrets, not
    plain vars.
-   Local secrets belong in ignored `.dev.vars`.
-   Never expose upstream API credentials to Angular/browser code.
-   Validate webhook authenticity using the actual provider
    specification.
-   Validate and constrain upstream image URLs to reduce SSRF risk.
-   Apply request timeouts and bounded retries to upstream calls.
-   Apply pagination limits and input validation to public API
    endpoints.
-   Do not log authorization headers, tokens, or full secrets.
-   Use soft deactivation for deleted upstream products to preserve
    references and auditability.
-   Keep local, staging, and production D1/R2 resources separate.
-   Do not enable remote bindings in local development by default.
-   Keep `.wrangler/state`, `.dev.vars`, generated secrets, and local
    database files out of Git.
-   Configure backups/export strategy before relying on production D1.
-   Monitor Workers CPU/request usage, D1 reads/writes, R2
    storage/operations, and queue usage if enabled.
-   Treat free-tier quotas as limits, not guaranteed capacity. Recheck
    current pricing/limits before launch.

------------------------------------------------------------------------

## 15. Definition of done for v1

The project is ready for initial production use when:

-   [ ] Product catalog is populated from KiotViet.
-   [ ] Products/categories/images are normalized into D1/R2.
-   [ ] Product listing, search, categories, and product detail pages
    work.
-   [ ] Product pages are server-rendered and SEO metadata is correct.
-   [ ] Contact buttons link to configured social/chat channels.
-   [ ] Product updates propagate through webhooks where verified, with
    Cron reconciliation as fallback.
-   [ ] No customer/order/checkout functionality exists.
-   [ ] Website-specific marketing and SEO fields survive source
    synchronization.
-   [ ] Local development and test instructions work from a fresh clone.
-   [ ] Production deployment and secrets are configured safely.
-   [ ] Human has approved production launch.

------------------------------------------------------------------------

## 16. Official references

Use current official documentation and verify version-specific commands
before implementation.

### Cloudflare

-   Workers local development:
    https://developers.cloudflare.com/workers/local-development/
-   Local resources/data:
    https://developers.cloudflare.com/workers/local-development/local-data/
-   D1 local development:
    https://developers.cloudflare.com/d1/best-practices/local-development/
-   D1 overview: https://developers.cloudflare.com/d1/
-   R2: https://developers.cloudflare.com/r2/
-   Queues local development:
    https://developers.cloudflare.com/queues/configuration/local-development/
-   Cron Triggers:
    https://developers.cloudflare.com/workers/configuration/cron-triggers/
-   Angular on Workers:
    https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/angular/

### Angular

-   SSR and hybrid rendering: https://angular.dev/guide/ssr

### Hono / Drizzle

-   Hono: https://hono.dev/
-   Drizzle ORM: https://orm.drizzle.team/
-   Drizzle D1 guide:
    https://orm.drizzle.team/docs/connect-cloudflare-d1

### KiotViet

-   Public API documentation: https://www.kiotviet.vn/ (locate current
    developer/Public API documentation from the official site)
-   Do not rely on old webhook manuals without confirming current
    support and payload/authentication details.

------------------------------------------------------------------------

## 17. First task for the implementation agent

Start with **Phase 0 only**.

Do not implement the full catalog yet.

Deliver: 1. Proposed exact package versions and compatibility notes. 2.
Monorepo scaffold. 3. Angular SSR local app. 4. Hono Worker with
`/api/health`. 5. Local D1 and R2 bindings. 6. Drizzle schema/migration
proof. 7. A smoke test proving the Worker can write/read local D1 and
put/get a test object in local R2. 8. A minimal Angular SSR route
proving server-rendered HTML. 9. A short Cloudflare deployment
compatibility report for Angular SSR. 10. Updated README with exact
local setup/run/test commands.

Stop and report before creating any Cloudflare production resources or
requesting production credentials.
