# OpenLoci

[English](README.md) · [简体中文](README.zh-CN.md)

OpenLoci 是一个开源个人记忆系统，记录日历、日记、饮食、运动、支出、旅行计划，以及明确的个人偏好。原始记录保存在用户自己的 Markdown 文件中，通过 HTML 页面阅读，并由数据库支持高效查询，让未来的 AI 助手能够依据真实记录给出更有用的建议。

## 项目目标

- 用户拥有自己的数据，离开应用或更换模型后仍能读取 Markdown。
- 通过手动记录、直接编辑文件和多个 MCP 服务降低记录成本。
- 结合时间、记录类型、全文搜索和未来的语义检索，为助手提供精简、有出处的上下文。
- 区分真实记录、计划、估算和模型推断，保留来源与修改历史。
- 默认本地运行，用户决定哪些数据可被助手读取、导出或传给外部服务。

## 启动第一个版本

需要 Node.js 24 或更新版本。

```sh
npm ci
cp .env.example .env
npm run cli -- init
npm run dev
```

浏览器打开 `http://127.0.0.1:4310`。默认数据目录为 `~/.local/share/openloci/vault`，可以在 `.env` 中通过 `OPENLOCI_VAULT` 指定其他目录。

v0.1 提供记录创建、时间线、按日期和类型筛选、全文搜索，以及 Markdown 详情页。结构化属性暂时通过 JSON 输入；支出记录需要整数 `amount_minor` 和三位大写货币代码 `currency`。

每个页面顶部均可切换 **English、简体中文、日本語、Español**。首次访问会根据浏览器语言选择界面；手动选择会保存在本地 Cookie 中。切换时保留搜索条件，日记原文不会被翻译或改写。也可以通过 `?lang=zh-CN`、`?lang=ja`、`?lang=es` 直接打开对应语言。

点击侧栏 **+ 更多**，输入标题、描述，选择 **笔记 / 清单 / 表格** 即可创建自定义页面。页面保存在 `pages/<id>.md`，条目仍是普通 Markdown 记录，通过 `page_id` 关联。清单勾选状态会保存，并检查修订版本以避免覆盖其他修改。

编译运行使用 `npm run build` 和 `npm start`。检查与测试使用 `npm run check` 和 `npm test`。PostgreSQL 集成测试需要额外设置 `TEST_DATABASE_URL`，并应指向专门用于测试的空数据库。

## 本地数据库与 PostgreSQL

默认使用 SQLite，支持全文搜索、日期和类型索引，并保存包含正文与结构化元数据的完整查询副本。Markdown 仍是原始数据，数据库可以通过文件重建。

在 `.env` 中设置 `DATABASE_URL` 即可切换 PostgreSQL。将本地 SQLite 数据迁移到空的云端 PostgreSQL 数据库：

```sh
# 先停止应用写入；SQLite 源数据库不要设置 DATABASE_URL。
export TARGET_DATABASE_URL='postgresql://user:password@host:5432/openloci'
npm run cli -- db:transfer
npm run cli -- db:transfer --apply
# 验证完成后，在 .env 中设置 DATABASE_URL 并重新启动。
```

迁移先预览，再在 PostgreSQL 事务中复制并逐条验证记录；不会修改源数据库。请按云服务要求配置 TLS。迁移数据库不会自动上传 Markdown 或附件；远程应用仍需要能访问同一份文件。详见 [数据库运维](docs/database.md)。

## 连接 Notion 和 Google Calendar

HTML 侧栏提供 **从 Notion 导入** 和 **从 Google 日历导入**。选择日期范围，按需完成浏览器授权，预览并勾选记录后保存，无需命令行。Google 日历按钮使用 Notion 中已关联的 Google 账户；尚未关联时会提示前往 **Notion → 设置 → 账户 → 邮件与日历** 完成连接。

Notion 预览按创建日期检索，自动排除只包含子页面链接的目录页。较早创建、最近修改的笔记可能不会出现；返回条数达到上限、读取失败或内容截断时会显示提示。预览在 30 分钟后或服务重启后失效。重复导入会去重，冲突时保留本地修改。

如需使用命令行或独立的社区日历 MCP 服务：

```sh
npm run cli -- mcp:init
npm run cli -- mcp:status
npm run cli -- mcp:connect notion
# 在 .env 中将 GOOGLE_OAUTH_CREDENTIALS 设置为 Google OAuth JSON 文件路径。
npm run cli -- mcp:connect google-calendar
```

Notion 通过 OAuth 桥接连接官方托管 MCP 服务。Google Calendar 使用社区维护的 `@cocal/google-calendar-mcp`，需要启用 Calendar API 的 Google Cloud 项目和桌面应用 OAuth 凭据。两者均需用户授权；安装程序并不代表已连接个人账户。

导入默认仅预览，只有显式指定 `apply: true` 才会保存到本地。OpenLoci 不会通过这些导入操作修改外部页面或日历。详见 [连接与导入指南](docs/integrations.md)。

Google 官方远程 MCP 服务另有可选配置命令：`npm run cli -- mcp:google /absolute/path/to/web-client.json`。也可把 Google 账户关联到 Notion，通过已授权的 Notion MCP 读取日历。详见 [Google 官方服务与 Notion 日历路径](docs/integrations.md#official-google-calendar-mcp)。

OpenLoci 自身也提供只读 stdio MCP 服务，可用 `npm run mcp` 启动，向助手暴露 `memory_search`、`memory_get` 和按字节限制的 `memory_context`。默认排除 `restricted` 记录。只有明确设置 `OPENLOCI_MCP_WRITE=1` 才启用创建记录工具。

## 架构文档

- [架构与基础框架](docs/architecture.md)
- [记录格式与记忆模型](docs/data-model.md)
- [MCP 架构](docs/mcp.md)
- [数据库运维与云迁移](docs/database.md)
- [连接与导入指南](docs/integrations.md)
- [开发路线图](docs/roadmap.md)
- [饮食记录示例](examples/vault/records/meal/2026/10/meal-example.md)

## 当前边界

v0.1 是单用户本地原型，已实现 Markdown 存储、SQLite/PostgreSQL 查询、HTTP API、CLI、HTML 页面、文件变更重建，以及 Notion/Google Calendar 的显式 MCP 导入。Notion 内容保留 MCP 返回的页面表示，并不承诺无损还原所有原生区块。

日历网格、完整的领域编辑器、多租户隔离、云端用户认证、语义检索、AI 建议、定时同步与双向同步仍在规划中。每个数据目录应只运行一个写入进程；本地页面没有账户登录系统。PostgreSQL 适配为未来商业部署提供基础，目前不应视作成熟的多租户云服务。

发布开源代码前仍需选择并添加许可证。
