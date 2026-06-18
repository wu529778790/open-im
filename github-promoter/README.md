# GitHub Promoter

open-im 推广工具 — 从 GitHub 采集用户邮箱，发送推广邮件。

## 功能

- **邮箱采集**：从 GitHub stargazers 的公开 commit 中提取邮箱
- **批量发送**：支持多发件人并发，随机内容（Spintax）
- **反垃圾**：随机延迟（180-420 秒），模拟人类行为
- **进度持久化**：支持中断恢复，避免重复发送
- **配额管理**：每日自动重置，速率限制时自动暂停

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 设置环境变量
export GITHUB_TOKEN="your_github_token"
export SMTP_USER="your_email@qq.com"
export SMTP_PASS="your_smtp_password"

# 3. 采集邮箱
npm run collect

# 4. 发送邮件
npm run send
```

## 环境变量

| 变量 | 说明 | 必需 |
|------|------|------|
| `GITHUB_TOKEN` | GitHub Personal Access Token | ✅ |
| `SMTP_USER` | 发件邮箱（如 QQ 邮箱） | ✅ |
| `SMTP_PASS` | 邮箱密码或授权码 | ✅ |

## 合法性

- 只采集**公开邮箱**（Git commit 中的）
- 邮件内容与开源项目相关
- 遵守 CAN-SPAM、GDPR 等法规
- 用户可随时退订

## 文件结构

```
github-promoter/
├── src/
│   ├── index.ts      # 主入口
│   ├── collect.ts    # 邮箱采集
│   └── send.ts       # 邮件发送
├── data/             # 数据目录（自动生成）
│   ├── emails.csv    # 采集的邮箱
│   └── progress.json # 发送进度
└── package.json
```
