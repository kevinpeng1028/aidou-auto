const config = require('../config');
const { getSearchableDomains, getSearchKeywords } = require('../config/koreanMediaSources');

function buildKoreanMediaQueries(options = {}) {
  const maxQueries = Number(options.maxQueries || config.search.maxSearchQueriesPerRun || 20);
  const mode = options.mode || config.search.koreanMediaSourceMode || 'broad';
  const language = options.language || config.search.language || 'ko,en';
  const domains = getSearchableDomains(mode);
  const keywords = getSearchKeywords(language);
  const queries = [];

  for (const source of domains) {
    for (const keyword of keywords) {
      queries.push({
        query: `${keyword} site:${source.domain}`,
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
