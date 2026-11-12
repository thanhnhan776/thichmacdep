import { isPlatformServer } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { ActivatedRoute, ResolveFn } from '@angular/router';
import { firstValueFrom } from 'rxjs';

type CatalogContext = { catalogFetch: (request: Request) => Promise<Response> };
const MAX_BYTES = 256 * 1024;

function namesFrom(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items) || value.items.length > 20) {
    throw new Error('Invalid catalog response');
  }
  return value.items.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('name' in item) || typeof item.name !== 'string' || item.name.length > 1000) {
      throw new Error('Invalid catalog product');
    }
    return item.name;
  });
}

async function readLimited(response: Response): Promise<unknown> {
  if (!response.ok || response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
    throw new Error('Catalog unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Catalog response too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export const resolveProductProof: ResolveFn<string[]> = async (route) => {
  // The only accepted input becomes a query value, never a path or destination.
  const values = route.queryParamMap.getAll('keyword');
  if (values.length > 1 || (values.length && (!values[0].trim() || values[0].length > 200))) throw new Error('Invalid keyword');
  const params = new URLSearchParams();
  if (values.length) params.set('keyword', values[0]);
  const path = `/api/products${params.size ? `?${params}` : ''}`;
  const state = inject(TransferState);
  const key = makeStateKey<string[]>(`product-proof-v1:${path}`);
  const server = isPlatformServer(inject(PLATFORM_ID));
  const context = inject(REQUEST_CONTEXT) as CatalogContext | null;
  const http = inject(HttpClient);
  if (!server && state.hasKey(key)) {
    const names = state.get(key, []);
    state.remove(key);
    return names;
  }
  let names: string[];
  if (server) {
    if (!context || typeof context.catalogFetch !== 'function') throw new Error('Catalog binding unavailable');
    const request = new Request(`https://catalog.internal${path}`, {
      method: 'GET', headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(5000),
    });
    names = namesFrom(await readLimited(await context.catalogFetch(request)));
    state.set(key, names);
  } else {
    names = namesFrom(await firstValueFrom(http.get<unknown>(path, { transferCache: false })));
  }
  return names;
};

@Component({
  selector: 'app-product-proof',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<main><h1>Catalog proof</h1><ul>@for (name of names; track $index) { <li>{{ name }}</li> }</ul></main>',
})
export class ProductProof {
  readonly names = inject(ActivatedRoute).snapshot.data['names'] as string[];
}
