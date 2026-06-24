const config = require('../config');
const { getSearchableDomains } = require('../config/koreanMediaSources');

const trustedSiteQueries = [
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

const broadDiscoveryQueries = [
  'K-pop idol latest photos',
  'K-pop idol update photos',
  'K-pop girl group latest photos',
  'K-pop boy group latest photos',
  'K-pop comeback photos',
  'K-pop airport fashion photos',
  'K-pop photowall idol photos',
  'K-pop idol event photos',
  'K-pop idol pictorial latest',
  'K-pop idol official update',
  'K-pop idol Instagram update',
  'K-pop idol fashion event',
  'K-pop idol Calvin Klein photowall',
  'K-pop idol airport departure',
  'K-pop idol press conference photos',
  '아이돌 근황 사진',
  '아이돌 포토 기사',
  '아이돌 사진 기사',
  '걸그룹 근황 사진',
  '보이그룹 근황 사진',
  '아이돌 공항패션 사진',
  '아이돌 포토월 사진',
  '아이돌 화보 사진',
  '아이돌 컴백 사진',
  '아이돌 행사 사진',
  '아이돌 출국 사진',
  '아이돌 브랜드 행사 사진',
  '걸그룹 포토월',
  '보이그룹 포토월',
  '아이돌 인스타 근황'
];

const trendStyleQueries = [
  'K-pop idol brand event photos today',
  'K-pop idol magazine pictorial photos',
  'K-pop idol airport departure photos today',
  'K-pop idol music show arrival photos',
  'K-pop girl group photowall event photos',
  'K-pop boy group press event photos',
  '아이돌 브랜드 행사 포토 기사',
  '아이돌 공항 출국 포토 기사',
  '걸그룹 행사 포토 기사',
  '보이그룹 행사 포토 기사'
];

const fallbackQueries = [
  'K-pop idol latest photos',
  'K-pop comeback photos',
  'K-pop idol event photos',
  '아이돌 근황 사진',
  '아이돌 포토 기사',
  '아이돌 행사 사진',
  'site:starnewskorea.com 아이돌 포토',
  'site:xportsnews.com 아이돌 근황 사진',
  'site:osen.co.kr 아이돌 포토',
  'site:soompi.com K-pop idol photos'
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

function trustedQueryFor(source, keyword) {
  return {
    query: `site:${source.domain} ${keyword}`,
    keyword,
    domain: source.domain,
    host: source.host || source.domain,
    source_type: source.source_type,
    source_risk_level: source.source_risk_level,
    source_discovery_type: 'trusted_site_query',
    priority: source.priority
  };
}

function openQueryFor(query, sourceDiscoveryType) {
  return {
    query,
    keyword: query,
    domain: '',
    host: '',
    source_type: '',
    source_risk_level: '',
    source_discovery_type: sourceDiscoveryType,
    priority: 50
  };
}

function sourceMapForMode(mode) {
  const domains = getSearchableDomains(mode).filter((source) => source.source_type !== 'official_low_risk');
  return new Map(domains.map((source) => [source.domain, source]));
}

function pushLimited(target, item, maxQueries) {
  if (target.length >= maxQueries) return false;
  target.push(item);
  return target.length < maxQueries;
}

function buildKoreanMediaQueries(options = {}) {
  const maxQueries = Number(options.maxQueries || config.search.maxSearchQueriesPerRun || 40);
  const mode = options.mode || config.search.koreanMediaSourceMode || 'broad';
  const sourceMap = sourceMapForMode(mode);
  const queries = [];

  for (const query of broadDiscoveryQueries) {
    if (!pushLimited(queries, openQueryFor(query, 'broad_discovery_query'), maxQueries)) return queries;
  }

  for (const query of trendStyleQueries) {
    if (!pushLimited(queries, openQueryFor(query, 'trend_style_query'), maxQueries)) return queries;
  }

  for (const preferred of trustedSiteQueries) {
    const source = sourceMap.get(preferred.domain);
    if (!source) continue;
    if (!pushLimited(queries, trustedQueryFor(source, preferred.keyword), maxQueries)) return queries;
  }

  for (const source of sourceMap.values()) {
    for (const keyword of fallbackKeywords) {
      if (!pushLimited(queries, trustedQueryFor(source, keyword), maxQueries)) return queries;
    }
  }

  return queries;
}

function buildFallbackKoreanMediaQueries() {
  return fallbackQueries.map((query) => openQueryFor(query, query.startsWith('site:') ? 'trusted_site_fallback_query' : 'broad_fallback_query'));
}

module.exports = {
  buildKoreanMediaQueries,
  buildFallbackKoreanMediaQueries,
  trustedSiteQueries,
  broadDiscoveryQueries,
  trendStyleQueries,
  fallbackQueries
};
