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

## Local health report (open-im repo)

After pulling R2 logs to `telemetry-cloudflare-worker/logs/r2-events/events`, run:

```bash
npm run telemetry:report
npm run telemetry:report -- --json
```

The report includes daily counts (`start/end/miss`) and upload health counters (`drop4/retry/net`) with a final diagnosis section.
If any `ALERT` is detected, the script exits with code `1` (useful for CI/cron monitoring).

## 本地下载 R2 日志

如果你已经在 Cloudflare R2 页面创建了 **S3 客户端凭据**，推荐直接使用现有 Node 脚本下载日志，不再走 Cloudflare 管理 API。

### 1. 在仓库根目录写入 `.env`

脚本会自动按顺序读取以下文件中的环境变量：

- 当前工作目录下的 `.env`
- `telemetry-cloudflare-worker/.env`
- 仓库根目录 `.env`

建议直接在仓库根目录创建 `.env`：

```bash
AWS_ACCESS_KEY_ID=你的访问密钥ID
AWS_SECRET_ACCESS_KEY=你的机密访问密钥
AWS_ENDPOINT_URL=https://cba670300f355a7e3ea08597133716fd.r2.cloudflarestorage.com
CF_ACCOUNT_ID=cba670300f355a7e3ea08597133716fd
CF_R2_BUCKET=open-im-telemetry
CF_R2_PREFIX=events/
```

说明：

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`：使用你在 R2 Token 页面创建的 S3 客户端凭据
- `AWS_ENDPOINT_URL`：账户级 R2 S3 终结点
- `CF_R2_BUCKET`：默认是 `open-im-telemetry`
- `CF_R2_PREFIX`：默认只拉 `events/` 目录

### 2. 执行下载脚本

在仓库根目录执行：

```bash
node telemetry-cloudflare-worker/scripts/download-r2-events.cjs
```

成功后会看到类似输出：

```bash
page=1 fetched=1000 total=1000
...
DONE total=xxxx pages=xx mode=s3
```

默认下载目录：

```bash
logs/r2-events/events
```

### 3. 生成健康报告

下载完成后，在仓库根目录执行：

```bash
node scripts/telemetry-health-report.mjs logs/r2-events/events
```

如果想输出 JSON：

```bash
node scripts/telemetry-health-report.mjs logs/r2-events/events --json
```

### 4. 常见问题

- `Authentication error`
  通常是凭据类型和调用方式不匹配。这里需要的是 **R2 S3 凭据**，不是 `cfat_` 开头的 Cloudflare Account API Token。

- `Missing credentials`
  说明脚本没有读到 `.env` 中的 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`，或者你当前 shell 没有导出这些变量。

- 下载很慢
  当前脚本会逐个对象落盘，适合本地排查和分析。如果后续对象更多，可以再增加“只拉最近 N 天”模式。
