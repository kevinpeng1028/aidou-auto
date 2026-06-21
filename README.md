# 爱豆加油站微信公众号自动化后台

这是 Node.js + Express 后台，用于公众号内容 dry-run 生产：选题、文章生成、图片素材管理、风险审核、素材包导出和微信公众号草稿创建。当前版本不自动发布，不调用群发接口。

## 功能

- 后台登录：用户名和密码来自本地环境变量。
- Dashboard：显示系统状态、`AUTO_PUBLISH`、今日任务和任务日志。
- 今日素材：手动触发最近 24 小时选题搜索、评分、去重、文章生成和素材入库。
- 文章库：新增、查看、编辑、删除、重新审核、导出 ZIP，并按 ready/review/rejected/skipped/archived 筛选素材。
- 选题池：输入关键词后生成候选选题。
- 文章生成：根据关键词生成粉丝向公众号文章，并做质量校验。
- 图片管理：记录图片 URL、来源说明、授权状态、风险等级、使用场景，并可下载压缩到 `storage/images`。
- 微信草稿：在文章详情页手动创建微信公众号草稿箱内容，不自动发布。
- SQLite：数据库默认位于 `storage/app.sqlite`。

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

搜索服务第一版通过 `src/services/searchProvider.js` 抽象。未配置 `SEARCH_PROVIDER` 时，Dashboard 点击“生成今日素材”会提示“搜索服务未配置”。本地测试可设置：

```bash
SEARCH_PROVIDER=mock
SEARCH_REGION=KR
SEARCH_LANGUAGE=zh-CN
```

后续可在 `searchProvider.js` 中接入 Tavily、SerpAPI、Bing Search API、Google CSE 或其他搜索服务，统一输出最近 24 小时候选选题、来源、热度信号和图片候选。

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

- `articles`：文章标题、关键词、Markdown、状态、风险分、风险报告、素材评分 JSON、来源、人物和组合。
- `topics`：关键词、候选标题、选题角度、状态。
- `images`：图片 URL、来源说明、授权状态、风险等级、使用场景、本地路径。
- `task_logs`：定时任务、生成任务、导出任务和每日素材流水线记录。

## 素材状态

- `ready`：可发布素材，综合评分 90+ 且满足图片、风险、新鲜度和去重门槛。
- `review`：人工审核素材，80-89 或存在轻微不确定。
- `rejected`：不合格。
- `skipped`：因图片、重复、过期、风险等原因跳过。
- `archived`：归档。

## 发布边界

当前版本只做本地 dry-run 和手动草稿创建：不自动发布微信公众号、不调用群发接口、不调用 freepublish。最终发布必须由人工检查后，在微信公众号后台手动完成。
