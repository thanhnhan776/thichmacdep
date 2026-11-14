// Server-owned allowlist; URLs are never fetched by the catalog service.
export const IMAGE_HOSTS = ['cdn2-retail-images.kiotviet.vn', 'cdn1-retail-images.kiotviet.vn', 'cdn-images.kiotviet.vn'] as const;

export function imageBaseUrl(value: string | undefined, allowLocal = false): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = allowLocal && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!(url.protocol === 'https:' || local) || url.username || url.password || url.search || url.hash) return null;
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  } catch {
    return null;
  }
}

export function publicImageUrl(value: string | null, base?: string, allowLocal = false): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    const configured = imageBaseUrl(base, allowLocal);
    const trustedConfigured = configured && url.origin === configured.origin && url.pathname.startsWith(configured.pathname);
    const trustedImport = url.protocol === 'https:' && !url.port && IMAGE_HOSTS.some(host => host === url.hostname);
    if (!trustedConfigured && !trustedImport) return null;
    return url.href;
  } catch {
    return null;
  }
}
