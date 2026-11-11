# Local catalog data model

Phase 1 uses local D1/SQLite migrations and synthetic fixtures. There is no remote production database or provider integration configured by this work.

- **Identity:** catalog entities use internal text IDs. `external_product_mappings` connects a product to a provider and external ID, unique per provider; optional external variant identifiers are separate from internal variant IDs. Provider identifiers and sync metadata are not public API fields.
- **Categories:** categories can have a parent. `product_category` is a normalized many-to-many join with a composite key. This is a provisional local modeling choice, not an assertion that a provider supports many-to-many relationships.
- **Products and variants:** products hold core catalog data, active status and optional source/sync timestamps. Variants belong to products; provider-specific fields remain optional. Public reads exclude inactive products and variants.
- **Website-owned data:** `website_product_settings` separately holds SEO, marketing, featured, ordering and visibility settings. `store_settings` separately holds store identity and contact URLs. Hidden products are not public. Keeping these separate avoids treating website choices as provider data.
- **Dates and money:** timestamps are application-supplied UTC ISO-8601 text. Prices are nonnegative integer minor units, nullable where unknown; the default currency is VND, where the integer represents đồng. No floating-point prices are used.
- **Images:** `product_images` can record a source URL and optional R2 key, but public product details return an empty `images` array. Source URLs and storage keys are withheld until Phase 3 application-controlled image delivery.
- **Sync records:** `sync_runs` and `sync_events` reserve local structure for future synchronization; their presence does not mean sync is implemented.

Run `corepack pnpm db:migrate:local` before `corepack pnpm db:seed:local`. The seed uses `INSERT OR IGNORE`: repeating it adds missing fixtures where constraints permit, but does not reset or overwrite existing rows, including website-owned settings. It is not a reconciliation or refresh operation.

The product list searches names and SKUs with escaped SQLite `LIKE` substring matching. SQLite's default case folding is ASCII-oriented; case-insensitive matching of Vietnamese non-ASCII text is not guaranteed. Successful public catalog reads carry `Cache-Control: public, max-age=60`; clients may see cached results for 60 seconds.
