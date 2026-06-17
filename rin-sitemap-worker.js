export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (url.pathname !== "/sitemap.xml") {
      return new Response("Not Found", { status: 404 });
    }

    // 优先使用环境变量配置的站点 URL，如果没有配置则动态使用来访请求的域名
    const BASE_URL = env.SITE_URL ? env.SITE_URL.replace(/\/$/, '') : `${url.protocol}//${url.host}`;
    
    const KV_KEY = "cached_sitemap_xml";
    const KV_META = "cached_sitemap_meta"; 

    try {
      // 核心修改：获取数量(count)和所有文章中的最后更新时间(last_update)
      const metaRes = await env.DB.prepare(
        "SELECT COUNT(*) as count, MAX(updated_at) as last_update FROM feeds WHERE listed = 1 AND draft = 0"
      ).first();
      
      // 生成缓存指纹：格式为 "数量_最后更新时间戳"
      const currentCacheFingerprint = `${metaRes.count}_${metaRes.last_update || 0}`;

      // --- 构造 ETag 和 Last-Modified 头 ---
      const eTag = `"${currentCacheFingerprint}"`;
      // 将数据库里的秒级时间戳转换成 HTTP 协议标准的 GMT 时间格式。如果数据库为空，回退到当前时间。
      const lastModTimestamp = metaRes.last_update ? metaRes.last_update * 1000 : Date.now();
      const lastModifiedDate = new Date(lastModTimestamp).toUTCString();

      // 定义公共基础响应头
      const baseHeaders = {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        "ETag": eTag,
        "Last-Modified": lastModifiedDate
      };

      // --- 严谨处理搜索引擎的条件请求 (304 Not Modified) 节省带宽 ---
      const reqEtag = request.headers.get("If-None-Match");
      const reqIfModifiedSince = request.headers.get("If-Modified-Since");

      let isNotModified = false;

      // 1. ETag 校验：支持逗号分隔和 Weak ETag (W/) 的情况
      if (reqEtag && reqEtag.includes(currentCacheFingerprint)) {
        isNotModified = true;
      } 
      // 2. Last-Modified 校验：将 HTTP 日期字符串转为时间戳比对大小
      else if (reqIfModifiedSince) {
        const clientDate = Date.parse(reqIfModifiedSince);
        const serverDate = Date.parse(lastModifiedDate);
        // 如果客户端缓存的时间戳 >= 服务端最新修改的时间戳，说明没有更新
        if (!isNaN(clientDate) && clientDate >= serverDate) {
          isNotModified = true;
        }
      }

      // 命中缓存，直接掐断后续请求，返回 304 空响应体
      if (isNotModified) {
        return new Response(null, {
          status: 304,
          headers: baseHeaders
        });
      }

      // 如果有 KV 绑定则尝试读取缓存
      if (env.SITEMAP_KV) {
        const [cachedXml, cachedFingerprint] = await Promise.all([
          env.SITEMAP_KV.get(KV_KEY),
          env.SITEMAP_KV.get(KV_META) // 拿以前存的指纹对比
        ]);

        if (cachedXml && cachedFingerprint === currentCacheFingerprint) {
          return new Response(cachedXml, {
            headers: { 
              ...baseHeaders,
              "X-Sitemap-Status": "Hit-Cache" 
            },
          });
        }
      }

      // 查询所有公开且非草稿的文章
      const { results } = await env.DB.prepare(
        "SELECT id, alias, updated_at, created_at FROM feeds WHERE listed = 1 AND draft = 0 ORDER BY created_at DESC"
      ).all();

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
      
      // 首页
      xml += `  <url>\n    <loc>${BASE_URL}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;
      
      // ----------------- 固定界面 -----------------
      const fixedPages = ['/timeline', '/moments', '/hashtags', '/friends', '/about'];
      for (const page of fixedPages) {
        xml += `  <url>\n    <loc>${BASE_URL}${page}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
      }
      // ------------------------------------------------

      // 动态文章页面
      for (const row of results) {
        const path = row.alias ? `/feed/${row.alias}` : `/feed/${row.id}`;
        const postUrl = `${BASE_URL}${path}`;
        
        // Rin 数据库储存的时间戳(基于 unixepoch)是秒级的
        const timestamp = row.updated_at || row.created_at || Math.floor(Date.now() / 1000);
        const lastMod = new Date(timestamp * 1000).toISOString().split('T')[0];
        
        xml += `  <url>\n    <loc>${postUrl}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
      }
      
      xml += `</urlset>`;

      // 异步存入 KV 缓存
      if (env.SITEMAP_KV) {
        ctx.waitUntil(Promise.all([
          env.SITEMAP_KV.put(KV_KEY, xml),
          env.SITEMAP_KV.put(KV_META, currentCacheFingerprint)
        ]));
      }

      return new Response(xml, {
        headers: { 
          ...baseHeaders,
          "X-Sitemap-Status": "Rebuilt" 
        },
      });

    } catch (e) {
      return new Response(`Error: ${e.message}`, { status: 500 });
    }
  }
};
