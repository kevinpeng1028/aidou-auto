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
    keyword: candidate.keyword || candidate.title || 'K-pop 今日动态',
    title: candidate.title || candidate.keyword || 'K-pop 今日动态',
    angle: candidate.angle || '',
    idol_name: candidate.idol_name || '',
    group_name: candidate.group_name || '',
    source_url: candidate.source_url || '',
    source_name: candidate.source_name || 'mock',
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
  return [
    normalizeCandidate({
      keyword: 'IVE Gaeul 今日公开动态',
      title: 'Gaeul 今日公开动态状态讨论升温',
      angle: '围绕公开近照和状态观察写一篇克制的公众号短文。',
      idol_name: 'Gaeul',
      group_name: 'IVE',
      source_url: 'https://example.com/mock/gaeul-today',
      source_name: 'mock-provider',
      source_published_at: hoursAgoIso(3),
      discovered_at: nowIso(),
      why_recent: 'mock 数据标记为 3 小时前更新，仅用于本地流程测试。',
      source_count: 3,
      social_signal: 8,
      media_signal: 7,
      freshness_signal: 10,
      image_signal: 0,
      audience_signal: 8,
      image_candidates: []
    })
  ];
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
  normalizeCandidate
};
