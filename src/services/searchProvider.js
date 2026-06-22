const config = require('../config');

class SearchProviderError extends Error {
  constructor(message, code = 'SEARCH_PROVIDER_ERROR') {
    super(message);
    this.name = 'SearchProviderError';
    this.code = code;
  }
}

function getSearchConfig() {
  return {
    provider: process.env.SEARCH_PROVIDER || '',
    apiKey: process.env.SEARCH_API_KEY || '',
    region: process.env.SEARCH_REGION || 'KR',
    language: process.env.SEARCH_LANGUAGE || 'zh-CN'
  };
}

function nowIso() {
  return new Date().toISOString();
}

function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isWithinLast24Hours(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) && Date.now() - time <= 24 * 60 * 60 * 1000 && time <= Date.now();
}

function normalizeCandidate(candidate) {
  return {
    keyword: candidate.keyword || candidate.topic_keyword || candidate.title || 'K-pop 今日动态',
    title: candidate.title || candidate.keyword || 'K-pop 今日动态',
    angle: candidate.angle || '',
    idol_name: candidate.idol_name || '',
    group_name: candidate.group_name || '',
    source_url: candidate.source_url || '',
    source_name: candidate.source_name || 'mock',
    source_type: candidate.source_type || '',
    source_summary: candidate.source_summary || candidate.summary || '',
    candidate_reason: candidate.candidate_reason || candidate.why_recent || '最近 24 小时内公开动态，适合进入候选池。',
    source_published_at: candidate.source_published_at || nowIso(),
    discovered_at: candidate.discovered_at || nowIso(),
    why_recent: candidate.why_recent || '标记为最近 24 小时内更新',
    source_count: Number(candidate.source_count || 1),
    social_signal: Number(candidate.social_signal || 6),
    media_signal: Number(candidate.media_signal || 6),
    freshness_signal: Number(candidate.freshness_signal || 10),
    image_signal: Number(candidate.image_signal || 0),
    audience_signal: Number(candidate.audience_signal || 7),
    image_candidates: Array.isArray(candidate.image_candidates) ? candidate.image_candidates : []
  };
}

function mockSearchRecentTopics() {
  const rows = [
    ['IVE Gaeul 今日公开动态', 'Gaeul 今日公开动态状态讨论升温', 'Gaeul', 'IVE', 'mock-official-newsroom', 'official', 2, 14, 13, 12, 12],
    ['aespa Karina 品牌活动公开照', 'Karina 品牌活动公开内容适合做状态观察', 'Karina', 'aespa', 'mock-brand-official', 'official', 4, 15, 12, 11, 11],
    ['NewJeans Hanni 公开行程动态', 'Hanni 公开行程动态有粉丝关注点', 'Hanni', 'NewJeans', 'mock-media-news', 'media', 5, 12, 11, 10, 10],
    ['LE SSERAFIM Sakura 舞台后公开更新', 'Sakura 舞台后公开更新具备可写角度', 'Sakura', 'LE SSERAFIM', 'mock-media-news', 'media', 6, 11, 10, 9, 10],
    ['IVE Rei 近况公开更新', 'Rei 公开近况适合写轻量状态观察', 'Rei', 'IVE', 'mock-media-news', 'media', 7, 10, 10, 9, 9],
    ['NMIXX Sullyoon 官方账号更新', 'Sullyoon 官方更新适合做公众号短文', 'Sullyoon', 'NMIXX', 'mock-official-account', 'official', 8, 12, 12, 11, 10],
    ['SEVENTEEN Mingyu 品牌公开动态', 'Mingyu 品牌公开动态有稳定阅读潜力', 'Mingyu', 'SEVENTEEN', 'mock-brand-official', 'official', 9, 13, 12, 12, 11],
    ['BLACKPINK Jisoo 活动公开视频', 'Jisoo 活动公开视频可提取公开事实', 'Jisoo', 'BLACKPINK', 'mock-media-news', 'media', 10, 12, 10, 10, 10],
    ['RIIZE Wonbin 社交平台公开动态', 'Wonbin 公开动态热度较高但需检查图片授权', 'Wonbin', 'RIIZE', 'mock-media-news', 'media', 11, 13, 10, 9, 10],
    ['粉丝站搬运图包热帖', '来源含粉丝站和图包风险，仅用于测试高风险拦截', 'Test Idol', 'Test Group', 'mock-fansite-repost-watermark', 'fan', 12, 9, 4, 3, 4]
  ];

  return rows.map(([keyword, title, idolName, groupName, sourceName, sourceType, hours, socialSignal, mediaSignal, imageSignal, audienceSignal], index) => normalizeCandidate({
    keyword,
    title,
    angle: '围绕公开事实和状态观察写一篇克制的公众号短文。',
    idol_name: idolName,
    group_name: groupName,
    source_url: `https://example.com/mock/daily-${index + 1}`,
    source_name: sourceName,
    source_type: sourceType,
    source_summary: `${title}，mock 数据仅用于测试每日候选评分流程。`,
    candidate_reason: `${hours} 小时前公开更新，适合进入今日候选评分。`,
    source_published_at: hoursAgoIso(hours),
    discovered_at: nowIso(),
    why_recent: `mock 数据标记为 ${hours} 小时前更新，仅用于本地流程测试。`,
    source_count: index < 2 ? 4 : 2,
    social_signal: socialSignal,
    media_signal: mediaSignal,
    freshness_signal: 10,
    image_signal: imageSignal,
    audience_signal: audienceSignal,
    image_candidates: index === 9 ? ['https://example.com/mock/watermark-1.jpg'] : [`https://example.com/mock/image-${index + 1}-1.jpg`, `https://example.com/mock/image-${index + 1}-2.jpg`]
  }));
}

async function searchRecentTopics() {
  const searchConfig = getSearchConfig();
  if (!searchConfig.provider) {
    throw new SearchProviderError('搜索服务未配置', 'SEARCH_NOT_CONFIGURED');
  }

  if (searchConfig.provider === 'mock') {
    return mockSearchRecentTopics().filter((candidate) => isWithinLast24Hours(candidate.source_published_at));
  }

  throw new SearchProviderError(
    `搜索服务 ${searchConfig.provider} 暂未接入，请实现 provider adapter 或使用 SEARCH_PROVIDER=mock 测试流程`,
    'SEARCH_PROVIDER_UNSUPPORTED'
  );
}

module.exports = {
  SearchProviderError,
  searchRecentTopics,
  isWithinLast24Hours,
  normalizeCandidate,
  mockSearchRecentTopics
};
