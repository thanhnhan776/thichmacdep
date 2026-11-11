# Phase 0 technical compatibility report

## Scope and observed proof

The Phase 0 local proof uses Angular's Web Request/Response `AngularAppEngine` and `createRequestHandler` entry with a Workers Assets fallback. The product route is runtime server-rendered static sample content. The parent session reported a successful storefront build and component test, then a local Wrangler Worker returning HTTP 200 meaningful server HTML at `/products/sample` and HTTP 200 for the JavaScript asset resolved against the document's base href. This is a local runtime observation, not evidence of deployed production compatibility. The automated SSR smoke test reproduces these checks; its result must be reported separately when run.

## Versions and configuration

- Angular core/SSR/build/CLI/compiler: **22.2.5**; TypeScript **6.0.3**. Node supported by the workspace: `^22.22.3 || ^24.15.0 || ^26.0.0`. pnpm **12.18.0**. See the lockfile for exact transitive versions.
- Wrangler **4.160.0**; Hono **4.13.18**; Drizzle ORM **0.45.4** and Drizzle Kit **0.31.11**.
- The local storefront Worker uses compatibility date `2026-11-01` and both `nodejs_compat` and `new_module_registry`. The latter is explicitly enabled for this date; runtime module loading and Node compatibility are not guarantees that every Node API or arbitrary package works on Workers.
- Angular's build configuration allows only `localhost` and `127.0.0.1` as SSR hosts for this local proof. Before deployment, explicitly configure and validate the intended trusted hosts; do not broadly trust arbitrary Host headers.
- Wrangler serves generated browser assets with `run_worker_first`; the Worker falls back to the Assets binding when Angular does not handle the request. The smoke test resolves the JavaScript URL against the HTML base href rather than the product path.

## Limits and next validation

No deployed Worker, public domain, real D1/R2 resource, production permissions, routing, caching, load, cold starts, observability, or browser hydration has been validated. Local D1/R2 simulation is not a production resource or permission test. The API migration and binding tests are separate from the storefront SSR test. No provider integration or actual catalog is included. Deployment and creation of external resources require explicit human approval under the project plan.

References: [Angular SSR](https://angular.dev/guide/ssr), [Angular version compatibility](https://angular.dev/reference/versions), [Workers bundling and runtime module loading](https://developers.cloudflare.com/workers/wrangler/bundling/#runtime-module-loading), [Workers Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), and [Workers local development](https://developers.cloudflare.com/workers/local-development/).
