export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

        // 统一的 BASE_URL 获取函数
    const getBaseUrl = () => env.SITE_URL ? env.SITE_URL.replace(/\/+$/, '') : `${url.protocol}//${url.host}`;
    // 从 BASE_URL 提取纯域名（用于 IndexNow host 字段）
    const getHost = (baseUrl) => baseUrl.replace(/^https?:\/\//, '').split('/')[0];
    
        // ---- /robots.txt 处理 ----
    if (url.pathname === "/robots.txt") {
      const BASE_URL = getBaseUrl();
      const robots = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /profile/
Disallow: /login/

Sitemap: ${BASE_URL}/sitemap.xml
`;
      return new Response(robots, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=86400"
        }
      });
    }
    // -------------------------
    
    if (url.pathname !== "/sitemap.xml") {
      return new Response("Not Found", { status: 404 });
    }
    // 优先使用环境变量配置的站点 URL，如果没有配置则动态使用来访请求的域名
    const BASE_URL = env.SITE_URL ? env.SITE_URL.replace(/\/+$/, '') : `${url.protocol}//${url.host}`;
    
    const KV_KEY = "cached_sitemap_xml";
    const KV_META = "cached_sitemap_meta"; 
    
    // 时间格式化辅助函数
    const formatLastMod = (timestamp) => {
      if (!timestamp) return null;
      return new Date(timestamp * 1000).toISOString().split('T')[0];
    };
    
    try {
      // 并行执行缓存指纹所需的所有查询
      const [metaRes, momentsRes, friendsRes] = await Promise.all([
        // 获取文章数量和最后更新时间（用于缓存指纹）
        env.DB.prepare(
          "SELECT COUNT(*) as count, MAX(updated_at) as last_update FROM feeds WHERE draft = 0"
        ).first(),
        // 获取 moments 表最后更新时间
        env.DB.prepare(
          "SELECT MAX(updated_at) as last_update FROM moments"
        ).first(),
        // 获取 friends 表最后更新时间
        env.DB.prepare(
          "SELECT MAX(updated_at) as last_update FROM friends"
        ).first()
      ]);
      
      // 生成缓存指纹：包含文章数量、文章最后更新时间、动态最后更新时间、友链最后更新时间
      const currentCacheFingerprint = `${metaRes.count}_${metaRes.last_update || 0}_${momentsRes.last_update || 0}_${friendsRes.last_update || 0}`;
      
      // --- 构造 ETag 和 Last-Modified 头 ---
      const eTag = `"${currentCacheFingerprint}"`;
      // 将数据库里的秒级时间戳转换成 HTTP 协议标准的 GMT 时间格式。
      const lastModTimestamp = metaRes.last_update ? metaRes.last_update * 1000 : Date.now();
      const lastModifiedDate = new Date(lastModTimestamp).toUTCString();
      // 定义公共基础响应头，直接附加到所有返回响应中
      const baseHeaders = {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=21600",
        "ETag": eTag,
        "Last-Modified": lastModifiedDate
      };
      
      // 如果有 KV 绑定则尝试读取缓存（失败时降级处理，不影响主流程）
      let cacheHit = false;
      let cachedXml = null;
      if (env.SITEMAP_KV) {
        try {
          const [kvXml, kvFingerprint] = await Promise.all([
            env.SITEMAP_KV.get(KV_KEY),
            env.SITEMAP_KV.get(KV_META)
          ]);
          if (kvXml && kvFingerprint === currentCacheFingerprint) {
            cachedXml = kvXml;
            cacheHit = true;
          }
        } catch (kvError) {
          // KV 读取失败，忽略错误，继续生成 sitemap
          console.warn("KV cache read failed, regenerating sitemap:", kvError.message);
        }
      }
      
      if (cacheHit && cachedXml) {
        return new Response(cachedXml, {
          headers: { 
            ...baseHeaders,
            "X-Sitemap-Status": "Hit-Cache" 
          },
        });
      }
      
      const feedsLastMod = formatLastMod(metaRes.last_update);
      const momentsLastMod = formatLastMod(momentsRes.last_update);
      const friendsLastMod = formatLastMod(friendsRes.last_update);
      
      // 并行执行文章查询和标签查询
      const [{ results }, { results: hashtagResults }] = await Promise.all([
        // 查询所有公开且非草稿的文章
        env.DB.prepare(
          "SELECT id, alias, updated_at, created_at FROM feeds WHERE draft = 0 ORDER BY created_at DESC"
        ).all(),
        // 查询所有标签及其关联公开文章的最后更新时间
        // 优化说明：去掉 ORDER BY 减少排序开销；去掉 h.id（代码中未使用）
        env.DB.prepare(
          `SELECT h.name, MAX(f.updated_at) as last_update
           FROM hashtags h
           JOIN feed_hashtags fh ON h.id = fh.hashtag_id
           JOIN feeds f ON fh.feed_id = f.id
           WHERE f.draft = 0
           GROUP BY h.id, h.name`
        ).all()
      ]);
      
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
        
        // 使用统一的时间格式化函数
        const timestamp = row.updated_at || row.created_at;
        const lastMod = formatLastMod(timestamp);
        
        xml += `  <url>\n    <loc>${postUrl}</loc>\n`;
        if (lastMod) xml += `    <lastmod>${lastMod}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
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
      
      // 异步存入 KV 缓存（失败不影响主流程）
      if (env.SITEMAP_KV) {
        ctx.waitUntil(
          Promise.all([
            env.SITEMAP_KV.put(KV_KEY, xml),
            env.SITEMAP_KV.put(KV_META, currentCacheFingerprint)
          ]).catch(err => {
            console.warn("KV cache write failed:", err.message);
          })
        );
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
