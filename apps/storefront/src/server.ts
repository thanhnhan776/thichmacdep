import { AngularAppEngine, createRequestHandler } from '@angular/ssr';
import { crawlerResponse } from './crawler';
import { checkApiRateLimit, type RateLimitEnv } from './api-rate-limit';

const angularApp = new AngularAppEngine();

// The named handler is consumed by Angular's application builder and dev server.
export const reqHandler = createRequestHandler((request: Request) => angularApp.handle(request));

interface WorkerEnv extends RateLimitEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API: { fetch(request: Request): Promise<Response> };
  SITE_ORIGIN?: string;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return (await checkApiRateLimit(request, env)) ?? env.API.fetch(request);
    }
    if (pathname === '/sitemap.xml' || pathname === '/robots.txt') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
      return crawlerResponse(request, env.API, env.SITE_ORIGIN);
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = await env.ASSETS.fetch(request);
      // HTML belongs to Angular, even if the asset directory contains an index file.
      const contentType = asset.headers.get('content-type');
      if ((asset.ok || asset.status === 304) && contentType && !/\btext\/html\b/i.test(contentType)) {
        return asset;
      }
    }
    return (await angularApp.handle(request, {
      catalogFetch: (catalogRequest: Request) => env.API.fetch(catalogRequest),
      siteOrigin: env.SITE_ORIGIN,
    })) ?? new Response('Not Found', { status: 404 });
  },
};
