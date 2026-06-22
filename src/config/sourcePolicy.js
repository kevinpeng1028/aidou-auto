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
    type: 'high_risk_source',
    source_risk_level: 'high',
    scoreRange: [0, 59],
    keywords: [
      'high_risk_source', 'fan', 'fansite', 'repost', 'watermark', 'login', 'paywall', 'private',
      'forbidden', '饭拍', '粉丝站', '搬运', '图包', '水印', '禁止转载', '禁止复制', '付费', '登录'
    ],
    notes: '粉丝站、搬运、来源不明、带明显水印或需要绕过限制的高风险来源，只能进入素材线索或人工审核。'
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
    || sourcePolicies.find((policy) => policy.type === 'korean_media_medium_risk');
  const [min, max] = matched.scoreRange;

  return {
    source_type: matched.type,
    type: matched.type,
    source_risk_level: matched.source_risk_level,
    source_risk_score: max,
    score_range: { min, max },
    source_policy_result: matched.notes,
    label: matched.notes
  };
}

module.exports = { sourcePolicies, classifySource };
