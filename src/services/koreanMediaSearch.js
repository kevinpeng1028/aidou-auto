const config = require('../config');
const { buildDomainSearchQueries, classifySourceByUrl } = require('../config/koreanMediaSources');

class KoreanMediaSearchError extends Error {
  constructor(message, code = 'KOREAN_MEDIA_SEARCH_FAILED') {
    super(message);
    this.name = 'KoreanMediaSearchError';
    this.code = code;
  }
}

function getSearchConfig() {
  return {
    provider: config.search.provider || 'mock',
    apiKey: config.search.apiKey || '',
    region: config.search.region || 'KR',
    language: config.search.language || 'ko,en',
    sourceMode: config.search.koreanMediaSourceMode || 'broad',
    maxSourceUrlsPerRun: config.search.maxSourceUrlsPerRun || 50,
    maxSourcePackagesPerRun: config.search.maxSourcePackagesPerRun || 10,
    googleCseId: process.env.GOOGLE_CSE_ID || process.env.SEARCH_ENGINE_ID || ''
  };
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function isRecentEnough(item) {
  const value = item.published_at || item.publishedAt || item.date || item.snippet_published_at || '';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return true;
  const hours = (Date.now() - time) / (60 * 60 * 1000);
  return hours <= 48 && time <= Date.now();
}

function normalizeSearchItem(item = {}, queryMeta = {}) {
  const sourceUrl = normalizeUrl(item.url || item.link || item.href || item.source_url || '');
  if (!sourceUrl) return null;
  const registry = classifySourceByUrl(sourceUrl) || {};
  return {
    source_url: sourceUrl,
    title: item.title || item.name || '韩国娱乐公开图文',
    snippet: item.snippet || item.content || item.description || '',
    source_name: item.source_name || item.displayed_link || item.domain || queryMeta.domain || new URL(sourceUrl).hostname,
    source_type: registry.source_type || queryMeta.source_type || '',
    source_risk_level: registry.source_risk_level || queryMeta.source_risk_level || '',
    source_published_at: item.published_at || item.publishedAt || item.date || '',
    query: queryMeta.query || '',
    provider: queryMeta.provider || ''
  };
}

function dedupeUrls(items, limit) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const normalized = normalizeSearchItem(item, item.queryMeta || {});
    if (!normalized || seen.has(normalized.source_url) || !isRecentEnough(normalized)) continue;
    seen.add(normalized.source_url);
    deduped.push(normalized);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new KoreanMediaSearchError(`搜索接口请求失败：${response.status}`, 'SEARCH_REQUEST_FAILED');
  }
  return response.json();
}

async function searchWithTavily(queryMeta, searchConfig) {
  const json = await requestJson('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: searchConfig.apiKey,
      query: queryMeta.query,
      search_depth: 'basic',
      max_results: 8,
      days: 2,
      include_images: false
    })
  });
  return (json.results || []).map((item) => ({ ...item, queryMeta: { ...queryMeta, provider: 'tavily' } }));
}

async function searchWithSerpApi(queryMeta, searchConfig) {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('api_key', searchConfig.apiKey);
  url.searchParams.set('q', queryMeta.query);
  url.searchParams.set('gl', String(searchConfig.region || 'KR').toLowerCase());
  url.searchParams.set('hl', searchConfig.language.includes('en') ? 'en' : 'ko');
  url.searchParams.set('num', '10');
  url.searchParams.set('tbs', 'qdr:d2');
  const json = await requestJson(url.toString());
  return (json.organic_results || []).map((item) => ({ ...item, url: item.link, queryMeta: { ...queryMeta, provider: 'serpapi' } }));
}

async function searchWithGoogleCse(queryMeta, searchConfig) {
  if (!searchConfig.googleCseId) {
    throw new KoreanMediaSearchError('GOOGLE_CSE_ID 或 SEARCH_ENGINE_ID 未配置，无法使用 google_cse', 'SEARCH_ENGINE_ID_MISSING');
  }
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', searchConfig.apiKey);
  url.searchParams.set('cx', searchConfig.googleCseId);
  url.searchParams.set('q', queryMeta.query);
  url.searchParams.set('num', '10');
  url.searchParams.set('lr', searchConfig.language.includes('ko') ? 'lang_ko' : 'lang_en');
  url.searchParams.set('dateRestrict', 'd2');
  const json = await requestJson(url.toString());
  return (json.items || []).map((item) => ({ ...item, url: item.link, queryMeta: { ...queryMeta, provider: 'google_cse' } }));
}

async function runProviderSearch(queryMeta, searchConfig) {
  if (!searchConfig.apiKey) {
    throw new KoreanMediaSearchError('SEARCH_API_KEY 未配置，无法执行真实搜索。可使用 SEARCH_PROVIDER=mock 测试流程。', 'SEARCH_API_KEY_MISSING');
  }
  if (searchConfig.provider === 'tavily') return searchWithTavily(queryMeta, searchConfig);
  if (searchConfig.provider === 'serpapi') return searchWithSerpApi(queryMeta, searchConfig);
  if (searchConfig.provider === 'google_cse') return searchWithGoogleCse(queryMeta, searchConfig);
  if (searchConfig.provider === 'custom') {
    throw new KoreanMediaSearchError('SEARCH_PROVIDER=custom 需要在 koreanMediaSearch.js 中接入自定义 adapter。', 'CUSTOM_SEARCH_NOT_IMPLEMENTED');
  }
  throw new KoreanMediaSearchError(`搜索服务 ${searchConfig.provider} 暂未接入`, 'SEARCH_PROVIDER_UNSUPPORTED');
}

async function searchKoreanMediaUrls() {
  const searchConfig = getSearchConfig();
  if (searchConfig.provider === 'mock') return [];

  const queryMetas = buildDomainSearchQueries({
    mode: searchConfig.sourceMode,
    language: searchConfig.language,
    maxDomains: searchConfig.maxSourceUrlsPerRun
  });
  const results = [];
  for (const queryMeta of queryMetas) {
    if (results.length >= searchConfig.maxSourceUrlsPerRun * 2) break;
    try {
      results.push(...await runProviderSearch(queryMeta, searchConfig));
    } catch (error) {
      if (error.code === 'SEARCH_API_KEY_MISSING' || error.code === 'SEARCH_ENGINE_ID_MISSING') throw error;
    }
  }

  return dedupeUrls(results, searchConfig.maxSourceUrlsPerRun);
}

module.exports = {
  KoreanMediaSearchError,
  getSearchConfig,
  searchKoreanMediaUrls,
  normalizeSearchItem,
  dedupeUrls
};
