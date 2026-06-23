const { classifySourceByUrl } = require('./koreanMediaSources');

const sourcePolicies = [
  {
    type: 'official_low_risk',
    source_risk_level: 'low',
    scoreRange: [90, 100],
    keywords: [
      'official', 'agency', 'entertainment', 'company', 'label', 'brand', 'organizer',
      'press', 'newsroom', 'official_low_risk', '官方', '官网', '经纪公司', '品牌', '主办方', '授权'
    ],
    notes: '官方、品牌、活动主办方、公开新闻稿或明确授权的公开来源。'
  },
  {
    type: 'korean_media_medium_risk',
    source_risk_level: 'medium',
    scoreRange: [60, 79],
    keywords: [
      'korean_media_medium_risk', 'news', 'media', 'dispatch', 'osen', 'starnews', 'newsen',
      'tenasia', 'xportsnews', 'sportsseoul', 'naver', 'daum', 'nate', '媒体', '新闻', '韩娱', '韩国媒体', '资讯站'
    ],
    notes: '韩国娱乐媒体或公开可访问图文报道，可基于同一 source package 改写并生成草稿，但必须人工审核后发布。'
  },
  {
    type: 'english_kpop_media_medium_risk',
    source_risk_level: 'medium',
    scoreRange: [60, 75],
    keywords: [
      'english_kpop_media_medium_risk', 'soompi', 'allkpop', 'koreaboo', 'kpopherald', 'sbsstar',
      'english k-pop', 'english kpop', '英文', '英语', '海外韩娱媒体'
    ],
    notes: '英文 K-pop 媒体公开报道，可进入同源 source package 流程，但必须保留人工审核。'
  },
  {
    type: 'high_risk_source',
    source_risk_level: 'high',
    scoreRange: [0, 59],
    keywords: [
      'high_risk_source', 'fan', 'fansite', 'repost', 'watermark', 'login', 'paywall', 'private',
      'forbidden', 'theqoo', 'instiz', 'pann', 'dcinside', 'tiktok', 'pinterest', 'reddit',
      '饭拍', '粉丝站', '搬运', '图包', '水印', '禁止转载', '禁止复制', '付费', '登录'
    ],
    notes: '粉丝站、搬运、来源不明、带明显水印或需要绕过限制的高风险来源，只能进入素材线索或人工审核。'
  }
];

function textIncludesAny(text, keywords) {
  const normalized = String(text || '').toLowerCase();
  return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
}

function policyResult(policy, scoreOverride) {
  const [min, max] = policy.scoreRange;
  return {
    source_type: policy.type,
    type: policy.type,
    source_risk_level: policy.source_risk_level,
    source_risk_score: scoreOverride || max,
    score_range: { min, max },
    source_policy_result: policy.notes,
    label: policy.notes
  };
}

function classifySource(input = {}) {
  const sourceText = [
    input.source_type,
    input.source_name,
    input.source_url,
    input.source_note,
    input.license_status,
    input.auth_status
  ].filter(Boolean).join(' ');

  const highRisk = sourcePolicies.find((policy) => policy.type === 'high_risk_source' && textIncludesAny(sourceText, policy.keywords));
  if (highRisk) return policyResult(highRisk);

  const registryMatch = classifySourceByUrl(input.source_url || input.url || '');
  if (registryMatch) {
    const matchedPolicy = sourcePolicies.find((policy) => policy.type === registryMatch.source_type);
    if (matchedPolicy) return policyResult(matchedPolicy, registryMatch.source_risk_score);
  }

  const matched = sourcePolicies.find((policy) => textIncludesAny(sourceText, policy.keywords))
    || sourcePolicies.find((policy) => policy.type === 'korean_media_medium_risk');
  return policyResult(matched);
}

module.exports = { sourcePolicies, classifySource };
