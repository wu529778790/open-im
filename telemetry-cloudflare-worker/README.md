# Cloudflare Worker telemetry collector (example)

Minimal **HTTPS** endpoint compatible with open-im’s `OPEN_IM_TELEMETRY_URL`:

- `POST` any path you configure (e.g. `/v1/ingest`)
- `Content-Type: application/x-ndjson`
- Optional `Authorization: Bearer <token>` — set the same value in open-im as `OPEN_IM_TELEMETRY_TOKEN` / `telemetry.token`, and as Worker secret `TELEMETRY_INGEST_TOKEN`.

Each request body is stored as one object in **R2** under `events/YYYY-MM-DD/<uuid>.ndjson`.

## Setup

1. Create an **R2** bucket in the Cloudflare dashboard (e.g. `open-im-telemetry`).
2. Copy `wrangler.toml` and set `bucket_name` to that bucket.
3. Deploy:

   ```bash
   npm i -g wrangler
   wrangler secret put TELEMETRY_INGEST_TOKEN   # optional but recommended
   wrangler deploy
   ```

4. Point open-im at your worker URL, including path:

   ```bash
   export OPEN_IM_TELEMETRY_URL="https://open-im-telemetry.<your-subdomain>.workers.dev/v1/ingest"
   export OPEN_IM_TELEMETRY_TOKEN="same-as-wrangler-secret"
   ```

Or use a custom domain and route in the Cloudflare dashboard.

## Limits

The worker rejects bodies larger than **1 MiB** (`413`). Adjust in `src/index.ts` if needed.
