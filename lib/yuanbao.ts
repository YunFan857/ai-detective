/**
 * 元宝搜索唯一入口。
 * 所有搜索请求都必须经过本文件，单案搜索次数上限 10 次。
 * TODO(PRD 步骤 3)：正反搜证的请求封装、缓存与限流。
 */
export type SearchHit = {
  url: string;
  title: string;
  snippet: string;
};

export async function searchYuanbao(query: string): Promise<SearchHit[]> {
  throw new Error(`TODO(PRD 步骤 3)：lib/yuanbao.ts 尚未实现（${query}）`);
}
