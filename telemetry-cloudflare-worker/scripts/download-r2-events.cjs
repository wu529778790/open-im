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
const eventsDir = path.join(outDir, 'events');

fs.mkdirSync(outDir, { recursive: true });

// --- Helpers ---

async function fetchJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
  return res.json();
}

async function fetchBuffer(url, token) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
  return Buffer.from(await res.arrayBuffer());
}

async function readBody(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === 'function') return Buffer.from(await body.transformToByteArray());
  if (typeof body.arrayBuffer === 'function') return Buffer.from(await body.arrayBuffer());
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function nextDay(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function getLocalDates() {
  if (!fs.existsSync(eventsDir)) return [];
  return fs.readdirSync(eventsDir)
    .filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n) && fs.statSync(path.join(eventsDir, n)).isDirectory())
    .sort();
}

// --- S3 mode ---

async function listS3DatePrefixes(client) {
  const dates = [];
  let continuationToken = undefined;
  while (true) {
    const data = await client.send(new (await import('@aws-sdk/client-s3')).ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, Delimiter: '/',
      ContinuationToken: continuationToken, MaxKeys: 1000,
    }));
    for (const p of (data.CommonPrefixes || [])) {
      const d = p.Prefix.replace(prefix, '').replace('/', '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.push(d);
    }
    if (!data.IsTruncated || !data.NextContinuationToken) break;
    continuationToken = data.NextContinuationToken;
  }
  return dates.sort();
}

async function downloadS3Date(client, date) {
  const datePrefix = prefix + date + '/';
  let continuationToken = undefined;
  let count = 0;

  while (true) {
    const { ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const data = await client.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: datePrefix,
      ContinuationToken: continuationToken, MaxKeys: 1000,
    }));

    for (const obj of (data.Contents || [])) {
      if (!obj.Key || obj.Key.endsWith('/')) continue;
      const localPath = path.join(outDir, ...obj.Key.split('/'));
      fs.mkdirSync(path.dirname(localPath), { recursive: true });

      const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }));
      fs.writeFileSync(localPath, await readBody(resp.Body));
      count++;
      process.stdout.write('  ' + date + ': ' + count + ' / ~' + ((data.Contents || []).filter(o => o.Key && !o.Key.endsWith('/')).length) + '\r');
    }

    if (!data.IsTruncated || !data.NextContinuationToken) break;
    continuationToken = data.NextContinuationToken;
  }
  process.stdout.write('\n');
  return count;
}

