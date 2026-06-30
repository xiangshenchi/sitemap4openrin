# Sitemap for OpenRin
一个为 [OpenRin](https://github.com/openrin/rin) 博客系统设计的 Cloudflare Worker，用于自动生成符合标准的 sitemap.xml，助力 SEO 优化。

## ✨ 功能特性
- 🚀 **自动生成**：实时生成 sitemap.xml，无需手动维护
- ⚡ **KV 缓存**：支持 Cloudflare KV 缓存，提升响应速度
- 📊 **智能缓存失效**：基于文章数量、最后更新时间等多维度判断缓存是否过期
- 📝 **完整页面覆盖**：包含首页、固定页面、所有文章、所有标签页
- 🏷️ **标签页支持**：自动生成所有标签页的 sitemap 条目，URL 与 OpenRin 前端路由完全一致
- 🕐 **lastmod 支持**：所有页面均包含 `<lastmod>` 标签，准确反映页面更新时间
- 🔄 **多数据源**：分别从文章、动态、友链、标签表读取对应页面的最后更新时间
- 🤖 **robots.txt 托管**：内置 `/robots.txt` 处理，允许主流爬虫，禁止后台隐私路径，自动附加 Sitemap 指令
- ⚡ **IndexNow 推送**：可选通过 `INDEXNOW_KEY` 环境变量启用，自动提供 Key 验证文件 + 推送所有 URL 到 Bing 等搜索引擎

## 📋 页面清单
Sitemap 包含以下页面：

| 页面路径 | lastmod 数据来源 | 更新频率 | 优先级 |
|---------|----------------|---------|--------|
| `/` 首页 | feeds 表文章最后更新时间 | weekly | 1.0 |
| `/timeline` 时间线 | feeds 表文章最后更新时间 | weekly | 0.9 |
| `/hashtags` 标签列表页 | feeds 表文章最后更新时间 | weekly | 0.8 |
| `/moments` 动态 | moments 表动态最后更新时间 | weekly | 0.9 |
| `/friends` 友链 | friends 表友链最后更新时间 | weekly | 0.9 |
| `/feed/{id}` 或 `/{alias}` 文章 | 各文章自身的更新时间 | weekly | 0.9 |
| `/hashtag/{标签名}` 标签详情页 | 关联该标签的所有公开文章的最后更新时间 | weekly | 0.8 |

## 🚀 部署

### 前置要求
- Cloudflare 账号
- OpenRin 博客系统（使用 D1 数据库）
- （可选）Cloudflare KV 命名空间用于缓存

### 部署步骤

#### 方式一：Cloudflare Dashboard 面板部署

如果你不想配置本地开发环境，可以直接在 Cloudflare 网页端完成全部操作：

**1. 新建 Worker**

1. 登录 Cloudflare Dashboard，选择左侧菜单的 **Workers & Pages**
2. 点击 **Create application** → **Create Worker**
3. 命名为 `rin-sitemap-worker` 并点击 Deploy 按钮完成初始创建
4. 点击 **Edit code**，将 `rin-sitemap-worker.js` 中的完整代码覆盖原有的代码，点击右上角的 **Deploy** 部署

**2. 创建并绑定 KV 空间（实现缓存极速响应）**

1. 在网页左下侧菜单找到 **Storage & Databases** → **KV**
2. 点击 **Create a namespace**，命名为 `RIN_SITEMAP_CACHE`
3. 返回你刚刚创建的 `rin-sitemap-worker` 页面，进入 **Settings** 选项卡 → **Bindings** 菜单配置项
4. 点击 **Add** 添加一个 **KV Namespace** 绑定：
   - Variable name (变量名): `SITEMAP_KV`（**注意：必须叫这个名字代码才能识别**）
   - KV namespace: 选择你刚才创建的 `RIN_SITEMAP_CACHE`

**3. 绑定 Rin 的 D1 数据库**

1. 同样在 **Settings** → **Bindings** 菜单配置项中
2. 点击 **Add** 添加一个 **D1 database** 绑定：
   - Variable name (变量名): `DB`（**注意：必须全大写 `DB`，与 Rin 的官方规范保持一致**）
   - D1 database: 下拉选择你部署 openRin 时使用的那个主要数据库（通常名为 `rin`）

**4.（可选）配置指定域名**

如果你的 Worker 使用了多个域名或自带 workers.dev 域名，为了防止生成的 sitemap 源地址产生混乱，**强烈建议**在 **Settings** → **Variables and Secrets** 处添加一个环境变量：

   - Variable name: `SITE_URL`
   - Value: `https://blog.yourdomain.com`（填入你的真实博客主页地址即可）

**5. 接管 Sitemap 路由**

1. 依然在 Worker 页面，进入 **Settings** 选项卡 → **Domains & Routes**
2. 点击 **Add route**
3. 在 Route 一栏输入你希望生效的地址，例如：`blog.yourdomain.com/sitemap.xml`
4. Zone 挑选对应的根域名，点击 Submit 确认

**6.（推荐）接管 robots.txt 路由**

1. 同样在 **Settings** → **Domains & Routes** 中
2. 再次点击 **Add route**
3. Route 输入：`blog.yourdomain.com/robots.txt`
4. Zone 选择同一域名，点击 Submit 确认

**7.（可选）启用 IndexNow 推送**

如果需要在发布文章后自动通知搜索引擎（Bing 等），按以下步骤操作：

1. 前往 https://www.bing.com/indexnow/getstarted 生成一个 IndexNow Key
2. 在 Worker 的 **Settings** → **Variables and Secrets** 添加环境变量：
   - Variable name (变量名): `INDEXNOW_KEY`
   - Value: 你生成的 Key 字符串
3. 在 **Settings** → **Domains & Routes** 中添加路由：
   - `blog.yourdomain.com/indexnow` — IndexNow 提交端点

> 配置后 Worker 会自动响应 `/{你的key}.txt` 的验证请求，无需手动放置 Key 文件。

**（可选）设置定时自动推送**

在 Cloudflare Dashboard 中为该 Worker 添加 Cron Trigger：
1. 进入 Worker 页面 → **Settings** → **Triggers**
2. 在 **Cron Triggers** 下点击 **Add Cron Trigger**
3. 填入 `0 */6 * * *`（每 6 小时推送一次）
4. Cron Trigger 会自动 GET 请求 `/indexnow` 端点

也可以部署后手动触发：`curl -X POST https://blog.yourdomain.com/indexnow`

#### 方式二：Wrangler CLI 部署

习惯使用命令行的进阶用户，可以在 `rin-sitemap-worker.js` 的同级目录下创建一个 `wrangler.toml` 文件：

```toml
name = "rin-sitemap-worker"
main = "rin-sitemap-worker.js"
compatibility_date = "2024-05-14"

# 1. 绑定你的 Rin D1 数据库
[[d1_databases]]
binding = "DB"
database_name = "填入你的rin数据库名称"
database_id = "填入你的d1-uuid"

# 2. 绑定一个用于做缓存的 KV
[[kv_namespaces]]
binding = "SITEMAP_KV"
id = "填入你的kv-uuid"

# 3. （可选）IndexNow Key
[vars]
INDEXNOW_KEY = "你的indexnow-key"

# 4. （可选）如果你希望确保生成的页面域名万无一失
[vars]
SITE_URL = "https://blog.yourdomain.com"
```

1. 执行 `wrangler deploy` 推送到 Cloudflare
2. 前往 Cloudflare 控制面板，为这个 Worker 添加路径路由 (Routes)：
   - `your-blog.com/sitemap.xml` — Sitemap 路由
   - `your-blog.com/robots.txt` — robots.txt 路由（推荐）
   - `your-blog.com/indexnow` — IndexNow 提交端点（可选）
3. 部署完成！

## ⚙️ 环境变量

| 变量名 | 必填 | 说明 |
|-------|------|------|
| `DB` | ✅ | D1 数据库绑定，必须指向 Rin 博客的数据库 |
| `SITEMAP_KV` | ❌ | KV 命名空间绑定，用于缓存 sitemap 内容 |
| `SITE_URL` | ❌ | 站点 URL，如 `https://example.com`。不配置则自动使用请求域名 |
| `INDEXNOW_KEY` | ❌ | IndexNow Key，设置后启用自动推送功能。详见 IndexNow 推送机制 |

## 📝 工作原理

### 缓存机制

Worker 使用多层缓存策略确保高性能：

1. **HTTP 缓存头**：设置 `Cache-Control: public, max-age=21600`（6小时），支持 CDN 和浏览器缓存
2. **KV 缓存**：将生成的 sitemap XML 存入 KV，避免重复计算
3. **智能指纹**：缓存指纹由「文章数量 + 文章最后更新时间 + 动态最后更新时间 + 友链最后更新时间」组成，任意数据变化都会自动重建

### 性能优化

为了最大程度降低响应延迟，Worker 采用了多项数据库查询优化：

1. **查询并行化**：使用 `Promise.all()` 并行执行无依赖的数据库查询
   - 缓存检查阶段：文章元数据、动态、友链三个查询并行执行
   - 生成阶段：文章列表和标签列表两个查询并行执行
2. **消除冗余查询**：移除了未使用的标签元数据查询，减少不必要的数据库开销

### 容错机制

Worker 具备完善的容错降级能力，确保服务高可用：

1. **KV 缓存降级**：KV 读取或写入失败时，不会影响 sitemap 正常生成，仅记录警告日志
2. **空数据处理**：文章、动态、友链、标签任一数据为空时，对应页面优雅降级（不输出 lastmod 或跳过该类页面）
3. **边界情况**：无文章时 Last-Modified 头自动使用当前时间，避免显示异常日期

### 标签页 lastmod 计算方式

每个标签详情页（`/hashtag/{标签名}`）的 `<lastmod>` 时间取自**关联该标签的所有公开文章（draft=0）中最后更新的时间**。这样可以确保：
- 当某个标签下有新文章发布或旧文章更新时，该标签页的 lastmod 会自动更新
- 只有公开文章会影响标签页的更新时间，草稿文章不会被计入

> 注：标签列表页 `/hashtags` 的 lastmod 与首页、时间线页保持一致，使用 feeds 表中所有公开文章的最后更新时间。

### IndexNow 推送机制

当设置了 `INDEXNOW_KEY` 环境变量时，Worker 会自动启用两个端点：

**`/{key}.txt` — Key 验证文件**
搜索引擎通过访问此文件验证域名所有权。Worker 动态返回 Key 内容，无需手动在服务器放置文件。

**`/indexnow` — URL 提交端点**
触发后执行以下流程：
1. 查询 D1 数据库获取所有公开文章和标签
2. 构建完整 URL 列表（首页 + 固定页面 + 文章 + 标签页）
3. 并发 POST 到 `api.indexnow.org` 和 `www.bing.com` 两个端点
4. 返回 JSON 格式的结果

**触发方式：**
- **Cloudflare Cron Triggers**（推荐）：在 Worker 的 Triggers 页面添加 Cron Trigger，定时调用 `/indexnow`
- **手动触发**：`curl https://yourdomain.com/indexnow`
- **部署后触发**：在 CI/CD 流程中自动调用

> 提交后搜索引擎通常会在数分钟到数小时内开始爬取新内容。IndexNow 建议每天提交不超过 1 次，频繁提交可能影响排名。

### robots.txt 策略

Worker 同时托管 `/robots.txt`，返回以下策略：

```
User-agent: *
Allow: /
Disallow: /admin
Disallow: /profile
Disallow: /login

Sitemap: https://yourdomain.com/sitemap.xml
```

- **允许所有搜索引擎爬虫**抓取公开内容
- **禁止爬取后台页面**：`/admin`、`/profile`、`/login`
- **自动附加 Sitemap 指令**：搜索引擎能直接从 robots.txt 发现 sitemap 位置
- **响应缓存 1 天**：设置 `Cache-Control: public, max-age=86400`，减少 Worker 调用次数

> 需要额外在 Cloudflare 为该 Worker 添加一条 `yourdomain.com/robots.txt` 的路由才能生效。

### 响应头说明

| 响应头 | 说明 |
|-------|------|
| `X-Sitemap-Status: Hit-Cache` | 命中 KV 缓存 |
| `X-Sitemap-Status: Rebuilt` | 重新生成 sitemap |
| `ETag` | 缓存指纹标识 |
| `Last-Modified` | 最后更新时间（GMT 格式） |

## 🔧 本地开发

你可以使用 [Wrangler](https://developers.cloudflare.com/workers/wrangler/) 进行本地开发和测试：

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 本地预览（同时测试 sitemap 和 robots.txt）
wrangler dev
# 访问 http://localhost:8787/sitemap.xml
# 访问 http://localhost:8787/robots.txt
```
