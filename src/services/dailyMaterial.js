const { db } = require('../db');
const { generateArticle, auditArticle } = require('./openai');
const { searchRecentTopics, isWithinLast24Hours } = require('./searchProvider');
const { evaluateImageSet } = require('./imageQuality');

function logTask(taskName, status, message) {
  db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
    .run(taskName, status, message);
}

function clampScore(value, max) {
  return Math.max(0, Math.min(max, Math.round(Number(value || 0))));
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function hasRecentIdolDuplicate(idolName) {
  if (!idolName) return { duplicated: false, reason: '' };
  const existing = db.prepare(`
    SELECT id, title, created_at FROM articles
    WHERE idol_name = ? AND datetime(created_at) >= datetime(?)
    ORDER BY created_at DESC LIMIT 1
  `).get(idolName, daysAgoIso(3));

  if (!existing) return { duplicated: false, reason: '' };
  return {
    duplicated: true,
    reason: `人物 ${idolName} 3 天内已出现：文章 #${existing.id} ${existing.title}`
  };
}

function hasTodayGroupDuplicate(groupName) {
  if (!groupName) return { duplicated: false, reason: '' };
  const existing = db.prepare(`
    SELECT id, title FROM articles
    WHERE group_name = ? AND date(created_at) = date('now', 'localtime')
    ORDER BY created_at DESC LIMIT 1
  `).get(groupName);

  if (!existing) return { duplicated: false, reason: '' };
  return {
    duplicated: true,
    reason: `组合 ${groupName} 今日已出现：文章 #${existing.id} ${existing.title}`
  };
}

function scoreCandidate(candidate, imageEvaluation, articleReview, generated) {
  const topicHeatScore = clampScore(
    candidate.source_count * 3 + candidate.social_signal + candidate.media_signal + candidate.audience_signal / 2,
    15
  );
  const freshnessScore = isWithinLast24Hours(candidate.source_published_at) ? 15 : 0;
  const imageQualityScore = clampScore(imageEvaluation.image_quality_score || 0, 15);
  const imageRelevanceScore = candidate.image_signal > 0 ? clampScore(7 + candidate.image_signal / 3, 10) : 0;
  const articleQualityScore = generated?.markdown ? 13 : 0;
  const predictedReadScore = clampScore(topicHeatScore * 0.45 + candidate.audience_signal * 0.7, 10);
  const riskScore = clampScore((articleReview.score || 0) / 10, 10);
  const antiAiScore = generated?.markdown ? 8 : 0;
  const totalScore = topicHeatScore + freshnessScore + imageQualityScore + imageRelevanceScore + articleQualityScore + predictedReadScore + riskScore + antiAiScore;

  return {
    topic_heat_score: topicHeatScore,
    freshness_score: freshnessScore,
    image_quality_score: imageQualityScore,
    image_relevance_score: imageRelevanceScore,
    article_quality_score: articleQualityScore,
    predicted_read_score: predictedReadScore,
    risk_score_dimension: riskScore,
    anti_ai_score: antiAiScore,
    total_score: totalScore
  };
}

function decideStatus(scores, duplicateCheck, imageEvaluation, articleReview) {
  if (duplicateCheck.duplicated) return 'skipped';
  if (scores.freshness_score < 12) return 'skipped';
  if ((imageEvaluation.image_quality_score || 0) < 85) return scores.total_score >= 80 ? 'review' : 'skipped';
  if (imageEvaluation.watermark_risk !== 'low') return 'review';
  if (scores.risk_score_dimension < 8 || (articleReview.score || 0) < 85) return 'review';
  if (scores.total_score >= 90) return 'ready';
  if (scores.total_score >= 80) return 'review';
  return 'rejected';
}

function buildScoreJson(candidate, scores, imageEvaluation, duplicateCheck, articleReview, status) {
  return JSON.stringify({
    ...scores,
    selected_reason: status === 'ready' ? '综合评分 90+，且满足新鲜度、图片质量、风险与去重规则。' : '未达到 ready 门槛，进入审核或跳过。',
    risk_notes: articleReview.report || '',
    image_quality_notes: imageEvaluation.image_quality_notes,
    duplicate_check_result: duplicateCheck.reason || '未命中 3 天人物重复或当日组合重复。',
    source_urls: [candidate.source_url].filter(Boolean),
    source_name: candidate.source_name,
    source_published_at: candidate.source_published_at,
    discovered_at: candidate.discovered_at,
    why_recent: candidate.why_recent,
    signals: {
      source_count: candidate.source_count,
      social_signal: candidate.social_signal,
      media_signal: candidate.media_signal,
      freshness_signal: candidate.freshness_signal,
      image_signal: candidate.image_signal,
      audience_signal: candidate.audience_signal
    }
  });
}

function insertTopic(candidate, status) {
  return db.prepare('INSERT INTO topics (keyword, title, angle, status) VALUES (?, ?, ?, ?)')
    .run(candidate.keyword, candidate.title, candidate.angle, status).lastInsertRowid;
}

function insertArticle(candidate, generated, articleReview, status, scoresJson) {
  return db.prepare(`
    INSERT INTO articles (
      title, keyword, markdown, status, risk_score, risk_report,
      idol_name, group_name, material_scores_json, source_url, source_name,
      source_published_at, discovered_at, selected_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generated.title,
    candidate.keyword,
    generated.markdown,
    status,
    articleReview.score,
    articleReview.report,
    candidate.idol_name,
    candidate.group_name,
    scoresJson,
    candidate.source_url,
    candidate.source_name,
    candidate.source_published_at,
    candidate.discovered_at,
    JSON.parse(scoresJson).selected_reason
  ).lastInsertRowid;
}

async function processCandidate(candidate) {
  if (!isWithinLast24Hours(candidate.source_published_at)) {
    logTask('candidate_skipped_old', 'skipped', `${candidate.title} 不在最近 24 小时内`);
    insertTopic(candidate, 'skipped');
    return { status: 'skipped', reason: 'old', candidate };
  }

  const idolDuplicate = hasRecentIdolDuplicate(candidate.idol_name);
  const groupDuplicate = hasTodayGroupDuplicate(candidate.group_name);
  const duplicateCheck = idolDuplicate.duplicated ? idolDuplicate : groupDuplicate;
  if (duplicateCheck.duplicated) {
    logTask('candidate_skipped_duplicate', 'skipped', duplicateCheck.reason);
  }

  insertTopic(candidate, duplicateCheck.duplicated ? 'skipped' : 'candidate');

  const imageEvaluation = await evaluateImageSet([]);
  if (!candidate.image_candidates.length) {
    logTask('candidate_skipped_no_images', 'skipped', `${candidate.title} 没有可用图片，进入 skipped`);
  }

  let generated;
  let articleReview = { score: 0, report: '文章未生成' };
  try {
    generated = await generateArticle(`${candidate.keyword}\nsource_url:${candidate.source_url}\nsource_published_at:${candidate.source_published_at}\nwhy_recent:${candidate.why_recent}`);
    articleReview = await auditArticle(generated.markdown);
    logTask('article_generated', 'success', `${candidate.title} 已生成文章`);
  } catch (error) {
    generated = { title: candidate.title, markdown: '' };
    articleReview = { score: 0, report: error.message };
    logTask('article_failed_validation', 'failed', `${candidate.title} 文章生成失败：${error.message}`);
  }

  const scores = scoreCandidate(candidate, imageEvaluation, articleReview, generated);
  const status = decideStatus(scores, duplicateCheck, imageEvaluation, articleReview);
  const scoresJson = buildScoreJson(candidate, scores, imageEvaluation, duplicateCheck, articleReview, status);
  const articleId = insertArticle(candidate, generated, articleReview, status, scoresJson);

  logTask('candidate_scored', status, `${candidate.title} total_score=${scores.total_score} status=${status}`);
  if (status === 'ready') logTask('material_ready', 'success', `文章 #${articleId} 进入 ready 素材库`);
  if (status === 'review') logTask('material_review', 'review', `文章 #${articleId} 进入人工审核`);
  if (status === 'rejected' || status === 'skipped') logTask('material_rejected', status, `文章 #${articleId} 未进入 ready`);

  return { status, articleId, scores, candidate };
}

async function generateDailyMaterials() {
  logTask('search_started', 'started', '开始搜索最近 24 小时 K-pop / 爱豆内容');
  const candidates = await searchRecentTopics();
  if (!candidates.length) {
    logTask('candidate_found', 'empty', '未找到最近 24 小时内可确认的新内容');
    return { created: 0, ready: 0, review: 0, skipped: 0, rejected: 0, results: [] };
  }

  logTask('candidate_found', 'success', `找到 ${candidates.length} 个候选选题`);
  const sorted = [...candidates].sort((a, b) => {
    const left = a.source_count + a.social_signal + a.media_signal + a.freshness_signal + a.audience_signal;
    const right = b.source_count + b.social_signal + b.media_signal + b.freshness_signal + b.audience_signal;
    return right - left;
  });

  const results = [];
  for (const candidate of sorted.slice(0, 5)) {
    results.push(await processCandidate(candidate));
  }

  return {
    created: results.filter((item) => item.articleId).length,
    ready: results.filter((item) => item.status === 'ready').length,
    review: results.filter((item) => item.status === 'review').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    rejected: results.filter((item) => item.status === 'rejected').length,
    results
  };
}

module.exports = { generateDailyMaterials };
