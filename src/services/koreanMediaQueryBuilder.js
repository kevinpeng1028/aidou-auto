const config = require('../config');
const { getSearchableDomains } = require('../config/koreanMediaSources');

const preferredQueries = [
  { domain: 'soompi.com', keyword: 'K-pop idol photos' },
  { domain: 'sbsstar.net', keyword: 'K-pop idol photos' },
  { domain: 'starnewskorea.com', keyword: '아이돌 포토' },
  { domain: 'osen.co.kr', keyword: '아이돌 포토' },
  { domain: 'xportsnews.com', keyword: '아이돌 근황 사진' },
  { domain: 'news.naver.com', keyword: '아이돌 포토' },
  { domain: 'entertain.naver.com', keyword: '아이돌 사진' },
  { domain: 'tenasia.hankyung.com', keyword: '아이돌 화보' },
  { domain: 'dispatch.co.kr', keyword: '아이돌 사진' }
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

const queryNegativeTerms = '-audition -recruit -trainee -apply -"official audition" -오디션 -모집 -연습생 -지원';

function buildKoreanMediaQueries(options = {}) {
  const maxQueries = Number(options.maxQueries || config.search.maxSearchQueriesPerRun || 20);
  const mode = options.mode || config.search.koreanMediaSourceMode || 'broad';
  const domains = getSearchableDomains(mode).filter((source) => source.source_type !== 'official_low_risk');
  const queries = [];

  for (const preferred of preferredQueries) {
    const source = domains.find((item) => item.domain === preferred.domain);
    if (!source) continue;
    queries.push({
      query: `${preferred.keyword} site:${source.domain} ${queryNegativeTerms}`,
      keyword: preferred.keyword,
      domain: source.domain,
      host: source.host || source.domain,
      source_type: source.source_type,
      source_risk_level: source.source_risk_level,
      priority: source.priority
    });
    if (queries.length >= maxQueries) return queries;
  }

  for (const source of domains) {
    for (const keyword of fallbackKeywords) {
      queries.push({
        query: `${keyword} site:${source.domain} ${queryNegativeTerms}`,
        keyword,
        domain: source.domain,
        host: source.host || source.domain,
        source_type: source.source_type,
        source_risk_level: source.source_risk_level,
        priority: source.priority
      });
      if (queries.length >= maxQueries) return queries;
    }
  }

  return queries;
}

module.exports = { buildKoreanMediaQueries };
