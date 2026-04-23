const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

for (const envPath of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
]) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

const account = process.env.CF_ACCOUNT_ID || 'cba670300f355a7e3ea08597133716fd';
const bucket = process.env.CF_R2_BUCKET || 'open-im-telemetry';
const prefix = process.env.CF_R2_PREFIX || 'events/';
const base = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/r2/buckets/' + bucket;
const outDir = process.env.CF_R2_OUT_DIR || path.join('logs', 'r2-events');
const endpoint = process.env.AWS_ENDPOINT_URL || process.env.CF_R2_ENDPOINT || `https://${account}.r2.cloudflarestorage.com`;

fs.mkdirSync(outDir, { recursive: true });

async function fetchJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) {
    throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
  }
  return res.json();
}

async function fetchBuffer(url, token) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) {
    throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function readBody(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  if (typeof body.arrayBuffer === 'function') {
    return Buffer.from(await body.arrayBuffer());
  }
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function downloadViaS3(accessKeyId, secretAccessKey) {
  const { GetObjectCommand, ListObjectsV2Command, S3Client } = await import('@aws-sdk/client-s3');

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  let continuationToken = undefined;
  let total = 0;
  let pages = 0;

  while (true) {
    const data = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));

    const items = data.Contents || [];
    pages += 1;

    for (const obj of items) {
      if (!obj.Key || obj.Key.endsWith('/')) continue;
      const localPath = path.join(outDir, ...obj.Key.split('/'));
      fs.mkdirSync(path.dirname(localPath), { recursive: true });

      const object = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: obj.Key,
      }));
      const body = await readBody(object.Body);
      fs.writeFileSync(localPath, body);
      total += 1;
    }

    console.log('page=' + pages + ' fetched=' + items.length + ' total=' + total);

    if (!data.IsTruncated || !data.NextContinuationToken) {
      break;
    }
    continuationToken = data.NextContinuationToken;
  }

  console.log('DONE total=' + total + ' pages=' + pages + ' mode=s3');
}

async function main() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.CF_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.CF_R2_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    await downloadViaS3(accessKeyId, secretAccessKey);
    return;
  }

  const token = process.env.CF_API_TOKEN;
  if (!token) {
    throw new Error(
      'Missing credentials. Provide either AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY for R2 S3 API, or CF_API_TOKEN for the legacy Cloudflare admin API path.'
    );
  }
  let cursor = '';
  let total = 0;
  let pages = 0;

  while (true) {
    const q = new URLSearchParams({ prefix, per_page: '1000' });
    if (cursor) q.set('cursor', cursor);

    const listUrl = base + '/objects?' + q.toString();
    const data = await fetchJson(listUrl, token);
    if (!data.success) {
      throw new Error('List API failed: ' + JSON.stringify(data));
    }

    const items = data.result || [];
    pages += 1;

    for (const obj of items) {
      const key = obj.key;
      const localPath = path.join(outDir, ...key.split('/'));
      fs.mkdirSync(path.dirname(localPath), { recursive: true });

      const objectUrl = base + '/objects/' + encodeURI(key);
      const body = await fetchBuffer(objectUrl, token);
      fs.writeFileSync(localPath, body);
      total += 1;
    }

    console.log('page=' + pages + ' fetched=' + items.length + ' total=' + total);

    const info = data.result_info || {};
    if (!info.is_truncated || !info.cursor) {
      break;
    }
    cursor = info.cursor;
  }

  console.log('DONE total=' + total + ' pages=' + pages + ' mode=admin-api');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
