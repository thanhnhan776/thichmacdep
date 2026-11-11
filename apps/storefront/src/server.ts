import { AngularAppEngine, createRequestHandler } from '@angular/ssr';

const angularApp = new AngularAppEngine();

// The named handler is consumed by Angular's application builder and dev server.
export const reqHandler = createRequestHandler((request: Request) => angularApp.handle(request));

interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return (await reqHandler(request)) ?? env.ASSETS.fetch(request);
  },
};
