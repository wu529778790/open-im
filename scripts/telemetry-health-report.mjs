import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const rootArg = args.find((a) => !a.startsWith('--'));
const root = rootArg || 'telemetry-cloudflare-worker/logs/r2-events/events';

function walkNdjson(dir, out = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkNdjson(p, out);
    else if (entry.isFile() && entry.name.endsWith('.ndjson')) out.push(p);
  }
  return out;
}

function dayFromPath(p) {
  const normalized = p.replace(/\\/g, '/');
  const m = normalized.match(/events\/(\d{4}-\d{2}-\d{2})\//);
  return m ? m[1] : 'unknown';
}

function initDay() {
  return {
    files: 0,
    lines: 0,
    badJson: 0,
    starts: 0,
    completes: 0,
    errors: 0,
    uploadStats: 0,
    postedLinesMax: 0,
    retryableFailuresMax: 0,
    dropped4xxLinesMax: 0,
    networkFailuresMax: 0,
  };
}

function main() {
  const files = walkNdjson(root);
  const perDay = new Map();

  for (const file of files) {
    const day = dayFromPath(file);
    if (!perDay.has(day)) perDay.set(day, initDay());
    const bucket = perDay.get(day);
    bucket.files += 1;
    const rows = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const row of rows) {
      bucket.lines += 1;
      let obj;
      try {
        obj = JSON.parse(row);
      } catch {
        bucket.badJson += 1;
        continue;
      }
      if (obj.event === 'ai.task.start') bucket.starts += 1;
      if (obj.event === 'ai.task.complete') bucket.completes += 1;
      if (obj.event === 'ai.task.error') bucket.errors += 1;
      if (obj.event === 'telemetry.upload.stats' && obj.data && typeof obj.data === 'object') {
        bucket.uploadStats += 1;
        const d = obj.data;
        if (typeof d.postedLines === 'number') bucket.postedLinesMax = Math.max(bucket.postedLinesMax, d.postedLines);
        if (typeof d.retryableFailures === 'number') {
          bucket.retryableFailuresMax = Math.max(bucket.retryableFailuresMax, d.retryableFailures);
        }
        if (typeof d.dropped4xxLines === 'number') {
          bucket.dropped4xxLinesMax = Math.max(bucket.dropped4xxLinesMax, d.dropped4xxLines);
        }
        if (typeof d.networkFailures === 'number') {
          bucket.networkFailuresMax = Math.max(bucket.networkFailuresMax, d.networkFailures);
        }
      }
    }
  }

  const days = [...perDay.keys()].sort();

  const alerts = [];
  const infos = [];
  const totalMissing = days.reduce((sum, day) => {
    const d = perDay.get(day);
    const terminal = d.completes + d.errors;
    return sum + Math.max(0, d.starts - terminal);
  }, 0);
  const badJsonDays = days.filter((day) => perDay.get(day).badJson > 0);
  const drop4Days = days.filter((day) => perDay.get(day).dropped4xxLinesMax > 0);
  const retryDays = days.filter((day) => perDay.get(day).retryableFailuresMax > 0);
  const netDays = days.filter((day) => perDay.get(day).networkFailuresMax > 0);
  const noUploadStatsDays = days.filter((day) => {
    const d = perDay.get(day);
    return d.lines > 0 && d.uploadStats === 0;
  });

  if (totalMissing > 0) {
    alerts.push(`发现未闭环任务事件: miss=${totalMissing}（建议核对进程异常退出/强制中断路径）`);
  }
  if (badJsonDays.length > 0) {
    alerts.push(`发现 JSON 损坏: ${badJsonDays.join(', ')}（建议检查写盘或中途截断）`);
  }
  if (drop4Days.length > 0) {
    alerts.push(`发现 4xx 丢弃: ${drop4Days.join(', ')}（建议检查 token、URL、负载格式）`);
  }
  if (retryDays.length > 0 || netDays.length > 0) {
    alerts.push(
      `发现上传重试/网络失败: retryDays=${retryDays.length}, netDays=${netDays.length}（建议检查网络与服务端稳定性）`
    );
  }
  if (noUploadStatsDays.length > 0) {
    infos.push(`这些日期没有 telemetry.upload.stats（通常是老版本数据）: ${noUploadStatsDays.join(', ')}`);
  }

  const dayRows = days.map((day) => {
    const d = perDay.get(day);
    const terminal = d.completes + d.errors;
    const missing = Math.max(0, d.starts - terminal);
    return {
      day,
      files: d.files,
      lines: d.lines,
      badJson: d.badJson,
      starts: d.starts,
      terminal,
      missing,
      uploadStats: d.uploadStats,
      postedLinesMax: d.postedLinesMax,
      retryableFailuresMax: d.retryableFailuresMax,
      dropped4xxLinesMax: d.dropped4xxLinesMax,
      networkFailuresMax: d.networkFailuresMax,
    };
  });

  const newest = files
    .map((f) => ({ f, t: statSync(f).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 5)
    .map((x) => x.f);

  if (jsonMode) {
    const payload = {
      root,
      summary: {
        days: days.length,
        files: files.length,
        totalMissing,
        alertCount: alerts.length,
        infoCount: infos.length,
      },
      days: dayRows,
      diagnosis: {
        alerts,
        infos,
      },
      newestFiles: newest,
      healthy: alerts.length === 0,
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Telemetry root: ${root}`);
    console.log(`Days: ${days.length} | Files: ${files.length}`);
    console.log('');
    console.log([
      'day'.padEnd(12),
      'files'.padStart(6),
      'lines'.padStart(6),
      'bad'.padStart(5),
      'start'.padStart(6),
      'end'.padStart(6),
      'miss'.padStart(6),
      'upst'.padStart(6),
      'postL'.padStart(7),
      'rtry'.padStart(6),
      'drop4'.padStart(6),
      'net'.padStart(5),
    ].join(' '));
    for (const row of dayRows) {
      console.log([
        row.day.padEnd(12),
        String(row.files).padStart(6),
        String(row.lines).padStart(6),
        String(row.badJson).padStart(5),
        String(row.starts).padStart(6),
        String(row.terminal).padStart(6),
        String(row.missing).padStart(6),
        String(row.uploadStats).padStart(6),
        String(row.postedLinesMax).padStart(7),
        String(row.retryableFailuresMax).padStart(6),
        String(row.dropped4xxLinesMax).padStart(6),
        String(row.networkFailuresMax).padStart(5),
      ].join(' '));
    }

    console.log('\nNewest 5 files:');
    for (const f of newest) console.log(`- ${f}`);

    console.log('\nDiagnosis:');
    if (alerts.length === 0) {
      console.log('- 未发现明显健康告警');
    } else {
      for (const alert of alerts) console.log(`- ALERT: ${alert}`);
    }
    for (const info of infos) console.log(`- INFO: ${info}`);
  }

  if (alerts.length > 0) {
    process.exitCode = 1;
  }
}

main();
