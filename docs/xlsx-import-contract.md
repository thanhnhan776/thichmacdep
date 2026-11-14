# XLSX catalog import contract

Manual preview/import and the protected admin UI are complete locally. The owner configured Google sign-in, imported the actual workbook, and confirmed reimport works. Edge rate limits, deployed storefront/API routing and production OAuth configuration remain outstanding. No production resources have been created. The export is sensitive: do not commit it, reproduce product values, or use it as a test fixture. Examples and fixtures must be synthetic.

## Observed export and scope

The inspected workbook has one sheet and 185 data rows: 183 goods and two services. Preview parsing reported 73 product groups and zero validation errors; the owner subsequently imported and reimported it locally. Of the goods, 165 have attributes and all 165 have a SKU suffix matching their SIZE attribute, forming 55 groups; the remaining 18 are standalone. All goods in this sample have a code, name, category, price, image URL and business flags. These observations are not guarantees for future exports.

Import only rows whose classification, after Unicode normalization (NFC), whitespace trimming and case-insensitive comparison, equals `Hàng hóa`. Skip known non-goods such as `Dịch vụ`; report missing or unrecognized classifications instead of guessing. Use the `Mã hàng` column as the SKU, preserving it as text, including leading zeros; do not infer a SKU from a numeric cell that cannot preserve its original representation.

## Grouping and ambiguity

A row with an explicit SIZE is eligible for a group when its SKU has a separable matching suffix after Unicode normalization, trimming and case-insensitive comparison. Explicit sizes may be user-defined. The remaining nonempty SKU prefix is the candidate group key. For a family with at least two distinct recognized suffixes (XXXS, XXS, XS, S, M, L, XL, XXL, XXXL or 2XL–9XL), missing SIZE attributes are inferred from those suffixes, including when other family members have explicit SIZE. Inferred sizes are persisted. A lone row without attributes remains standalone, as do unrecognized suffixes without explicit SIZE. The suffix must be a complete component, not merely the ending of an unrelated code. Attribute names are compared case-insensitively. A size-bearing row without an unambiguous matching suffix is an error, not a standalone fallback.

For example, synthetic SKUs `DEMO-M` and `DEMO-L` may form group `DEMO` with explicit or inferred sizes. A terminal name suffix ` - SIZE` matching that row's size is removed for group comparison and the persisted group name; mismatched name suffixes are not removed. Names, brand, category, price and business flags must agree across the group. `DEMO-M` with SIZE `L` must be reported. Other or multiple variant dimensions, ambiguous suffix boundaries, conflicting group-level data, duplicate normalized SKUs or sizes, and standalone/group key collisions require an error and manual resolution; never silently merge or split products. A lone blank-attribute row from a previously grouped family is treated as standalone and rejected by identity collision checks, rather than silently changing the model. Use explicit SIZE on partial reimports to retain group identity.

Related product codes are not an authoritative grouping or identity source: in the inspected export, 39 references are outside the goods set. Do not create products, infer groups, or fail merely because a related code points outside that set. Report useful diagnostics without exposing private values in logs.

## Fields and validation

- **Price:** parse the cell value exactly as VND đồng, without floating-point rounding. Accept a nonnegative whole number of đồng, including an exact decimal representation with only zero fractional digits; reject fractional đồng, negative, malformed, formula-derived, or out-of-range values. Do not infer locale-specific text separators when ambiguous. A spreadsheet's displayed decimal formatting alone does not imply a fractional value.
- **Category:** use the category name as a name, not a path. Do not split it on punctuation or assume a hierarchy delimiter. Reject missing or ambiguous category mappings rather than inventing a parent hierarchy.
- **Images:** validate direct HTTPS KiotViet image URLs against the exact trusted hosts `cdn2-retail-images.kiotviet.vn`, `cdn1-retail-images.kiotviet.vn`, and `cdn-images.kiotviet.vn`, with no credentials or nonstandard ports. Store and use the URLs directly; never fetch them from the server during import or validation, and do not copy them to R2 in this phase. These external links can expire or stop working; maintain independent backups. Direct browser requests disclose the viewer's network information to the image host. Reconciliation changes only XLSX-owned photos, preserving photos owned by other sources.
- **Flags and other fields:** validate required source fields and recognized business flags rather than assuming the sample's active/direct-sale values always apply. Source-owned changes must not overwrite website-owned SEO, visibility, marketing, featured or ordering settings.

