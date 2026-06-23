const config = require('../config');
const { getSearchableDomains } = require('../config/koreanMediaSources');

const preferredQueries = [
  { domain: 'starnewskorea.com', keyword: '아이돌 포토' },
  { domain: 'xportsnews.com', keyword: '아이돌 근황 사진' },
  { domain: 'osen.co.kr', keyword: '아이돌 포토' },
  { domain: 'tenasia.hankyung.com', keyword: '아이돌 화보' },
  { domain: 'dispatch.co.kr', keyword: '아이돌 사진' },
  { domain: 'soompi.com', keyword: 'K-pop idol photos' },
  { domain: 'sbsstar.net', keyword: 'K-pop idol photos' },
  { domain: 'entertain.naver.com', keyword: '아이돌 사진' },
  { domain: 'news.naver.com', keyword: '아이돌 포토' },
  { domain: 'mk.co.kr', keyword: '아이돌 포토' }
];

const fallbackQueries = [
  { domain: 'starnewskorea.com', keyword: '아이돌 포토' },
  { domain: 'xportsnews.com', keyword: '아이돌 근황 사진' },
  { domain: 'osen.co.kr', keyword: '아이돌 포토' },
  { domain: 'tenasia.hankyung.com', keyword: '아이돌 화보' },
  { domain: 'soompi.com', keyword: 'K-pop idol photos' }
];

const fallbackKeywords = [
  '아이돌 포토',
  '아이돌 사진',
  '아이돌 화보',
  'K-pop idol photos',
  'K-pop comeback photos',
  'idol photoshoot',
  'Korean idol update'
];

function queryFor(source, keyword) {
  return {
    query: `site:${source.domain} ${keyword}`,
    keyword,
    domain: source.domain,
    host: source.host || source.domain,
    source_type: source.source_type,
    source_risk_level: source.source_risk_level,
    priority: source.priority
  };
}

function sourceMapForMode(mode) {
  const domains = getSearchableDomains(mode).filter((source) => source.source_type !== 'official_low_risk');
  return new Map(domains.map((source) => [source.domain, source]));
}

function buildKoreanMediaQueries(options = {}) {
  const maxQueries = Number(options.maxQueries || config.search.maxSearchQueriesPerRun || 20);
  const mode = options.mode || config.search.koreanMediaSourceMode || 'broad';
  const sourceMap = sourceMapForMode(mode);
  const queries = [];

  for (const preferred of preferredQueries) {
    const source = sourceMap.get(preferred.domain);
    if (!source) continue;
    queries.push(queryFor(source, preferred.keyword));
    if (queries.length >= maxQueries) return queries;
  }

  for (const source of sourceMap.values()) {
    for (const keyword of fallbackKeywords) {
      queries.push(queryFor(source, keyword));
      if (queries.length >= maxQueries) return queries;
    }
  }

  return queries;
}

function buildFallbackKoreanMediaQueries(options = {}) {
  const mode = options.mode || config.search.koreanMediaSourceMode || 'broad';
  const sourceMap = sourceMapForMode(mode);
  return fallbackQueries
    .map((item) => {
      const source = sourceMap.get(item.domain);
      return source ? queryFor(source, item.keyword) : null;
    })
    .filter(Boolean);
}

module.exports = { buildKoreanMediaQueries, buildFallbackKoreanMediaQueries };
