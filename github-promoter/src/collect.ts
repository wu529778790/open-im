/**
 * GitHub 用户邮箱采集器
 *
 * 从 GitHub 仓库的 stargazers 中收集公开邮箱
 * 合法性：只收集用户在 Git 提交中公开使用的邮箱
 */

import { Octokit } from '@octokit/rest';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = './data';
const EMAILS_FILE = join(DATA_DIR, 'emails.csv');
const PROGRESS_FILE = join(DATA_DIR, 'progress.json');

interface GitHubEmail {
  email: string;
  username: string;
  name: string;
  source: string;
}

// 要搜索的仓库列表（与 open-im 相关的项目）
const TARGET_REPOS = [
  'anthropics/claude-code',
  'anthropics/claude-code-wechat-channel',
  'nicepkg/gpt-runner',
  'chatanywhere/GPT_API_free',
  'labring/FastGPT',
  'lobehub/lobe-chat',
  'chatgpt-web/chatgpt-web',
  'yokingma/searchgpt',
];

export async function collectEmails() {
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  const allEmails: Map<string, GitHubEmail> = new Map();
  let processedUsers = 0;

  console.log('🚀 开始采集 GitHub 用户邮箱...\n');

  for (const repo of TARGET_REPOS) {
    console.log(`📦 扫描仓库: ${repo}`);

    try {
      // 获取 stargazers
      const stargazers = await octokit.repos.listStargazers({
        owner: repo.split('/')[0],
        repo: repo.split('/')[1],
        per_page: 100,
      });

      console.log(`   找到 ${stargazers.data.length} 个 stargazer`);

      for (const user of stargazers.data) {
        processedUsers++;
        if (processedUsers % 10 === 0) {
          console.log(`   已处理 ${processedUsers} 个用户...`);
        }

        // 获取用户的公开邮箱
        const email = await getUserEmail(octokit, user.login);
        if (email) {
          allEmails.set(email, {
            email,
            username: user.login,
            name: user.name || user.login,
            source: `starred:${repo}`,
          });
        }
      }
    } catch (error) {
      console.error(`   ❌ 扫描 ${repo} 失败:`, error);
    }
  }

  // 保存结果
  saveEmails(Array.from(allEmails.values()));
  console.log(`\n✅ 采集完成: ${allEmails.size} 个邮箱`);
}

async function getUserEmail(octokit: Octokit, username: string): Promise<string | null> {
  try {
    // 方法 1：通过用户公开事件获取邮箱
    const events = await octokit.activity.listPublicEventsForUser({
      username,
      per_page: 5,
    });

    for (const event of events.data) {
      if (event.type === 'PushEvent' && event.payload?.commits) {
        for (const commit of event.payload.commits) {
          const author = commit.author;
          if (author?.email && !author.email.includes('noreply')) {
            return author.email;
          }
        }
      }
    }

    // 方法 2：检查用户公开邮箱
    const user = await octokit.users.getByUsername({ username });
    if (user.data.email && !user.data.email.includes('noreply')) {
      return user.data.email;
    }

    return null;
  } catch {
    return null;
  }
}

function saveEmails(emails: GitHubEmail[]) {
  const dir = dirname(EMAILS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const csv = ['email,username,name,source'];
  for (const e of emails) {
    csv.push(`"${e.email}","${e.username}","${e.name}","${e.source}"`);
  }
  writeFileSync(EMAILS_FILE, csv.join('\n'));
  console.log(`💾 邮箱已保存到 ${EMAILS_FILE}`);
}

function dirname(path: string) {
  return path.substring(0, path.lastIndexOf('/'));
}
