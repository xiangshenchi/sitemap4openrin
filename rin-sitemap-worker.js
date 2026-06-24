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
        "SELECT COUNT(*) as count, MAX(updated_at) as last_update FROM feeds WHERE draft = 0"
      ).first();
      
      // 获取 moments 表最后更新时间
      const momentsRes = await env.DB.prepare(
        "SELECT MAX(updated_at) as last_update FROM moments"
      ).first();
      
      // 获取 friends 表最后更新时间
      const friendsRes = await env.DB.prepare(
        "SELECT MAX(updated_at) as last_update FROM friends"
      ).first();
      
      // 获取标签相关的最后更新时间（关联标签的公开文章的最后更新时间）
      const hashtagsMetaRes = await env.DB.prepare(
        `SELECT MAX(f.updated_at) as last_update, COUNT(DISTINCT h.id) as count
         FROM hashtags h
         JOIN feed_hashtags fh ON h.id = fh.hashtag_id
         JOIN feeds f ON fh.feed_id = f.id
         WHERE f.draft = 0`
      ).first();
      
      // 生成缓存指纹：包含文章数量、文章最后更新时间、动态最后更新时间、友链最后更新时间
      const currentCacheFingerprint = `${metaRes.count}_${metaRes.last_update || 0}_${momentsRes.last_update || 0}_${friendsRes.last_update || 0}`;
      // --- 构造 ETag 和 Last-Modified 头 ---
      const eTag = `"${currentCacheFingerprint}"`;
      // 将数据库里的秒级时间戳转换成 HTTP 协议标准的 GMT 时间格式。
      const lastModTimestamp = metaRes.last_update * 1000;
      const lastModifiedDate = new Date(lastModTimestamp).toUTCString();
      // 定义公共基础响应头，直接附加到所有返回响应中
      const baseHeaders = {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=21600",
        "ETag": eTag,
        "Last-Modified": lastModifiedDate
      };
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
        "SELECT id, alias, updated_at, created_at FROM feeds WHERE draft = 0 ORDER BY created_at DESC"
      ).all();
      
      // 查询所有标签及其关联公开文章的最后更新时间
      const { results: hashtagResults } = await env.DB.prepare(
        `SELECT h.id, h.name, MAX(f.updated_at) as last_update
         FROM hashtags h
         JOIN feed_hashtags fh ON h.id = fh.hashtag_id
         JOIN feeds f ON fh.feed_id = f.id
         WHERE f.draft = 0
         GROUP BY h.id, h.name
         ORDER BY h.name`
      ).all();
      
      // 时间格式化辅助函数
      const formatLastMod = (timestamp) => {
        if (!timestamp) return null;
        return new Date(timestamp * 1000).toISOString().split('T')[0];
      };
      
      const feedsLastMod = formatLastMod(metaRes.last_update);
      const momentsLastMod = formatLastMod(momentsRes.last_update);
      const friendsLastMod = formatLastMod(friendsRes.last_update);
      const hashtagsLastMod = formatLastMod(hashtagsMetaRes.last_update);
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
      
      // 首页 - 使用文章最后更新时间
      xml += `  <url>\n    <loc>${BASE_URL}/</loc>\n`;
      if (feedsLastMod) xml += `    <lastmod>${feedsLastMod}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;
      
      // ----------------- 固定界面 -----------------
      // 每个页面对应不同的 lastmod 来源和优先级
      const fixedPages = [
        { path: '/timeline', lastmod: feedsLastMod, priority: '0.9' },
        { path: '/moments', lastmod: momentsLastMod, priority: '0.9' },
        { path: '/hashtags', lastmod: feedsLastMod, priority: '0.8' },
        { path: '/friends', lastmod: friendsLastMod, priority: '0.9' }
      ];
      for (const page of fixedPages) {
        xml += `  <url>\n    <loc>${BASE_URL}${page.path}</loc>\n`;
        if (page.lastmod) xml += `    <lastmod>${page.lastmod}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n    <priority>${page.priority}</priority>\n  </url>\n`;
      }
      // ------------------------------------------------
      // 动态文章页面
      for (const row of results) {
        const path = row.alias ? `/${row.alias}` : `/feed/${row.id}`;
        const postUrl = `${BASE_URL}${path}`;
        
        // Rin 数据库储存的时间戳(基于 unixepoch)是秒级的
        const timestamp = row.updated_at || row.created_at;
        const lastMod = new Date(timestamp * 1000).toISOString().split('T')[0];
        
        xml += `  <url>\n    <loc>${postUrl}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
      }
      
      // ----------------- 标签页面 -----------------
      // 每个标签页的 lastmod 取关联该标签的所有公开文章的最后更新时间
      for (const tag of hashtagResults) {
        // 标签名进行 URL 编码，与 OpenRin 前端路由保持一致
        const encodedTagName = encodeURIComponent(tag.name);
        const tagUrl = `${BASE_URL}/hashtag/${encodedTagName}`;
        const tagLastMod = formatLastMod(tag.last_update);
        
        xml += `  <url>\n    <loc>${tagUrl}</loc>\n`;
        if (tagLastMod) xml += `    <lastmod>${tagLastMod}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
      }
      // ------------------------------------------------
      
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