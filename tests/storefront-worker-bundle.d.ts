declare module '*/dist/storefront/server/server.mjs' {
  const storefront: {
    fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> }; API: { fetch(request: Request): Promise<Response> }; SITE_ORIGIN?: string }): Promise<Response>;
  };
  export default storefront;
}