async function downloadViaS3(accessKeyId, secretAccessKey) {
  const { S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto', endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  // 1. Discover R2 dates and local dates
  console.log('Scanning R2 dates...');
  const r2Dates = await listS3DatePrefixes(client);
  const localDates = getLocalDates();
  const localSet = new Set(localDates);

  if (r2Dates.length === 0) {
    console.log('No data found in R2.');
    return;
  }

  // 2. Find the latest complete local date
  let startDate = null;
  if (localDates.length > 0) {
    const latest = localDates[localDates.length - 1];
    const localCount = fs.readdirSync(path.join(eventsDir, latest)).length;
    // Check R2 count for that date
    let r2Count = 0;
    let contToken = undefined;
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    do {
      const data = await client.send(new ListObjectsV2Command({
        Bucket: bucket, Prefix: prefix + latest + '/',
        ContinuationToken: contToken, MaxKeys: 1000,
      }));
      r2Count += (data.Contents || []).filter(o => o.Key && !o.Key.endsWith('/')).length;
      contToken = data.IsTruncated ? data.NextContinuationToken : undefined;
    } while (contToken);

    if (localCount >= r2Count && r2Count > 0) {
      startDate = nextDay(latest);
      console.log('Local up to ' + latest + ' (' + localCount + ' files) is complete.');
    } else {
      startDate = latest;
      console.log('Local latest ' + latest + ' incomplete (' + localCount + '/' + r2Count + '), will re-download.');
      // Clear incomplete date so we re-download it fresh
      const dir = path.join(eventsDir, latest);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // 3. Determine dates to download
  const toDownload = r2Dates.filter(d => !startDate || d >= startDate);
  if (toDownload.length === 0) {
    console.log('All dates already downloaded. Nothing to do.');
    return;
  }

  console.log('Dates to download: ' + toDownload[0] + ' ~ ' + toDownload[toDownload.length - 1] + ' (' + toDownload.length + ' days)');

  // 4. Download each date
  let total = 0;
  for (const date of toDownload) {
    const count = await downloadS3Date(client, date);
    total += count;
    console.log('  ' + date + ': ' + count + ' files');
  }

  console.log('DONE downloaded=' + total + ' days=' + toDownload.length + ' mode=s3');
}

// --- Admin API mode ---

async function listAdminApiDates(token) {
  const dates = new Set();
  let cursor = '';
  while (true) {
    const q = new URLSearchParams({ prefix, per_page: '1000', delimiter: '/' });
    if (cursor) q.set('cursor', cursor);
    const data = await fetchJson(base + '/objects?' + q.toString(), token);
    if (!data.success) throw new Error('List API failed: ' + JSON.stringify(data));
    for (const obj of (data.result || [])) {
      // Delimited results may include directory markers
      if (obj.key) {
        const m = obj.key.match(/^events\/(\d{4}-\d{2}-\d{2})\//);
        if (m) dates.add(m[1]);
      }
    }
    const info = data.result_info || {};
    if (!info.is_truncated || !info.cursor) break;
    cursor = info.cursor;
  }
  return [...dates].sort();
}

async function downloadAdminApiDate(token, date) {
  const datePrefix = prefix + date + '/';
  let cursor = '';
  let count = 0;

  while (true) {
    const q = new URLSearchParams({ prefix: datePrefix, per_page: '1000' });
    if (cursor) q.set('cursor', cursor);
    const data = await fetchJson(base + '/objects?' + q.toString(), token);
    if (!data.success) throw new Error('List API failed: ' + JSON.stringify(data));

    for (const obj of (data.result || [])) {
      const localPath = path.join(outDir, ...obj.key.split('/'));
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, await fetchBuffer(base + '/objects/' + encodeURI(obj.key), token));
      count++;
      process.stdout.write('  ' + date + ': ' + count + '\r');
    }

    const info = data.result_info || {};
    if (!info.is_truncated || !info.cursor) break;
    cursor = info.cursor;
  }
  process.stdout.write('\n');
  return count;
}

async function downloadViaAdminApi(token) {
  console.log('Scanning R2 dates...');
  const r2Dates = await listAdminApiDates(token);
  const localDates = getLocalDates();

  if (r2Dates.length === 0) {
    console.log('No data found in R2.');
    return;
  }

  let startDate = null;
  if (localDates.length > 0) {
    const latest = localDates[localDates.length - 1];
    const localCount = fs.readdirSync(path.join(eventsDir, latest)).length;
    // Admin API: count files for that date
    let r2Count = 0;
    let cursor = '';
    do {
      const q = new URLSearchParams({ prefix: prefix + latest + '/', per_page: '1000' });
      if (cursor) q.set('cursor', cursor);
      const data = await fetchJson(base + '/objects?' + q.toString(), token);
      if (!data.success) break;
      r2Count += (data.result || []).length;
      const info = data.result_info || {};
      cursor = (info.is_truncated && info.cursor) ? info.cursor : '';
    } while (cursor);

    if (localCount >= r2Count && r2Count > 0) {
      startDate = nextDay(latest);
      console.log('Local up to ' + latest + ' (' + localCount + ' files) is complete.');
    } else {
      startDate = latest;
      console.log('Local latest ' + latest + ' incomplete (' + localCount + '/' + r2Count + '), will re-download.');
      fs.rmSync(path.join(eventsDir, latest), { recursive: true, force: true });
    }
  }

  const toDownload = r2Dates.filter(d => !startDate || d >= startDate);
  if (toDownload.length === 0) {
    console.log('All dates already downloaded. Nothing to do.');
    return;
  }

  console.log('Dates to download: ' + toDownload[0] + ' ~ ' + toDownload[toDownload.length - 1] + ' (' + toDownload.length + ' days)');

  let total = 0;
  for (const date of toDownload) {
    const count = await downloadAdminApiDate(token, date);
    total += count;
    console.log('  ' + date + ': ' + count + ' files');
  }

  console.log('DONE downloaded=' + total + ' days=' + toDownload.length + ' mode=admin-api');
}

// --- Main ---

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
  await downloadViaAdminApi(token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
