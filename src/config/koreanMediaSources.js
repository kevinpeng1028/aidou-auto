const officialLowRiskDomains = [
  'smtown.com',
  'ygfamily.com',
  'jype.com',
  'hybecorp.com',
  'weverse.io',
  'mnetplus.world',
  'youtube.com',
  'instagram.com',
  'x.com',
  'twitter.com'
];

const koreanMediaMediumRiskDomains = [
  'entertain.naver.com',
  'news.naver.com',
  'starnewskorea.com',
  'osen.co.kr',
  'xportsnews.com',
  'newsen.com',
  'mydaily.co.kr',
  'tenasia.hankyung.com',
  'dispatch.co.kr',
  'tvreport.co.kr',
  'sports.chosun.com',
  'sports.khan.co.kr',
  'sports.donga.com',
  'mk.co.kr/star',
  'isplus.com',
  'joynews24.com',
  'topstarnews.net',
  'heraldpop.com',
  'edaily.co.kr',
  'news1.kr',
  'yna.co.kr',
  'hankookilbo.com',
  'koreatimes.co.kr',
  'koreaherald.com',
  'koreajoongangdaily.joins.com',
  'sbsstar.net'
];

const englishKpopMediaMediumRiskDomains = [
  'soompi.com',
  'allkpop.com',
  'koreaboo.com',
  'kpopherald.koreaherald.com',
  'sbsstar.net'
];

const highRiskDomains = [
  'theqoo.net',
  'instiz.net',
  'pann.nate.com',
  'dcinside.com',
  'tiktok.com',
  'pinterest.com',
  'reddit.com'
];

const koreanKeywords = [
  '연예',
  'K팝',
  '아이돌',
  '컴백',
  '공항패션',
  '화보',
  '브랜드 행사',
  '무대',
  '공식 사진'
];

const englishKeywords = [
  'K-pop idol latest photos',
  'K-pop comeback photos',
  'K-pop brand event photos',
  'K-pop official update',
  'K-pop airport fashion'
];

const sourceRegistry = [
  {
    type: 'official_low_risk',
    source_risk_level: 'low',
    source_risk_score: 95,
    domains: officialLowRiskDomains,
    notes: '官方账号、经纪公司、品牌或主办方公开来源，仍需人工确认图片授权后使用。'
  },
  {
    type: 'korean_media_medium_risk',
    source_risk_level: 'medium',
    source_risk_score: 75,
    domains: koreanMediaMediumRiskDomains,
    notes: '韩国娱乐媒体公开图文报道，只能在同一 source_url 内绑定文章和图片并改写。'
  },
  {
    type: 'english_kpop_media_medium_risk',
    source_risk_level: 'medium',
    source_risk_score: 70,
    domains: englishKpopMediaMediumRiskDomains,
    notes: '英文 K-pop 媒体公开图文报道，只能作为同源 source package 改写素材。'
  },
  {
    type: 'high_risk_source',
    source_risk_level: 'high',
    source_risk_score: 40,
    domains: highRiskDomains,
    notes: '社区、粉丝站、搬运、来源不明或高争议来源，不能自动创建草稿。'
  }
];

function normalizeHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch (error) {
    return String(value || '').replace(/^www\./, '').toLowerCase();
  }
}

function urlMatchesDomain(sourceUrl, domain) {
  const normalizedUrl = String(sourceUrl || '').toLowerCase();
  const host = normalizeHost(sourceUrl);
  const normalizedDomain = String(domain || '').replace(/^www\./, '').toLowerCase();
  return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`) || normalizedUrl.includes(normalizedDomain);
}

function classifySourceByUrl(sourceUrl = '') {
  const matched = sourceRegistry.find((entry) => entry.domains.some((domain) => urlMatchesDomain(sourceUrl, domain)));
  if (!matched) return null;
  return {
    source_type: matched.type,
    type: matched.type,
    source_risk_level: matched.source_risk_level,
    source_risk_score: matched.source_risk_score,
    source_policy_result: matched.notes,
    label: matched.notes
  };
}

function getSearchableDomains(mode = 'broad') {
  const entries = mode === 'safe'
    ? sourceRegistry.filter((entry) => entry.type !== 'high_risk_source')
    : sourceRegistry;
  return entries.flatMap((entry) => entry.domains.map((domain) => ({
    domain,
    source_type: entry.type,
    source_risk_level: entry.source_risk_level
  })));
}

function parseLanguages(value = 'ko,en') {
  return String(value || 'ko,en').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function getSearchKeywords(languageValue = 'ko,en') {
  const languages = parseLanguages(languageValue);
  return [
    ...(languages.includes('ko') ? koreanKeywords : []),
    ...(languages.includes('en') ? englishKeywords : [])
  ];
}

function buildDomainSearchQueries({ mode = 'broad', language = 'ko,en', maxDomains = 50 } = {}) {
  const domains = getSearchableDomains(mode).slice(0, maxDomains);
  const keywords = getSearchKeywords(language);
  const queries = [];
  for (const source of domains) {
    for (const keyword of keywords.slice(0, 4)) {
      queries.push({
        query: `site:${source.domain} ${keyword}`,
        domain: source.domain,
        source_type: source.source_type,
        source_risk_level: source.source_risk_level
      });
    }
  }
  return queries;
}

module.exports = {
  sourceRegistry,
  officialLowRiskDomains,
  koreanMediaMediumRiskDomains,
  englishKpopMediaMediumRiskDomains,
  highRiskDomains,
  koreanKeywords,
  englishKeywords,
  classifySourceByUrl,
  getSearchableDomains,
  getSearchKeywords,
  buildDomainSearchQueries
};
