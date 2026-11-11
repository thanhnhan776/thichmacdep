import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { localSmokeChecks } from '../drizzle/schema';
import type { Bindings } from '../apps/api/src/index';

// This entry point is used only by the explicitly local test configuration.
export default {
  async fetch(_request: Request, env: Bindings): Promise<Response> {
    const id = crypto.randomUUID();
    const key = `phase-0-tests/${id}`;
    const value = 'local-binding-smoke-test';
    const db = drizzle(env.DB);
    try {
      await db.insert(localSmokeChecks).values({ id, value });
      const rows = await db.select().from(localSmokeChecks).where(eq(localSmokeChecks.id, id));
      await env.IMAGES.put(key, value);
      const object = await env.IMAGES.get(key);
      if (rows.length !== 1 || rows[0].value !== value || !object || await object.text() !== value) {
        return new Response('Local binding round trip failed', { status: 500 });
      }
      return Response.json({ d1: 'ok', r2: 'ok' });
    } finally {
      await db.delete(localSmokeChecks).where(eq(localSmokeChecks.id, id));
      await env.IMAGES.delete(key);
    }
  },
};
