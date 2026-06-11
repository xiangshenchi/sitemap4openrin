export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (url.pathname !== "/sitemap.xml") {
      return new Response("Not Found", { status: 404 });
    }

    const BASE_URL = `${url.protocol}//${url.host}`;
    const KV_KEY = `cached_sitemap_xml_${url.host}`;
    const KV_META = `cached_sitemap_meta_${url.host}`; 

    try {
      // 核心修改：不仅获取数量(count)，同时获取所有文章中的最后更新时间(last_update)
      const metaRes = await env.DB.prepare(
        "SELECT COUNT(*) as count, MAX(updated_at) as last_update FROM feeds WHERE listed = 1 AND draft = 0"
      ).first();
      
      // 生成缓存指纹：格式为 "数量_最后更新时间戳"
      // 任何文章新增、删除（count变化）或 修改（last_update变化），都会导致指纹改变
      const currentCacheFingerprint = `${metaRes.count}_${metaRes.last_update || 0}`;

      // 如果有 KV 绑定则尝试读取缓存
      if (env.SITEMAP_KV) {
        const [cachedXml, cachedFingerprint] = await Promise.all([
          env.SITEMAP_KV.get(KV_KEY),
          env.SITEMAP_KV.get(KV_META) // 拿以前存的指纹对比
        ]);

        if (cachedXml && cachedFingerprint === currentCacheFingerprint) {
          return new Response(cachedXml, {
            headers: { 
              "Content-Type": "application/xml; charset=utf-8", 
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
          "Content-Type": "application/xml; charset=utf-8", 
          "X-Sitemap-Status": "Rebuilt" 
        },
      });

    } catch (e) {
      return new Response(`Error: ${e.message}`, { status: 500 });
    }
  }
};