Formula cells, including cached formula results, are unsupported for import fields: report them instead of evaluating or trusting cached values. Unsupported workbook structures, invalid cell types, missing required columns, conflicting duplicate headers, unreadable files and resource-limit violations are file-level errors. Do not guess at unsupported variant models or silently discard conflicting data.

The storefront parser runs only in the administrator's browser and dynamically loads SheetJS on invocation. Its 5 MiB compressed input limit and post-parse worksheet limits do **not** bound decompression or parsing memory: a malicious archive can exhaust or hang the admin browser. Detection of macros and external links is limited to structures exposed by the parser and archive entries, not a security scan. It never executes formulas. Numeric spreadsheet cells have already been converted to JavaScript numbers by SheetJS; original numeric text, leading zero formatting, and arbitrary decimal precision cannot be recovered reliably. Codes must be actual text cells, and exact prices should be supplied as unambiguous text where precision matters. Parsed values and row numbers remain untrusted: the server must independently enforce JSON size, row, column and cell limits and revalidate every value and authorization before use. The current server validator assigns row numbers by array position, so callers must retain blank rows when mapping parser results to its input.

## Preview, identity and applying changes

An authenticated, authorized admin must receive a preview before confirming any write. The preview reports file-level errors and sheet/row/column-level errors with actionable reasons, skipped non-goods, and proposed creates, updates and unchanged records. Do not log workbook contents or expose sensitive rows to unauthorized users. Validation errors block the entire import; no partial writes. Revalidate the same uploaded content and identity conflicts at confirmation, then apply atomically, or reject a stale preview. Uploads require size and parsing limits; write endpoints require authorization and CSRF protection.

Repeated imports must be idempotent. Resolve existing records by stable source identity and SKU mappings, preserve internal product and variant IDs and website settings, and update only source-owned fields. Detect duplicate or conflicting source identifiers and SKUs both within the file and against existing records. A changed source ID must not create a duplicate or relink an unrelated product: retain the existing identity only when a unique, consistent SKU mapping proves the match; otherwise fail and report for manual resolution. Likewise, preserve the existing product identity for a known group; if regrouping, a changed group key, a split or merge would make identity or website settings ambiguous, fail and report rather than choosing an ID or transferring settings automatically.

New product and category SEO slugs use lowercase ASCII derived from names, stripping Vietnamese tones and converting `đ`/`Đ` to `d`. Collisions use a short numeric suffix such as `-2`; existing slugs stay stable across renames and reimports. Concurrent writers outside the XLSX lock may race slug allocation: a uniqueness failure is safe, but an operator must retry manually after the competing write finishes.

For existing local databases only, stop local writers and back up the local SQLite database before running the one-shot migration below, replacing the placeholder with its file path:

```sh
node scripts/migrate-local-slugs.mjs --local /path/to/local-d1.sqlite
```

The script converts recognized legacy-generated product and category slugs, leaving other slugs unchanged. Migrated legacy URLs have no redirects. No deployed migration is provided.

Rows absent from an upload are not evidence of deletion or deactivation. Leave existing products and variants untouched when absent. Explicit source status changes may be applied only after validation and preview; never infer them from absence. Partial variant status reconciliation has been fixed: present variants are updated without deactivating absent variants. Import failure must leave catalog and settings unchanged.

The internal preview returns a content digest and a catalog snapshot; both must be supplied to apply. The snapshot is checked after the XLSX sync lock is acquired. XLSX writers must use that lock. The grouping model and original category are recorded per product; legacy mappings without provenance are rejected for manual resolution. Because `product_category` cannot represent shared ownership, category changes are rejected rather than deleting another source's link or accumulating stale XLSX links.

Interrupted catalog writes can leave the lock running indefinitely. Follow the
[offline catalog lock recovery procedure](catalog-lock-recovery.md); never
clear a lock based only on its age.

There is no automatic stale-lock clearing. If an XLSX run remains `running` after a crash, an operator must first verify that no worker for that run is still live or can resume, then manually mark that specific run failed. Never clear a lock based on age alone.

SKU collision checks use the same Unicode normalization and case folding as XLSX validation across catalog products and variants. D1 does not provide a transaction spanning the reads and the later write batch: the XLSX lock serializes cooperating XLSX imports only. External writers that change SKUs concurrently can race the snapshot and collision checks; preventing that requires all catalog writers to share a lock or database-enforced normalized SKU constraints. Do not use concurrent production catalog writers until this is resolved.
