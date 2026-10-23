/**
 * 来源分级：按域名与站点名映射可信度档位。
 * 清单匹配不到时返回 null，交由大模型在分级阶段判断。
 */
import type { Tier } from '../types/case';

const OFFICIAL_DOMAINS = [
  'gov.cn',
  'who.int',
  'cdc.gov',
  'nih.gov',
  'edu.cn',
  'edu',
  'cnki.net',
  'nature.com',
  'science.org',
  'thelancet.com',
  'nejm.org',
  'piyao.org.cn',
];

const OFFICIAL_NAME_HINTS = [
  '中国政府网',
  '国务院',
  '中国疾控',
  '国家卫健委',
  '卫生健康委',
  '国家药监局',
  '中国科学院',
  '教育部',
  '外交部',
  '公安部',
  '财政部',
  '生态环境部',
  '国家统计局',
  '联合辟谣平台',
  'pubmed',
];

const MEDIA_DOMAINS = [
  'people.com.cn',
  'xinhuanet.com',
  'cctv.com',
  'chinanews.com.cn',
  'thepaper.cn',
  'caixin.com',
  'bbc.com',
  'bbc.co.uk',
  'reuters.com',
  'apnews.com',
  'gmw.cn',
];

const MEDIA_NAME_HINTS = ['人民网', '新华网', '央视', '中国新闻网', '澎湃新闻', '财新', '光明网'];

const SELF_DOMAINS = ['zhihu.com', 'bilibili.com', 'weixin.qq.com', 'douban.com', 'jianshu.com'];

/** 内容农场与聚合平台：整站默认营销号，Sohu / 网易仅自媒体频道命中。 */
const MARKETING_DOMAINS = ['baijiahao.baidu.com', 'toutiao.com'];

const MARKETING_PATH_RULES = [
  { domain: 'sohu.com', prefix: '/a/' },
  { domain: '163.com', prefix: '/dy/' },
];

const OFFICIAL_ACCOUNT_HINTS = ['官方', '政务', '政府'];

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function parseTarget(site: string): { host: string; path: string; raw: string } {
  const raw = site.trim().toLowerCase();
  if (!raw) {
    return { host: '', path: '', raw };
  }

  if (raw.includes('://')) {
    try {
      const url = new URL(raw);
      return { host: url.hostname.replace(/^www\./, ''), path: url.pathname.toLowerCase(), raw };
    } catch {
      return { host: '', path: '', raw };
    }
  }

  const slash = raw.indexOf('/');
  const host = (slash === -1 ? raw : raw.slice(0, slash)).replace(/^www\./, '');
  const path = slash === -1 ? '' : raw.slice(slash);
  return { host, path, raw };
}

/** 按域名或站点名判断来源档位；无法识别时返回 null。 */
export function tierByDomain(site: string): Tier | null {
  const { host, path, raw } = parseTarget(site);
  if (!raw) {
    return null;
  }

  if (host && OFFICIAL_DOMAINS.some((domain) => matchesDomain(host, domain))) {
    return 'official';
  }
  if (OFFICIAL_NAME_HINTS.some((hint) => raw.includes(hint))) {
    return 'official';
  }

  if (host && MEDIA_DOMAINS.some((domain) => matchesDomain(host, domain))) {
    return 'media';
  }
  if (MEDIA_NAME_HINTS.some((hint) => raw.includes(hint))) {
    return 'media';
  }

  if (host && SELF_DOMAINS.some((domain) => matchesDomain(host, domain))) {
    return 'self';
  }

  const isMarketingHost = host && MARKETING_DOMAINS.some((domain) => matchesDomain(host, domain));
  const isMarketingPath = MARKETING_PATH_RULES.some(
    (rule) => matchesDomain(host, rule.domain) && path.startsWith(rule.prefix),
  );
  if (isMarketingHost || isMarketingPath) {
    return OFFICIAL_ACCOUNT_HINTS.some((hint) => raw.includes(hint)) ? 'official' : 'marketing';
  }

  return null;
}
