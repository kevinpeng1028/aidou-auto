const config = require('../config');
const { db } = require('../db');
const { classifySourceByUrl, isAllowedSourceUrl, normalizeHost } = require('../config/koreanMediaSources');
const { buildKoreanMediaQueries, buildFallbackKoreanMediaQueries } = require('./koreanMediaQueryBuilder');
const { searchTavily, TavilySearchError, maskApiKey } = require('./tavilySearchProvider');
const { rejectSourcePage } = require('./imageRelevance');

class KoreanMediaSearchError extends Error {
  constructor(message, code = 'KOREAN_MEDIA_SEARCH_FAILED') {
    super(message);
    this.name = 'KoreanMediaSearchError';
    this.code = code;
  }
}

const socialHosts = ['instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'pinterest.com', 'weibo.com', 'xiaohongshu.com', 'threads.net'];
const hardBlockedTerms = ['porn', 'casino', 'gambling', 'betting', 'malware', 'torrent', 'adult', 'sex', '바카라', '카지노', '도박', '성인', '成人视频', '赌博', '博彩'];

function logTask(taskName, status, message) {
  try {
    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)').run(taskName, status, message);
  } catch (error) {
    // Search logging should never break candidate generation.
  }
}

function getSearchConfig() {
  return {
    provider: config.search.provider || 'mock',
    apiKey: config.search.apiKey || '',
    region: config.search.region || 'KR',
    language: config.search.language || 'ko,en',
    sourceMode: config.search.koreanMediaSourceMode || 'broad',
    maxSearchQueriesPerRun: config.search.maxSearchQueriesPerRun || 40,
    maxSourceUrlsPerRun: config.search.maxSourceUrlsPerRun || 100,
    maxSourcePackagesPerRun: config.search.maxSourcePackagesPerRun || 30,
    maxSearchLeadsPerRun: config.search.maxSearchLeadsPerRun || 80,
    googleCseId: process.env.GOOGLE_CSE_ID || process.env.SEARCH_ENGINE_ID || ''
  };
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function isLikelyNonArticleUrl(sourceUrl = '') {
  const parsed = new URL(sourceUrl);
  const path = parsed.pathname.toLowerCase();
  const search = parsed.search.toLowerCase();
  if (path === '/' || path === '') return true;
  if (/\/(search|tag|tags|category|categories|login|signin|signup|subscribe|careers|career|shop|merch|ticket)\b/.test(path)) return true;
  if (search.includes('query=') || search.includes('keyword=') || search.includes('search=')) return true;
  if (/\.(jpg|jpeg|png|webp|gif|svg)$/i.test(path)) return true;
  return false;
}

function titleMatchesContent(title = '', content = '') {
  const normalizedTitle = String(title || '').toLowerCase().replace(/[^a-z0-9가-힣\s]/g, ' ');
  const normalizedContent = String(content || '').toLowerCase();
  const tokens = normalizedTitle.split(/\s+/).filter((token) => token.length >= 3).slice(0, 5);
  if (!tokens.length) return true;
  return tokens.some((token) => normalizedContent.includes(token));
}

function isRecentEnough(item) {
  const value = item.published_at || item.publishedAt || item.date || item.snippet_published_at || '';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return true;
  const hours = (Date.now() - time) / (60 * 60 * 1000);
  return hours <= 168 && time <= Date.now();
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function classifyDiscoverySource(sourceUrl, registry = {}, queryMeta = {}, snippet = '') {
  const host = normalizeHost(sourceUrl);
  const combined = `${sourceUrl} ${snippet}`.toLowerCase();
  const isRegistry = Boolean(registry.source_type);
  const isSocial = socialHosts.some((domain) => hostMatches(host, domain));
  if (isSocial) {
    return {
      source_category: 'social_platform',
      source_trust_level: 'unknown',
      risk_level: 'high',
      review_required: 1,
      risk_notes: '社交平台链接只保存线索，不自动抓图，不自动生成文章。'
    };
  }
  if (/fansite|fan|forum|dcinside|theqoo|pann|blog|tumblr|imgur|pinimg|watermark|repost|转载|搬运/i.test(combined)) {
    return {
      source_category: 'high_risk_public_source',
      source_trust_level: 'low',
      risk_level: 'high',
      review_required: 1,
      risk_notes: '来源可能是粉丝站、论坛、搬运或图片聚合，保留线索但不自动生成文章。'
    };
  }
  if (isRegistry) {
    const low = registry.source_risk_level === 'low';
    return {
      source_category: registry.source_type || queryMeta.source_type || 'registered_source',
      source_trust_level: low ? 'trusted' : 'known',
      risk_level: low ? 'low' : 'medium',
      review_required: low ? 0 : 1,
      risk_notes: low ? '已知低风险公开来源。' : '已知来源但仍需人工确认图片授权和内容风险。'
    };
  }
  if (/news|entertain|star|sports|kpop|k-pop|photo|press|media|newsen|hankyung|naver|daum|mk|chosun|joins|herald|heraldcorp|mksports/i.test(host)) {
    return {
      source_category: 'unknown_public_media',
      source_trust_level: 'review_required',
      risk_level: 'medium',
      review_required: 1,
      risk_notes: '不在 registry 内，但看起来是公开媒体或资讯页面，进入人工复核。'
    };
  }
  return {
    source_category: 'unknown_source',
    source_trust_level: 'unknown',
    risk_level: 'unknown',
    review_required: 1,
    risk_notes: '未知域名或来源可信度未确认，进入 search lead 人工复核。'
  };
}

function isHardUnsafeResult(item) {
  const text = [item.source_url, item.title, item.snippet].filter(Boolean).join(' ').toLowerCase();
  return hardBlockedTerms.find((term) => text.includes(term)) || '';
}

function normalizeSearchItem(item = {}, queryMeta = {}) {
  const sourceUrl = normalizeUrl(item.url || item.link || item.href || item.source_url || '');
  if (!sourceUrl) return null;
  const registry = classifySourceByUrl(sourceUrl) || {};
  const snippet = item.snippet || item.content || item.description || '';
  const sourceRisk = classifyDiscoverySource(sourceUrl, registry, queryMeta, snippet);
  return {
    source_url: sourceUrl,
    title: item.title || item.name || '',
    snippet,
    source_name: item.source_name || item.displayed_link || item.domain || queryMeta.domain || normalizeHost(sourceUrl),
    source_type: registry.source_type || queryMeta.source_type || sourceRisk.source_category || '',
    source_risk_level: registry.source_risk_level || queryMeta.source_risk_level || sourceRisk.risk_level || '',
    source_category: sourceRisk.source_category,
    source_trust_level: sourceRisk.source_trust_level,
    review_required: sourceRisk.review_required,
    risk_level: sourceRisk.risk_level,
    risk_notes: sourceRisk.risk_notes,
    source_discovery_type: queryMeta.source_discovery_type || 'unknown_query',
    source_published_at: item.published_at || item.publishedAt || item.date || '',
    score: Number(item.score || 0),
    query: queryMeta.query || '',
    provider: queryMeta.provider || item.source_provider || '',
    host: normalizeHost(sourceUrl),
    in_registry: Boolean(registry.source_type),
    raw: item.raw || item
  };
}

function rejectSearchItem(item, seenUrls, hostCounts, maxPerHost = 12) {
  const normalized = normalizeSearchItem(item, item.queryMeta || {});
  if (!normalized) return { rejected: true, reason: 'url 为空或不是 http/https', item: null };
  if (!normalized.title) return { rejected: true, reason: 'title 为空', item: normalized };
  if (seenUrls.has(normalized.source_url)) return { rejected: true, reason: '重复 URL', item: normalized };
  const unsafe = isHardUnsafeResult(normalized);
  if (unsafe) return { rejected: true, reason: `明显不适合内容:${unsafe}`, item: normalized };
  if (isLikelyNonArticleUrl(normalized.source_url)) return { rejected: true, reason: 'URL 像首页、列表页、搜索页或图片页', item: normalized };
  if (!isRecentEnough(normalized)) return { rejected: true, reason: '搜索结果发布时间超过 7 天', item: normalized };
  if (String(normalized.snippet || '').trim().length < 8) return { rejected: true, reason: 'content 太短', item: normalized };
  if (!titleMatchesContent(normalized.title, normalized.snippet)) {
    normalized.review_required = 1;
    normalized.risk_notes = `${normalized.risk_notes} title 与 content 相关性不足，保留为人工复核线索。`.trim();
  }
  const pageRejectReason = rejectSourcePage(normalized);
  if (pageRejectReason) {
    normalized.review_required = 1;
    normalized.risk_level = pageRejectReason.includes('audition') ? 'high' : normalized.risk_level;
    normalized.risk_notes = `${normalized.risk_notes} 页面类型需复核:${pageRejectReason}`.trim();
  }
  if ((hostCounts.get(normalized.host) || 0) >= maxPerHost) return { rejected: true, reason: '同一 host 结果过多，已降权跳过', item: normalized };
  return { rejected: false, reason: '', item: normalized };
}

function filterAndDedupeSearchResults(items, limit) {
  const seenUrls = new Set();
  const hostCounts = new Map();
  const accepted = [];
  const skippedReasons = [];

  for (const item of items) {
    const result = rejectSearchItem(item, seenUrls, hostCounts);
    if (result.rejected) {
      skippedReasons.push({ reason: result.reason, url: result.item?.source_url || item.url || '' });
      continue;
    }
    seenUrls.add(result.item.source_url);
    hostCounts.set(result.item.host, (hostCounts.get(result.item.host) || 0) + 1);
    accepted.push(result.item);
    if (accepted.length >= limit) break;
  }

  return { accepted, skippedReasons, dedupedUrlCount: accepted.length };
}

function summarizeRejected(reasons) {
  const counts = new Map();
  for (const item of reasons) counts.set(item.reason, (counts.get(item.reason) || 0) + 1);
  return [...counts.entries()].map(([reason, count]) => `${reason}:${count}`).join(', ') || '-';
}

async function searchWithTavilyQuery(queryMeta, searchConfig) {
  const results = await searchTavily(queryMeta.query, {
    apiKey: searchConfig.apiKey,
    maxResults: config.search.tavily.maxResultsPerQuery,
    searchDepth: config.search.tavily.searchDepth,
    includeAnswer: config.search.tavily.includeAnswer,
    includeRawContent: config.search.tavily.includeRawContent,
    includeImages: config.search.tavily.includeImages,
    timeoutMs: config.search.tavily.timeoutMs
  });
  return results.map((item) => ({ ...item, queryMeta: { ...queryMeta, provider: 'tavily' } }));
}

async function runQueryBatch(queryMetas, searchConfig, batchName) {
  const rawResults = [];
  const skippedReasons = [];
  const queryStats = [];
  for (const queryMeta of queryMetas) {
    logTask('tavily_query_started', 'started', `${batchName} query="${queryMeta.query}" type=${queryMeta.source_discovery_type || '-'}`);
    try {
      const queryResults = await searchWithTavilyQuery(queryMeta, searchConfig);
      rawResults.push(...queryResults);
      const filtered = filterAndDedupeSearchResults(queryResults, queryResults.length || 1);
      queryStats.push({ query: queryMeta.query, type: queryMeta.source_discovery_type || '', raw: queryResults.length, accepted: filtered.accepted.length, rejected: filtered.skippedReasons.length, rejectedReasons: filtered.skippedReasons });
      logTask('tavily_query_completed', 'success', `query="${queryMeta.query}" raw=${queryResults.length}`);
      logTask('tavily_query_filtered', 'success', `query="${queryMeta.query}" accepted=${filtered.accepted.length} rejected=${filtered.skippedReasons.length} reasons=${summarizeRejected(filtered.skippedReasons)}`);
    } catch (error) {
      const reason = error instanceof TavilySearchError ? error.message : (error.message || 'Tavily query failed');
      skippedReasons.push({ query: queryMeta.query, reason, api_key: maskApiKey(searchConfig.apiKey) });
      queryStats.push({ query: queryMeta.query, type: queryMeta.source_discovery_type || '', raw: 0, accepted: 0, rejected: 1, rejectedReasons: [{ reason }] });
      logTask('tavily_query_completed', 'failed', `query="${queryMeta.query}" raw=0 error=${reason}`);
      if (error.code === 'TAVILY_API_KEY_MISSING' || error.code === 'TAVILY_UNAUTHORIZED') throw error;
    }
  }
  return { rawResults, skippedReasons, queryStats };
}

async function searchKoreanMediaUrlsDetailed() {
  const searchConfig = getSearchConfig();
  if (searchConfig.provider === 'mock') {
    return { items: [], metrics: { provider: 'mock', queryCount: 0, rawUrlCount: 0, dedupedUrlCount: 0, skippedCount: 0, skippedReasons: [], queryStats: [] } };
  }
  if (searchConfig.provider !== 'tavily') {
    throw new KoreanMediaSearchError(`搜索服务 ${searchConfig.provider} 暂未接入 source package 搜索入口`, 'SEARCH_PROVIDER_UNSUPPORTED');
  }
  if (!searchConfig.apiKey) throw new KoreanMediaSearchError('Tavily API Key is missing', 'TAVILY_API_KEY_MISSING');

  const primaryQueries = buildKoreanMediaQueries({ mode: searchConfig.sourceMode, language: searchConfig.language, maxQueries: searchConfig.maxSearchQueriesPerRun });
  let batch = await runQueryBatch(primaryQueries, searchConfig, 'primary');
  let allRawResults = batch.rawResults;
  let allSkippedReasons = batch.skippedReasons;
  let allQueryStats = batch.queryStats;
  let fallbackUsed = false;

  if (allRawResults.length === 0) {
    fallbackUsed = true;
    const fallbackQueries = buildFallbackKoreanMediaQueries({ mode: searchConfig.sourceMode, language: searchConfig.language });
    logTask('tavily_fallback_started', 'started', `primary raw=0; fallback_queries=${fallbackQueries.length}`);
    const fallback = await runQueryBatch(fallbackQueries, searchConfig, 'fallback');
    allRawResults = fallback.rawResults;
    allSkippedReasons = [...allSkippedReasons, ...fallback.skippedReasons];
    allQueryStats = [...allQueryStats, ...fallback.queryStats];
  }

  const filtered = filterAndDedupeSearchResults(allRawResults, Math.min(searchConfig.maxSearchLeadsPerRun, searchConfig.maxSourceUrlsPerRun));
  const skippedReasons = [...allSkippedReasons, ...filtered.skippedReasons];
  const metrics = {
    provider: searchConfig.provider,
    queryCount: allQueryStats.length,
    rawUrlCount: allRawResults.length,
    dedupedUrlCount: filtered.dedupedUrlCount,
    skippedCount: skippedReasons.length,
    skippedReasons: skippedReasons.slice(0, 30),
    queryStats: allQueryStats,
    fallbackUsed
  };
  logTask('korean_media_search_completed', 'success', `provider=${metrics.provider} queryCount=${metrics.queryCount} rawUrlCount=${metrics.rawUrlCount} dedupedUrlCount=${metrics.dedupedUrlCount} skippedCount=${metrics.skippedCount}${fallbackUsed ? ' fallback=true' : ''}`);
  return { items: filtered.accepted, metrics };
}

async function searchKoreanMediaUrls() {
  const result = await searchKoreanMediaUrlsDetailed();
  return result.items;
}

async function testTavilySearch({ query = 'K-pop idol latest photos', maxResults = 5 } = {}) {
  const results = await searchTavily(query, { maxResults });
  const checked = results.map((item) => {
    const normalized = normalizeSearchItem(item, { query, provider: 'tavily', source_discovery_type: query.includes('site:') ? 'trusted_site_query' : 'broad_discovery_query' });
    const sourceUrl = normalized?.source_url || normalizeUrl(item.url);
    const pageRejectReason = normalized ? rejectSourcePage(normalized) : '';
    return {
      title: item.title,
      url: sourceUrl || item.url,
      host: sourceUrl ? normalizeHost(sourceUrl) : '',
      in_registry: Boolean(sourceUrl && isAllowedSourceUrl(sourceUrl, { includeHighRisk: true })),
      can_import_source_package: Boolean(normalized && !isLikelyNonArticleUrl(sourceUrl || '') && String(normalized.snippet || '').trim().length >= 8),
      source_trust_level: normalized?.source_trust_level || 'unknown',
      risk_level: normalized?.risk_level || 'unknown',
      review_required: Boolean(normalized?.review_required),
      reject_reason: pageRejectReason || '',
      score: item.score
    };
  });
  return { available: true, query, result_count: checked.length, results: checked };
}

module.exports = {
  KoreanMediaSearchError,
  getSearchConfig,
  searchKoreanMediaUrls,
  searchKoreanMediaUrlsDetailed,
  normalizeSearchItem,
  filterAndDedupeSearchResults,
  testTavilySearch,
  isLikelyNonArticleUrl,
  classifyDiscoverySource
};
