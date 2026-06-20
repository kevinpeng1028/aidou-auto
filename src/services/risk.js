const bannedPatterns = [
  '未证实恋情',
  '疑似恋情',
  '塌房',
  '整容',
  '身材走样',
  '私生活混乱',
  '爆料称',
  '网传',
  '辱骂',
  '撕',
  '引战'
];

function localRiskReview(text) {
  const hits = bannedPatterns.filter((word) => text.includes(word));
  const score = Math.max(60, 100 - hits.length * 12);
  const allowed = score >= 85;
  const report = [
    '# risk_report',
    '',
    `风险评分：${score}/100`,
    `是否允许创建草稿：${allowed ? '是' : '否'}`,
    '',
    `命中风险点：${hits.length ? hits.join('、') : '未命中明显禁区词'}`,
    '',
    `建议修改：${hits.length ? '删除未经证实、攻击性或引战表达，改为公开行程、舞台表现、造型观察和粉丝互动。' : '保持事实来源清晰，图片授权状态需人工确认。'}`
  ].join('\n');

  return { score, allowed, report, hits };
}

module.exports = { localRiskReview };
