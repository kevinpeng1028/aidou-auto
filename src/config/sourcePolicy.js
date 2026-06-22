const sourcePolicies = [
  {
    type: 'official_safe',
    source_risk_level: 'low',
    scoreRange: [95, 100],
    keywords: ['official', 'agency', 'entertainment', 'brand', 'organizer', 'press', 'newsroom', '官方', '官网', '品牌', '主办方'],
    notes: '官方、品牌、主办方或明确授权的公开来源。'
  },
  {
    type: 'licensed_or_partner_safe',
    source_risk_level: 'low',
    scoreRange: [90, 100],
    keywords: ['licensed', 'partner', '授权', '自有', '已确认'],
    notes: '已确认授权、合作方或自有素材来源。'
  },
  {
    type: 'media_medium',
    source_risk_level: 'medium',
    scoreRange: [60, 79],
    keywords: ['news', 'media', 'dispatch', 'osen', 'starnews', 'newsen', 'tenasia', 'naver', 'daum', '媒体', '新闻', '韩娱'],
    notes: '公开可访问媒体报道，可提取事实但需人工审核后发布。'
  },
  {
    type: 'fan_high_risk',
    source_risk_level: 'high',
    scoreRange: [0, 59],
    keywords: ['fan', 'fansite', 'repost', 'watermark', 'login', 'paywall', 'private', '饭拍', '粉丝站', '搬运', '图包', '水印', '禁止转载', '付费', '登录'],
    notes: '粉丝站、搬运、来源不明、带明显水印或需要绕过限制的高风险来源。'
  }
];

function textIncludesAny(text, keywords) {
  const normalized = String(text || '').toLowerCase();
  return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
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

  const matched = sourcePolicies.find((policy) => textIncludesAny(sourceText, policy.keywords))
    || sourcePolicies.find((policy) => policy.type === 'media_medium');
  const [min, max] = matched.scoreRange;

  return {
    source_type: matched.type,
    source_risk_level: matched.source_risk_level,
    source_risk_score: max,
    score_range: { min, max },
    source_policy_result: matched.notes
  };
}

module.exports = { sourcePolicies, classifySource };
