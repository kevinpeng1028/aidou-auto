# 爱豆加油站微信公众号自动化后台

这是第一版 Node.js + Express 后台，用于公众号内容 dry-run 生产：选题、文章生成、图片素材管理、风险审核和素材包导出。当前版本不接微信公众号发布接口，不自动发布，不调用群发接口。

## 功能

- 后台登录：用户名和密码来自本地环境变量。
- Dashboard：显示系统状态、`AUTO_PUBLISH`、今日任务和任务日志。
- 文章库：新增、查看、编辑、删除、重新审核、导出 ZIP。
- 选题池：输入关键词后生成候选选题。
- 文章生成：根据关键词生成 300-400 字粉丝向公众号文章。
- 图片管理：记录图片 URL、来源说明、授权状态、风险等级、使用场景，并可下载压缩到 `storage/images`。
- 素材包导出：导出 `article.md`、`image_manifest.csv`、`risk_report.md` 和本地图片文件。
- SQLite：数据库默认位于 `storage/app.sqlite`。
- 定时任务：每天 09:00 记录 dry-run 状态，不发布内容。

## Ubuntu 22.04 安装

建议使用 Node.js 20 LTS。当前依赖包含 `better-sqlite3` 和 `sharp`，请不要使用 Node.js 24 部署：

```bash
sudo apt update
sudo apt install -y build-essential python3 make g++ curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
npm install
```

## 环境变量

```bash
cp .env.example .env.idol
```

真实密钥只放在本地 `.env.idol`，不要提交到 Git。`.env.example` 只能保留占位符。

## 初始化和运行

```bash
npm run db:init
npm start
```

开发模式：

```bash
npm run dev
```

访问：`http://服务器IP:3000`

## 数据库 Schema

核心表位于 `src/db/schema.sql`：

- `articles`：文章标题、关键词、Markdown、状态、风险分、风险报告。
- `topics`：关键词、候选标题、选题角度、状态。
- `images`：图片 URL、来源说明、授权状态、风险等级、使用场景、本地路径。
- `task_logs`：定时任务、生成任务、导出任务的运行记录。

## 发布边界

当前版本只做本地 dry-run：不接入真实微信公众号接口、不创建真实草稿、不自动发布、不调用群发接口。最终发布必须由人工检查后，在微信公众号后台手动完成。
