/**
 * GitHub Promoter - 主入口
 *
 * 用法：
 *   npm run collect   — 采集邮箱
 *   npm run send      — 发送推广邮件
 */

import { collectEmails } from './collect.js';
import { sendEmails } from './send.js';

const command = process.argv[2];

async function main() {
  switch (command) {
    case 'collect':
      await collectEmails();
      break;
    case 'send':
      await sendEmails({
        host: 'smtp.qq.com',
        port: 465,
        secure: true,
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        },
      }, { limit: 100 });
      break;
    default:
      console.log(`
GitHub Promoter - open-im 推广工具

用法:
  npm run collect   — 采集 GitHub 用户邮箱
  npm run send      — 发送推广邮件

环境变量:
  GITHUB_TOKEN     — GitHub Personal Access Token
  SMTP_USER        — 邮箱账号
  SMTP_PASS        — 邮箱密码/授权码
      `);
  }
}

main().catch(console.error);
