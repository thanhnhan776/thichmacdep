// Server-owned allowlist; URLs are never fetched by the catalog service.
export const IMAGE_HOSTS = ['cdn2-retail-images.kiotviet.vn', 'cdn1-retail-images.kiotviet.vn', 'cdn-images.kiotviet.vn'] as const;

export function publicImageUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !IMAGE_HOSTS.some(host => host === url.hostname) ||
        url.username || url.password || url.port) return null;
    return url.href;
  } catch {
    return null;
  }
}
