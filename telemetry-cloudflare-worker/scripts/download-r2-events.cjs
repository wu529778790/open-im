const fs = require('fs');
const path = require('path');

const account = 'cba670300f355a7e3ea08597133716fd';
const bucket = 'open-im-telemetry';
const prefix = 'events/';
const base = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/r2/buckets/' + bucket;
const outDir = path.join('logs', 'r2-events');

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

async function main() {
  const token = process.env.CF_API_TOKEN;
  if (!token) {
    throw new Error('Missing CF_API_TOKEN env var');
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

  console.log('DONE total=' + total + ' pages=' + pages);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
