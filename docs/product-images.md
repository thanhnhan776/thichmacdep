# Product image storage

`POST /api/admin/images` accepts a raw JPEG, PNG, GIF, or WebP body of at most 5 MiB. Set the matching `Content-Type`, send the admin session cookie, the configured admin `Origin`, and `X-CSRF-Token`. The response contains `{ "url": "..." }`; uploading does not attach the image to a product.

For production, bind `IMAGES` to the R2 bucket and set `IMAGE_PUBLIC_BASE_URL` to the HTTPS URL of its public custom domain (including any key prefix). Configure the R2 custom domain separately and keep the bucket private otherwise. Set `IMAGE_ALLOW_LOCAL` to `false` or omit it. Existing KiotViet image hosts remain trusted for imported catalog images.

The standalone local API serves uploaded objects at `http://127.0.0.1:8787/api/images/`. The multiworker `pnpm dev:storefront:worker` setup uses `http://localhost:4200/api/images/` instead. Stored local URLs are specific to the mode that uploaded them. The local serving route only works when explicitly enabled and the configured base matches the request origin and path. These configurations are for local development only; do not deploy them unchanged. Production R2 binding, custom domain and public delivery must be configured and verified separately.
