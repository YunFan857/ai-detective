import dotenv from 'dotenv';
import { search, searchStats } from '../lib/yuanbao';

dotenv.config({ path: '.env.local' });

const QUERIES = ['三星堆的由来', '人工智能发展现状', 'DeepSeek 最新进展'];

async function main(): Promise<void> {
  for (const query of QUERIES) {
    const startedAt = Date.now();
    const results = await search(query);
    const elapsed = Date.now() - startedAt;
    const withDate = results.filter((item) => item.publishedAt).length;
    const coverage = results.length === 0 ? 0 : Math.round((withDate / results.length) * 100);

    console.log(
      `\n[${query}] ${results.length} 条，耗时 ${elapsed}ms，publishedAt 覆盖率 ${coverage}%`,
    );
    for (const item of results) {
      console.log(
        `- ${item.title} | ${item.site || '(无站点)'} | ${item.publishedAt ?? '(无时间)'}`,
      );
    }
  }

  console.log(`\n请求 ${searchStats.calls} 次，缓存命中 ${searchStats.cacheHits} 次`);
}

main().catch((error: unknown) => {
  console.error('搜索失败:', error);
  process.exitCode = 1;
});
