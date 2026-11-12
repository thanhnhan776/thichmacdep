import storefront from '../apps/storefront/dist/storefront/server/server.mjs';

const product = (slug: string) => ({
  id: slug, sku: null, slug, name: `Product ${slug}`, shortDescription: `Description ${slug}`,
  description: null, brandName: null, priceMinor: null, currency: 'VND',
  website: { seoTitle: null, seoDescription: null, marketingDescription: null, isFeatured: false, displayOrder: 0 },
  images: [], variants: [], categories: [],
});

export default {
  fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }) {
    const options = new URL(request.url).searchParams;
    const origin = options.has('no-origin') ? undefined : options.has('bad-origin') ? 'https://shop.example/path' : options.has('production') ? new URL(request.url).origin : 'https://shop.example';
    const api = { async fetch(input: Request) {
      const path = new URL(input.url).pathname;
      if (path === '/api/categories') return Response.json(options.has('malformed') ? {} : [{ id: 'c', slug: 'linen', name: 'Linen', parentId: null }]);
      if (path === '/api/store-settings') return new Response(null, { status: 404 });
      if (path === '/api/products') {
        const params = new URL(input.url).searchParams;
        const page = Number(params.get('page') ?? 1), pageSize = Number(params.get('pageSize') ?? 12);
        if (options.has('too-large')) return Response.json({ items: [], total: 5001, page, pageSize });
        if (options.has('partial')) return Response.json({ items: [], total: 1, page, pageSize });
        if (options.has('sitemap-data')) {
          const all = Array.from({ length: 101 }, (_, i) => ({ slug: i === 0 ? 'silk&lace' : i === 1 ? 'proof' : i === 2 ? 'sample' : `item-${i}` }));
          return Response.json({ items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize });
        }
        return Response.json({ items: [], total: 0, page, pageSize });
      }
      if (path.startsWith('/api/products/')) {
        const slug = path.slice('/api/products/'.length);
        return slug === 'missing' ? new Response(null, { status: 404 }) : Response.json(product(slug));
      }
      return new Response(null, { status: 404 });
    } };
    // Strip the test-only switch before routing so it does not turn the page into a filter.
    const url = new URL(request.url);
    for (const key of ['no-origin', 'bad-origin', 'malformed', 'too-large', 'partial', 'sitemap-data', 'production']) url.searchParams.delete(key);
    return storefront.fetch(new Request(url, request), { ASSETS: env.ASSETS, API: api, SITE_ORIGIN: origin });
  },
};
