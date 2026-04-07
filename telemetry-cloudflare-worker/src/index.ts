// @ts-nocheck — deploy with `wrangler deploy`; types come from Wrangler / @cloudflare/workers-types if installed.
/**
 * Example Cloudflare Worker: receives NDJSON telemetry from open-im and stores batches in R2.
 *
 * Secrets (optional): wrangler secret put TELEMETRY_INGEST_TOKEN
 */

export interface Env {
  TELEMETRY_BUCKET: R2Bucket;
  /** If set, require Authorization: Bearer <token> */
  TELEMETRY_INGEST_TOKEN?: string;
}

const MAX_BODY_BYTES = 1 << 20; // 1 MiB

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const token = env.TELEMETRY_INGEST_TOKEN;
    if (token) {
      const auth = request.headers.get('Authorization');
      if (auth !== `Bearer ${token}`) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    const ct = request.headers.get('Content-Type') ?? '';
    if (!ct.includes('ndjson') && !ct.includes('json')) {
      return new Response('Unsupported Media Type', { status: 415 });
    }

    const len = request.headers.get('Content-Length');
    if (len && Number.parseInt(len, 10) > MAX_BODY_BYTES) {
      return new Response('Payload Too Large', { status: 413 });
    }

    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return new Response('Payload Too Large', { status: 413 });
    }

    const lines = body.split('\n').filter((l) => l.trim().length > 0);
    let accepted = 0;
    for (const line of lines) {
      try {
        JSON.parse(line);
        accepted++;
      } catch {
        return new Response('Invalid JSON line', { status: 400 });
      }
    }

    const day = new Date().toISOString().slice(0, 10);
    const key = `events/${day}/${crypto.randomUUID()}.ndjson`;
    await env.TELEMETRY_BUCKET.put(key, body, {
      httpMetadata: { contentType: 'application/x-ndjson' },
    });

    return new Response(JSON.stringify({ accepted }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
