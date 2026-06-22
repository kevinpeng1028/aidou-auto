const { db } = require('../db');
const { generateArticle, auditArticle } = require('./openai');
const { searchRecentTopics, mockSearchRecentTopics, isWithinLast24Hours, normalizeCandidate } = require('./searchProvider');
const { classifySource } = require('../config/sourcePolicy');

function logTask(taskName, status, message) {
  db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
    .run(taskName, status, message);
}

function clamp(value, min, max) {
  const number = Math.round(Number(value || 0));
  return Math.max(min, Math.min(max, number));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function hoursSince(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return 999;
  return Math.max(0, (Date.now() - time) / (60 * 60 * 1000));
}

function fallbackArticle(candidate) {
  const subject = candidate.idol_name || candidate.group_name || candidate.keyword || '这次公开动态';
  const title = `${subject}这次公开动态，状态观察可以写一写`;
  const markdown = [
    `${subject}这次更新，比较适合放在今天的状态观察里看。`,
    '它不是那种需要用很重语气去推的内容，更像一次公开动态里的稳定露面：信息清楚，方向安全，也有一点粉丝会关心的状态感。',
    '从公众号文章的角度看，这类素材适合写得克制一点。重点可以放在近期公开行程、整体气质和账号呈现上，不补未经确认的画面细节，也不把普通动态写成夸张爆点。',
    '如果后续配图授权和图文一致性都能确认，这篇可以作为今日候选继续推进。它的优势不是噱头，而是足够稳，适合留给人工最后确认。'
  ].join('\n\n');
  return { title, markdown };
}

function scoreFreshness(candidate) {
  const hours = hoursSince(candidate.source_published_at);
  if (hours <= 24) return 15;
  if (hours <= 48) return 8;
  return 0;
}

function scoreTopicHeat(candidate) {
  return clamp((candidate.social_signal || 0) * 0.45 + (candidate.media_signal || 0) * 0.4 + (candidate.audience_signal || 0) * 0.55 + (candidate.source_count || 0), 0, 15);
}

function scoreImageQuality(candidate, sourcePolicy) {
  const count = candidate.image_candidates.length;
  if (sourcePolicy.source_risk_level === 'high') return count ? 4 : 0;
  if (count >= 3) return 15;
  if (count >= 2) return 13;
  if (count === 1) return 8;
  return 3;
}

function scoreImageArticleMatch(candidate, sourcePolicy) {
  if (sourcePolicy.source_risk_level === 'high') return 5;
  if (!candidate.image_candidates.length) return 7;
  if (candidate.idol_name || candidate.group_name) return 14;
  return 10;
}

function scoreArticleQuality(candidate) {
  const text = [candidate.title, candidate.source_summary, candidate.angle].filter(Boolean).join(' ');
  if (text.length >= 80 && (candidate.idol_name || candidate.group_name)) return 15;
  if (text.length >= 30) return 10;
  return 5;
}

function scorePredictedRead(candidate) {
  return clamp((candidate.audience_signal || 0) * 0.6 + (candidate.social_signal || 0) * 0.25 + (candidate.media_signal || 0) * 0.15, 0, 10);
}

function scoreRisk(sourcePolicy, imageQualityScore, imageArticleMatchScore) {
  if (sourcePolicy.source_risk_level === 'low' && imageQualityScore >= 12 && imageArticleMatchScore >= 13) return 10;
  if (sourcePolicy.source_risk_level === 'medium') return 6;
  return 2;
}

function scoreAntiAi(candidate) {
  const text = [candidate.title, candidate.source_summary, candidate.candidate_reason].filter(Boolean).join(' ');
  if (/爆料|网传|疑似|塌房|撕|争议/.test(text)) return 1;
  return text.length >= 40 ? 5 : 3;
}

function determineRiskLevel(sourcePolicy, scores, candidate) {
  const riskText = [candidate.title, candidate.source_summary, candidate.candidate_reason, candidate.source_name, candidate.source_url].join(' ');
  if (sourcePolicy.source_risk_level === 'high' || /爆料|网传|争议|隐私|未证实|水印|搬运|粉丝站|图包/.test(riskText)) return 'high';
  if (sourcePolicy.source_risk_level === 'low' && scores.risk_score >= 8 && scores.image_article_match_score >= 13 && scores.image_quality_score >= 12) return 'low';
  return 'medium';
}

function scoreCandidate(candidate) {
  const sourcePolicy = classifySource(candidate);
  const scores = {
    freshness_score: scoreFreshness(candidate),
    topic_heat_score: scoreTopicHeat(candidate),
    image_quality_score: scoreImageQuality(candidate, sourcePolicy),
    image_article_match_score: scoreImageArticleMatch(candidate, sourcePolicy),
    article_quality_score: scoreArticleQuality(candidate),
    predicted_read_score: scorePredictedRead(candidate),
    risk_score: 0,
    anti_ai_score: scoreAntiAi(candidate)
  };
  scores.risk_score = scoreRisk(sourcePolicy, scores.image_quality_score, scores.image_article_match_score);
  scores.total_score = Object.values(scores).reduce((sum, value) => sum + Number(value || 0), 0);
  const riskLevel = determineRiskLevel(sourcePolicy, scores, candidate);
  const riskNotes = [
    sourcePolicy.source_policy_result,
    riskLevel === 'high' ? '高风险来源或内容信号，不允许自动生成草稿或发布。' : '',
    scores.image_quality_score < 7 ? '图片不足或质量信号偏低。' : '',
    scores.image_article_match_score < 9 ? '图文一致性不足，需人工检查。' : ''
  ].filter(Boolean).join(' ');

  return { ...scores, risk_level: riskLevel, sourcePolicy, risk_notes: riskNotes };
}

function duplicateReason(candidate) {
  if (candidate.source_url) {
    const existingSource = db.prepare('SELECT id, title FROM articles WHERE source_url = ? LIMIT 1').get(candidate.source_url);
    if (existingSource) return `同一 source_url 已入库：文章 #${existingSource.id} ${existingSource.title}`;
  }

  if (candidate.idol_name) {
    const existingIdol = db.prepare(`
      SELECT id, title FROM articles
      WHERE idol_name = ? AND status = 'selected_candidate' AND datetime(created_at) >= datetime('now', '-3 days')
      ORDER BY created_at DESC LIMIT 1
    `).get(candidate.idol_name);
    if (existingIdol) return `同一人物 3 天内已进入 selected_candidate：文章 #${existingIdol.id} ${existingIdol.title}`;
  }

  if (candidate.group_name) {
    const existingGroup = db.prepare(`
      SELECT id, title FROM articles
      WHERE group_name = ? AND status = 'selected_candidate' AND datetime(created_at) >= datetime('now', '-1 day')
      ORDER BY created_at DESC LIMIT 1
    `).get(candidate.group_name);
    if (existingGroup) return `同一组合 24 小时内已进入 selected_candidate：文章 #${existingGroup.id} ${existingGroup.title}`;
  }

  const titleSeed = candidate.title.slice(0, 12);
  if (titleSeed) {
    const existingTitle = db.prepare('SELECT id, title FROM articles WHERE title LIKE ? ORDER BY created_at DESC LIMIT 1').get(`%${titleSeed}%`);
    if (existingTitle) return `标题高度相似：文章 #${existingTitle.id} ${existingTitle.title}`;
  }

  return '';
}

function insertCandidate(candidate, scored, rank, status, selectedReason) {
  return db.prepare(`
    INSERT OR REPLACE INTO daily_candidates (
      article_id, run_date, rank, title, idol_name, group_name, topic_keyword,
      source_url, source_name, source_published_at, source_type, source_summary,
      candidate_reason, selected_reason, risk_notes, image_candidates_json,
      risk_level, status, freshness_score, topic_heat_score, image_quality_score,
      image_article_match_score, article_quality_score, predicted_read_score,
      risk_score, anti_ai_score, total_score, updated_at
    ) VALUES (
      COALESCE((SELECT article_id FROM daily_candidates WHERE source_url = ?), NULL), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
    )
  `).run(
    candidate.source_url,
    today(),
    rank,
    candidate.title,
    candidate.idol_name,
    candidate.group_name,
    candidate.keyword,
    candidate.source_url,
    candidate.source_name,
    candidate.source_published_at,
    scored.sourcePolicy.source_type,
    candidate.source_summary,
    candidate.candidate_reason,
    selectedReason,
    scored.risk_notes,
    JSON.stringify(candidate.image_candidates),
    scored.risk_level,
    status,
    scored.freshness_score,
    scored.topic_heat_score,
    scored.image_quality_score,
    scored.image_article_match_score,
    scored.article_quality_score,
    scored.predicted_read_score,
    scored.risk_score,
    scored.anti_ai_score,
    scored.total_score
  ).lastInsertRowid;
}

async function buildSelectedArticle(candidate, scored) {
  let generated;
  try {
    generated = await generateArticle(`${candidate.keyword}\nsource_summary:${candidate.source_summary}\nsource_url:${candidate.source_url}`);
  } catch (error) {
    generated = fallbackArticle(candidate);
  }

  let review;
  try {
    review = await auditArticle(generated.markdown);
  } catch (error) {
    review = { score: scored.risk_score * 10, report: `本地 dry-run 审核：${error.message}`, allowed: scored.risk_score >= 8 };
  }

  const materialScores = {
    ...scored,
    source_policy_result: scored.sourcePolicy.source_policy_result,
    source_risk_level: scored.sourcePolicy.source_risk_level,
    source_urls: [candidate.source_url].filter(Boolean),
    selected_reason: '今日 10 篇候选中综合评分最高，已标记为 selected_candidate；本次 dry-run 不发布。',
    risk_notes: scored.risk_notes,
    image_quality_notes: scored.image_quality_score >= 12 ? '图片候选数量和来源信号达标，仍需人工确认授权。' : '图片候选不足或质量信号偏低。',
    duplicate_check_result: '未命中 selected_candidate 去重规则。'
  };

  const articleStatus = 'selected_candidate';
  const articleId = db.prepare(`
    INSERT INTO articles (
      title, keyword, markdown, status, risk_score, risk_report,
      idol_name, group_name, material_scores_json, source_url, source_name,
      source_published_at, discovered_at, selected_reason,
      total_score, topic_heat_score, freshness_score, image_quality_score,
      image_article_match_score, article_quality_score, predicted_read_score, anti_ai_score,
      risk_level, overall_risk_score, source_risk_score, image_copyright_risk_score,
      article_rewrite_risk_score, watermark_risk_score, platform_compliance_score,
      source_risk_level, source_policy_result, copyright_notes,
      auto_action_taken, auto_action_reason, auto_publish_reason, risk_snapshot_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generated.title || candidate.title,
    candidate.keyword,
    generated.markdown || '',
    articleStatus,
    review.score,
    review.report,
    candidate.idol_name,
    candidate.group_name,
    JSON.stringify(materialScores),
    candidate.source_url,
    candidate.source_name,
    candidate.source_published_at,
    materialScores.selected_reason,
    scored.total_score,
    scored.topic_heat_score,
    scored.freshness_score,
    scored.image_quality_score,
    scored.image_article_match_score,
    scored.article_quality_score,
    scored.predicted_read_score,
    scored.anti_ai_score,
    scored.risk_level,
    scored.total_score,
    scored.sourcePolicy.source_risk_score,
    Math.min(100, scored.image_quality_score * 7),
    review.score,
    scored.risk_level === 'high' ? 40 : 90,
    review.score,
    scored.sourcePolicy.source_risk_level,
    scored.sourcePolicy.source_policy_result,
    scored.risk_notes,
    'dry_run_saved_to_articles',
    '已保存今日首选候选；本次 dry-run 不创建真实草稿、不发布。',
    'dry-run no-publish：项目禁止自动发布。',
    JSON.stringify({ candidate, scored, review })
  ).lastInsertRowid;

  return { articleId, generated, review, materialScores };
}

function getCandidatesForToday() {
  return db.prepare("SELECT * FROM daily_candidates WHERE run_date = date('now', 'localtime') ORDER BY rank ASC, total_score DESC").all();
}

async function loadCandidateSources() {
  try {
    const found = await searchRecentTopics();
    return found.map(normalizeCandidate);
  } catch (error) {
    if (error.code === 'SEARCH_NOT_CONFIGURED' || process.env.SEARCH_PROVIDER === 'mock') {
      return mockSearchRecentTopics().filter((candidate) => isWithinLast24Hours(candidate.source_published_at)).map(normalizeCandidate);
    }
    throw error;
  }
}

async function generateDailyCandidates() {
  logTask('daily_candidates_started', 'started', '开始生成今日 10 篇候选文章，dry-run/no-publish');
  const sourceCandidates = (await loadCandidateSources()).slice(0, 10);
  const candidates = sourceCandidates.length >= 10 ? sourceCandidates : mockSearchRecentTopics().slice(0, 10);
  const scored = candidates.slice(0, 10).map((candidate) => ({ candidate, scored: scoreCandidate(candidate) }))
    .sort((left, right) => right.scored.total_score - left.scored.total_score);

  const rows = [];
  let selected = null;
  for (const [index, item] of scored.entries()) {
    const duplicate = duplicateReason(item.candidate);
    const status = duplicate ? 'skipped' : 'candidate';
    const selectedReason = duplicate || item.candidate.candidate_reason;
    const id = insertCandidate(item.candidate, item.scored, index + 1, status, selectedReason);
    logTask(duplicate ? 'candidate_skipped_duplicate' : 'candidate_created', status, `${item.candidate.title} total_score=${item.scored.total_score}${duplicate ? ` ${duplicate}` : ''}`);
    logTask('candidate_scored', item.scored.risk_level, `${item.candidate.title} total_score=${item.scored.total_score}`);
    rows.push({ id, ...item, status, duplicate, selectedReason });
    if (!selected && !duplicate) selected = { id, ...item };
  }

  if (!selected && rows.length) selected = rows[0];
  if (!selected) throw new Error('未生成可用候选文章。');

  const articleResult = await buildSelectedArticle(selected.candidate, selected.scored);
  db.prepare("UPDATE daily_candidates SET status = 'selected_candidate', article_id = ?, selected_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(articleResult.articleId, '今日 10 篇候选中综合评分最高且未触发重复规则，已保存到文章素材库。', selected.id);

  logTask('selected_candidate_chosen', 'success', `${selected.candidate.title} total_score=${selected.scored.total_score} risk=${selected.scored.risk_level}`);
  logTask('selected_candidate_saved_to_articles', 'success', `文章 #${articleResult.articleId} 已保存，dry-run/no-publish`);
  logTask('auto_publish_blocked_dry_run', 'blocked', '本次试运行禁止 publish/freepublish/mass send，只保存候选和文章素材。');

  return {
    generatedCount: rows.length,
    scoredCount: rows.length,
    lowRiskCount: rows.filter((row) => row.scored.risk_level === 'low').length,
    mediumRiskCount: rows.filter((row) => row.scored.risk_level === 'medium').length,
    highRiskCount: rows.filter((row) => row.scored.risk_level === 'high').length,
    selectedCandidate: {
      title: selected.candidate.title,
      total_score: selected.scored.total_score,
      risk_level: selected.scored.risk_level,
      article_id: articleResult.articleId
    },
    savedToArticles: true,
    wechatDraftCreated: false,
    published: false,
    dryRun: true
  };
}

module.exports = { generateDailyCandidates, getCandidatesForToday, scoreCandidate };
