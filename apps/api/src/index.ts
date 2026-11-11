import { Hono } from 'hono';

export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/health', (context) => context.json({ status: 'ok' }));

export default app;
