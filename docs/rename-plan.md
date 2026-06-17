# open-im -> coderelay 改名迁移方案

## 背景

- `open-im` 名字太通用，搜索困难，辨识度低
- 同类竞品 `cc-connect`（Go，12.5k stars）已占据 "CC" 概念
- 我们的差异化是多后端（不只 CC），需要一个能体现这一点的名字
- `coderelay`：code + relay（中继），好记好拼，不绑定任何 AI 品牌

## 调研结果

| 名称 | npm | GitHub 冲突 |
|---|---|---|
| `open-im` | 已占用（我们） | OpenIM 开源项目（488 stars） |
| `open-connect` | 空闲 | 无直接冲突，但 "open-" 前缀太泛 |
| `code-connect` | 空闲 | Figma 同名项目（1.5k stars） |
| `cc-connect` | 已占用 | chenhg5 的 Go 项目（12.5k stars） |
| **`coderelay`** | **空闲** | ddevalco/CodeRelay（67 stars，不构成冲突） |

## 迁移策略：双包并行

### 时间线

```
第 1 周    发布 coderelay@1.8.1-beta.7（同步当前版本）
           @wu529778790/open-im 继续发同版本

第 2-4 周  两个包同步发版，旧包加 deprecation 提示

第 2-3 月  保持同步，观察迁移情况

第 3-6 月  旧包停止功能更新，只修安全漏洞

第 6 月后  旧包彻底冻结
```

### 具体步骤

#### 1. 准备新包

- [ ] 在 npm 注册 `coderelay`（无 scope）
- [ ] `package.json` 改 name 为 `coderelay`
- [ ] CLI 命令改为 `coderelay`（保留 `open-im` 别名兼容）
- [ ] 配置路径改为 `~/.coderelay/`（兼容读取 `~/.open-im/`）
- [ ] 更新 README、logo 等品牌素材

#### 2. 双包发版

新包 `coderelay`：
```bash
# 改名后发布
npm publish --access public
```

旧包 `@wu529778790/open-im`：
```bash
# 继续发同版本，加 deprecation
npm deprecate @wu529778790/open-im "已更名为 coderelay，请迁移：npm install -g coderelay"
```

#### 3. 配置兼容

```typescript
// 同时读取两个路径
const configPaths = [
  join(homedir(), '.coderelay', 'config.json'),  // 新
  join(homedir(), '.open-im', 'config.json'),     // 旧（兼容）
];

// 写入时只写新路径
const writePath = join(homedir(), '.coderelay', 'config.json');
```

#### 4. CLI 兼容

```json
{
  "bin": {
    "coderelay": "dist/cli.js",
    "open-im": "dist/cli.js"
  }
}
```

过渡期内两个命令都能用，最终移除 `open-im` 别名。

#### 5. GitHub 仓库

方案 A（推荐）：重命名仓库
- `wu529778790/open-im` -> `wu529778790/coderelay`
- GitHub 自动 redirect 旧 URL
- 无需新建 repo

方案 B：新建仓库
- 保留旧 repo，新建 `wu529778790/coderelay`
- 旧 repo 加 README 指向新地址

## 用户迁移指南

### 终端用户

```bash
# 1. 卸载旧版
npm uninstall -g @wu529778790/open-im

# 2. 安装新版
npm install -g coderelay

# 3. 配置自动迁移（首次启动时自动复制 ~/.open-im/config.json -> ~/.coderelay/config.json）
coderelay start
```

### Docker / CI 用户

```dockerfile
# 旧
RUN npm install -g @wu529778790/open-im

# 新
RUN npm install -g coderelay
```

### API / 模块引用

```typescript
// 旧
import { ... } from '@wu529778790/open-im';

// 新
import { ... } from 'coderelay';
```

## 风险评估

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 现有用户流失 | 低 | 双包并行 + deprecation 提示 |
| npm 注册失败 | 低 | 已确认 `coderelay` 空闲 |
| 配置丢失 | 低 | 自动读取旧路径 |
| SEO / 搜索排名 | 中 | README 加 "formerly open-im" |
| GitHub redirect 失效 | 低 | GitHub 保留 redirect 很长时间 |

## 待确认

- [ ] 是否需要保留 `@wu529778790/coderelay` 作为 scope 包？（建议不需要，直接用 `coderelay`）
- [ ] GitHub 仓库是重命名还是新建？
- [ ] logo / 品牌设计是否需要更新？
- [ ] 是否需要注册 `coderelay.com` 域名？
