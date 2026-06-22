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

function normalizeImageCandidate(image, candidateSourceUrl, index) {
  if (typeof image === 'string') {
    return {
      original_url: image,
      source_url: candidateSourceUrl,
      usage_hint: index === 0 ? 'cover_candidate' : 'inline_candidate',
      image_caption: '',
      image_alt: '',
      image_description: '',
      surrounding_text: ''
    };
  }

  return {
    original_url: image.original_url || image.url || '',
    source_url: image.source_url || candidateSourceUrl,
    usage_hint: image.usage_hint || (index === 0 ? 'cover_candidate' : 'inline_candidate'),
    image_caption: image.image_caption || image.caption || '',
    image_alt: image.image_alt || '',
    image_description: image.image_description || '',
    surrounding_text: image.surrounding_text || ''
  };
}

function normalizeCandidate(candidate) {
  const sourceUrl = candidate.source_url || '';
  const rawImages = Array.isArray(candidate.image_candidates) ? candidate.image_candidates : [];
  return {
    keyword: candidate.keyword || candidate.topic_keyword || candidate.title || 'K-pop 今日动态',
    title: candidate.title || candidate.keyword || 'K-pop 今日动态',
    angle: candidate.angle || '',
    idol_name: candidate.idol_name || '',
    group_name: candidate.group_name || '',
    event_type: candidate.event_type || '',
    source_url: sourceUrl,
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
    image_signal: Number(candidate.image_signal || rawImages.length || 0),
    audience_signal: Number(candidate.audience_signal || 7),
    image_candidates: rawImages.map((image, index) => normalizeImageCandidate(image, sourceUrl, index))
  };
}

function mockImages(sourceUrl, idolName, topic, count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    original_url: `${sourceUrl}/mock-image-${index + 1}.jpg`,
    source_url: sourceUrl,
    usage_hint: index === 0 ? 'cover_candidate' : 'inline_candidate',
    image_caption: index === 0 ? `${idolName} ${topic} 封面候选图` : `${idolName} ${topic} 正文图 ${index}`,
    image_alt: `${idolName} ${topic} image ${index + 1}`,
    image_description: `${idolName} ${topic} 同源测试图 ${index + 1}`,
    surrounding_text: `同一 source package 页面中的 ${idolName} ${topic} 图片 ${index + 1}`
  }));
}

function mockSearchRecentTopics() {
  const rows = [
    ['IVE Gaeul 今日公开动态', 'Gaeul 今日公开动态状态讨论升温', 'Gaeul', 'IVE', 'mock-official-newsroom', 'official_low_risk', 'official_update', 2, 14, 13, 3, 12],
    ['aespa Karina 品牌活动公开照', 'Karina 品牌活动公开内容适合做状态观察', 'Karina', 'aespa', 'mock-brand-official', 'official_low_risk', 'brand_event', 4, 15, 12, 3, 11],
    ['NewJeans Hanni 公开行程动态', 'Hanni 公开行程动态有粉丝关注点', 'Hanni', 'NewJeans', 'mock-korean-media-news', 'korean_media_medium_risk', 'public_schedule', 5, 12, 11, 3, 10],
    ['LE SSERAFIM Sakura 舞台后公开更新', 'Sakura 舞台后公开更新具备可写角度', 'Sakura', 'LE SSERAFIM', 'mock-korean-media-news', 'korean_media_medium_risk', 'stage', 6, 11, 10, 3, 10],
    ['IVE Rei 近况公开更新', 'Rei 公开近况适合写轻量状态观察', 'Rei', 'IVE', 'mock-korean-media-news', 'korean_media_medium_risk', 'official_update', 7, 10, 10, 3, 9],
    ['NMIXX Sullyoon 官方账号更新', 'Sullyoon 官方更新适合做公众号短文', 'Sullyoon', 'NMIXX', 'mock-official-account', 'official_low_risk', 'official_update', 8, 12, 12, 3, 10],
    ['SEVENTEEN Mingyu 品牌公开动态', 'Mingyu 品牌公开动态有稳定阅读潜力', 'Mingyu', 'SEVENTEEN', 'mock-brand-official', 'official_low_risk', 'brand_event', 9, 13, 12, 3, 11],
    ['BLACKPINK Jisoo 活动公开视频', 'Jisoo 活动公开视频可提取公开事实', 'Jisoo', 'BLACKPINK', 'mock-korean-media-news', 'korean_media_medium_risk', 'event', 10, 12, 10, 3, 10],
    ['RIIZE Wonbin 社交平台公开动态', 'Wonbin 公开动态热度较高但需检查图片授权', 'Wonbin', 'RIIZE', 'mock-korean-media-news', 'korean_media_medium_risk', 'social_update', 11, 13, 10, 3, 10],
    ['粉丝站搬运图包热帖', '来源含粉丝站和图包风险，仅用于测试高风险拦截', 'Test Idol', 'Test Group', 'mock-fansite-repost-watermark', 'high_risk_source', 'fansite_repost', 12, 9, 4, 3, 4]
  ];

  return rows.map(([keyword, title, idolName, groupName, sourceName, sourceType, eventType, hours, socialSignal, mediaSignal, imageCount, audienceSignal], index) => {
    const sourceUrl = `https://example.com/mock/source-package-${index + 1}`;
    return normalizeCandidate({
      keyword,
      title,
      angle: '围绕同一 source package 的公开事实和图片说明写一篇克制的公众号短文。',
      idol_name: idolName,
      group_name: groupName,
      event_type: eventType,
      source_url: sourceUrl,
      source_name: sourceName,
      source_type: sourceType,
      source_summary: `${title}，mock 数据包含同一 source_url 下的封面候选图和正文图。`,
      candidate_reason: `${hours} 小时前公开更新，适合进入今日候选评分。`,
      source_published_at: hoursAgoIso(hours),
      discovered_at: nowIso(),
      why_recent: `mock 数据标记为 ${hours} 小时前更新，仅用于本地流程测试。`,
      source_count: index < 2 ? 4 : 2,
      social_signal: socialSignal,
      media_signal: mediaSignal,
      freshness_signal: 10,
      image_signal: imageCount,
      audience_signal: audienceSignal,
      image_candidates: mockImages(sourceUrl, idolName, keyword, Math.max(3, imageCount))
    });
  });
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
