# SiteMap Maker for OpenRin (站点地图生成器)

专为 [openRin](https://github.com/openRin/Rin) 打造的轻量级站点地图（Sitemap）生成器，依托 Cloudflare Workers，直接读取 D1 数据库，完美解决基于 RSS 生成 Sitemap 时“仅包含最新 20 篇文章”的数量限制。

## ✨ 核心特性

- **直连 D1 数据库**：直接从 Rin 的底层 D1 数据库记录中读取文章，不再受 API 分页或 RSS 长度限制，生成包含所有文章的完整 Sitemap。
- **状态精准过滤**：自动过滤草稿（`draft = 1`）和隐藏文章（`listed = 0`），确保隐私与未完稿内容不会泄露给搜索引擎。
- **智能 KV 缓存**：引入高级缓存指纹机制（`COUNT(*)` + `MAX(updated_at)`），只在文章发生**新增、删除或修改**时才触发缓存重建，大大节省了 D1 的读取请求压力。
- **完美兼容 Rin 的路由生态**：自动识别并优先使用文章的自定义别名（`alias`），若无别名则无缝降级使用 `id`，保持与 Rin 前端完全一致的持久化链接。
- **灵活的域名适配**：支持通过 `SITE_URL` 环境变量强行指定生成的域名，未指定时则智能采取来访请求的域名生成 Sitemap 源地址。
- **额外添加固定页面**：考虑了openRin这几个页面`/timeline` `/moments` `/hashtags` `/friends` `/about`
---

## 🚀 部署指南 (Cloudflare Dashboard 面板部署)

如果你不想配置本地开发环境，可以直接在 Cloudflare 网页端一键完成全部操作：

### 1. 新建 Worker
1. 登录 Cloudflare Dashboard，选择左侧菜单的 **Workers & Pages**。
2. 点击 **Create application** -> **Create Worker**。
3. 命名为 `rin-sitemap-worker` 并点击 Deploy 按钮完成初始创建。
4. 点击 **Edit code**，将 `rin-sitemap-worker.js` 中的完整代码覆盖原有的代码，点击右上角的 **Deploy** 部署。

### 2. 创建并绑定 KV 空间 (实现缓存极速响应)
1. 在网页左下侧菜单找到 **Storage & Databases** -> **KV**。
2. 点击 **Create a namespace**，命名为 `RIN_SITEMAP_CACHE`。
3. 返回你刚刚创建的 `rin-sitemap-worker` 页面，进入 **Settings** 选项卡 -> **Bindings** 菜单配置项。
4. 点击 **Add** 添加一个 **KV Namespace** 绑定：
   - Variable name (变量名): `SITEMAP_KV` （**注意：必须叫这个名字代码才能识别**）
   - KV namespace: 选择你刚才创建的 `RIN_SITEMAP_CACHE`

### 3. 绑定 Rin 的 D1 数据库
1. 同样在 **Settings** -> **Bindings** 菜单配置项中。
2. 点击 **Add** 添加一个 **D1 database** 绑定：
   - Variable name (变量名): `DB` （**注意：必须全大写 `DB`，与 Rin 的官方规范保持一致**）
   - D1 database: 下拉选择你部署 openRin 时使用的那个主要数据库（通常名为 `rin`）。

### 4. (可选) 配置指定域名
如果你的 Worker 使用了多个域名或自带 workers.dev 域名，为了防止生成的 sitemap 源地址产生混乱，**强烈建议**在 **Settings** -> **Variables and Secrets** 处添加一个环境变量：
   - Variable name: `SITE_URL`
   - Value: `https://blog.yourdomain.com` （填入你的真实博客主页地址即可）

### 5. 接管 Sitemap 路由
1. 依然在 Worker 页面，进入 **Settings** 选项卡 -> **Domains & Routes**。
2. 点击 **Add route**。
3. 在 Route 一栏输入你希望生效的地址，例如：`blog.yourdomain.com/sitemap.xml`。
4. Zone 挑选对应的根域名，点击 Submit 确认。
5. 部署完成！访问 `https://blog.yourdomain.com/sitemap.xml` 即可看到生成的 XML 文件。

---

## 💻 部署指南 (Wrangler CLI 极客部署)

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

# 3. （可选）如果你希望确保生成的页面域名万无一失
[vars]
SITE_URL = "https://blog.yourdomain.com"
```

1. 执行 `wrangler deploy` 推送到 Cloudflare。
2. 最后前往 Cloudflare 控制面板，为这个 Worker 自定义一个 `your-blog.com/sitemap.xml` 的路径路由 (Routes) 即可正式生效！
