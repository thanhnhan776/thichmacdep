# Production CI deployment

Every push to `main` runs `.github/workflows/deploy.yml` and **is approval to change production**. There is no manual approval gate. Protect `main` with required reviews and restrict who can push or change the workflow. Configure these controls and the settings below before enabling or merging the workflow.

## GitHub and Cloudflare setup

1. In repository Actions secrets, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Use a dedicated Cloudflare token restricted to the production account and the permissions needed to deploy both Workers and apply D1 migrations. Never expose the token to untrusted workflows or pull request code; review workflow and dependency changes before merging.
2. In repository Actions variables, set `GOOGLE_CLIENT_ID` to the production Google OAuth **web client ID** (not a client secret). It is public configuration, not a credential. Authorize `https://thichmacdep.nhanttdev.workers.dev` as a JavaScript origin in Google Cloud. CI validates and passes the ID through an environment variable rather than interpolating it into shell code.
3. Verify the account's workers.dev subdomain, the production D1 database ID and migration state in `wrangler.production.jsonc`, and both Worker configurations, service binding, routes, access settings and rate limits. Disabling workers.dev and preview URLs on the API does not remove existing routes. Back up production data and verify the backup and restore process before migrations.
4. Confirm production readiness separately: deployed same-origin routing, HTTPS, OAuth sign-in, edge protections, and the operational caveats in `README.md` are not established by this workflow. The existing README describes production as unverified; a successful workflow does not by itself resolve those concerns.

## Execution and recovery

The workflow installs the locked dependencies with Node 24 and pnpm, validates configuration, runs API typechecking and API, sync, storefront, SSR and catalog tests, and builds the storefront before any remote operation. It then applies D1 migrations, deploys the API with both production variables, deploys the storefront, and checks `/api/health` through the public storefront. The health check only confirms that endpoint responds with `status: ok`; it is not a complete production smoke test.

Deployments are serialized and an in-progress run is not canceled, but GitHub concurrency can replace a pending run with a newer one. Do not rely on every intermediate commit deploying.

**Remote changes are not atomic.** A failed migration, deploy, or health check can leave the database, API, and storefront at different versions; a failed run does not undo earlier steps. Stop further changes, inspect the Actions logs and current Cloudflare Worker versions and D1 migration state, and assess compatibility before recovery. Re-run only when the remaining operations are safe and idempotent. If necessary, deploy a known-good compatible Worker version or push a reviewed corrective commit; database migrations are not automatically reversed. Restore data from a verified backup or use a separately reviewed forward migration when appropriate. Verify the public health endpoint and real storefront and sign-in behavior after recovery. Never blindly roll back application code across incompatible schema changes.
