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
  'm.entertain.naver.com',
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
  'mk.co.kr',
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
  'sbsstar.net',
  'koreaherald.com',
  'koreatimes.co.kr',
  'kpopherald.koreaherald.com'
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
  '연예 화보',
  'K팝 컴백',
  '아이돌 사진',
  '아이돌 공항패션',
  '아이돌 브랜드 행사',
  '아이돌 무대',
  '아이돌 공식 사진',
  'K팝 화보',
  'K팝 근황',
  '아이돌 공개 사진'
];

const englishKeywords = [
  'K-pop idol photos',
  'K-pop comeback photos',
  'idol brand event',
  'idol photoshoot',
  'K-pop airport fashion',
  'K-pop official photos',
  'Korean idol update'
];

function makeSource(type, riskLevel, riskScore, domains, notes, priorityBase) {
  return domains.map((host, index) => ({
    source_type: type,
    type,
    host,
    domain: host,
    risk_level: riskLevel,
    source_risk_level: riskLevel,
    source_risk_score: riskScore,
    enabled: true,
    priority: priorityBase + index,
    notes
  }));
}

const sourceRegistry = [
  ...makeSource(
    'official_low_risk',
    'low',
    95,
    officialLowRiskDomains,
    '官方账号、经纪公司、品牌或主办方公开来源，仍需人工确认图片授权后使用。',
    10
  ),
  ...makeSource(
    'korean_media_medium_risk',
    'medium',
    75,
    koreanMediaMediumRiskDomains,
    '韩国娱乐媒体公开图文报道，只能在同一 source_url 内绑定文章和图片并改写。',
    100
  ),
  ...makeSource(
    'english_kpop_media_medium_risk',
    'medium',
    70,
    englishKpopMediaMediumRiskDomains,
    '英文 K-pop 媒体公开图文报道，只能作为同源 source package 改写素材。',
    200
  ),
  ...makeSource(
    'high_risk_source',
    'high',
    40,
    highRiskDomains,
    '社区、粉丝站、搬运、来源不明或高争议来源，不能自动创建草稿。',
    900
  )
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
  const matched = sourceRegistry.find((entry) => entry.enabled && urlMatchesDomain(sourceUrl, entry.host));
  if (!matched) return null;
  return {
    source_type: matched.source_type,
    type: matched.source_type,
    source_risk_level: matched.source_risk_level,
    source_risk_score: matched.source_risk_score,
    source_policy_result: matched.notes,
    label: matched.notes,
    host: matched.host,
    priority: matched.priority
  };
}

function isAllowedSourceUrl(sourceUrl = {}, { includeHighRisk = true } = {}) {
  const classified = classifySourceByUrl(sourceUrl);
  if (!classified) return false;
  if (!includeHighRisk && classified.source_risk_level === 'high') return false;
  return true;
}

function getSearchableDomains(mode = 'broad') {
  const includeHighRisk = mode === 'broad_with_high_risk';
  return sourceRegistry
    .filter((entry) => entry.enabled)
    .filter((entry) => includeHighRisk || entry.source_risk_level !== 'high')
    .sort((left, right) => left.priority - right.priority)
    .map((entry) => ({
      domain: entry.host,
      host: entry.host,
      source_type: entry.source_type,
      source_risk_level: entry.source_risk_level,
      priority: entry.priority
    }));
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
        query: `${keyword} site:${source.domain}`,
        domain: source.domain,
        host: source.host,
        source_type: source.source_type,
        source_risk_level: source.source_risk_level,
        priority: source.priority
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
  isAllowedSourceUrl,
  getSearchableDomains,
  getSearchKeywords,
  buildDomainSearchQueries,
  normalizeHost,
  urlMatchesDomain
};
