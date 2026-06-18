/**
 * 邮件发送器
 *
 * 批量发送推广邮件，带反垃圾邮件机制
 */

import nodemailer from 'nodemailer';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = './data';
const EMAILS_FILE = join(DATA_DIR, 'emails.csv');
const PROGRESS_FILE = join(DATA_DIR, 'progress.json');

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}

interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

// 邮件模板（Spintax 格式支持随机内容）
const TEMPLATES: EmailTemplate[] = [
  {
    subject: '🚀 发现一个超强的 AI 编程助手',
    text: `Hi {name},

我是 open-im 的开发者。

open-im 是一个开源工具，可以把 Claude Code 接入微信、Telegram 等 IM 平台。手机发条消息，电脑上就写好代码。

GitHub: https://github.com/wu529778790/open-im

如果你也在用 AI 编程工具，欢迎试试。有问题可以提 Issue。

Best,
open-im`,
    html: '',
  },
  {
    subject: '🔧 Claude Code + 微信 = ？',
    text: `Hi {name},

open-im 让你通过微信直接使用 Claude Code。

特点：
- 手机发消息，电脑写代码
- 支持 7 个 IM 平台
- 支持 Claude / Codex / CodeBuddy

GitHub: https://github.com/wu529778790/open-im

有问题欢迎交流。

Best,
open-im`,
    html: '',
  },
];

export async function sendEmails(config: EmailConfig, options?: { limit?: number }) {
  if (!existsSync(EMAILS_FILE)) {
    console.error('❌ 邮箱文件不存在，请先运行 npm run collect');
    return;
  }

  const csv = readFileSync(EMAILS_FILE, 'utf-8');
  const lines = csv.split('\n').slice(1); // 跳过标题行
  const emails = lines.map(line => {
    const [email, username, name] = line.split(',');
    return { email: email?.replace(/"/g, ''), username: username?.replace(/"/g, ''), name: name?.replace(/"/g, '') };
  }).filter(e => e.email);

  console.log(`📧 找到 ${emails.length} 个邮箱`);

  // 加载进度
  const progress = loadProgress();
  let sent = progress.sent || 0;

  const transporter = nodemailer.createTransport(config);

  for (let i = sent; i < emails.length; i++) {
    const { email, name } = emails[i];

    // 随机延迟（180-420 秒）
    const delay = 180000 + Math.random() * 240000;
    console.log(`⏳ 等待 ${Math.round(delay / 1000)} 秒后发送...`);
    await new Promise(resolve => setTimeout(resolve, delay));

    // 随机选择模板
    const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
    const text = template.text.replace('{name}', name || '开发者');

    try {
      await transporter.sendMail({
        from: config.auth.user,
        to: email,
        subject: template.subject,
        text: text,
      });

      console.log(`✅ 已发送: ${email}`);
      sent++;

      // 保存进度
      saveProgress({ sent, total: emails.length });

      // 每 10 封检查配额
      if (sent % 10 === 0) {
        console.log(`📊 进度: ${sent}/${emails.length}`);
      }
    } catch (error) {
      console.error(`❌ 发送失败 ${email}:`, error);

      // 如果是配额限制，暂停 12 小时
      if (error instanceof Error && error.message.includes('quota')) {
        console.log('⏸️ 配额限制，暂停 12 小时...');
        await new Promise(resolve => setTimeout(resolve, 12 * 60 * 60 * 1000));
      }
    }
  }

  console.log(`\n✅ 完成: 已发送 ${sent}/${emails.length} 封邮件`);
}

function loadProgress(): { sent: number; total: number } {
  if (!existsSync(PROGRESS_FILE)) return { sent: 0, total: 0 };
  return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
}

function saveProgress(progress: { sent: number; total: number }) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}
