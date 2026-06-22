const config = require('../config');
const { classifySource } = require('../config/sourcePolicy');

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function scoreFromImageEvaluation(imageEvaluation = {}) {
  const imageQuality = clampScore(imageEvaluation.image_quality_score || 0);
  const watermarkRisk = imageEvaluation.watermark_risk || 'unknown';
  if (watermarkRisk === 'low') return { imageCopyright: Math.max(80, imageQuality), watermark: 95 };
  if (watermarkRisk === 'medium') return { imageCopyright: Math.min(79, imageQuality), watermark: 65 };
  return { imageCopyright: Math.min(59, imageQuality), watermark: 40 };
}

function assessRewriteRisk(articleReview = {}) {
  const score = clampScore(articleReview.score || 0);
  if (score >= 90) return 95;
  if (score >= 85) return 88;
  if (score >= 60) return 65;
  return 40;
}

function assessPlatformCompliance(articleReview = {}) {
  const score = clampScore(articleReview.score || 0);
  if (score >= 90) return 95;
  if (score >= 75) return 82;
  if (score >= 40) return 55;
  return 30;
}

function assessImageArticleMatch(candidate = {}, imageEvaluation = {}) {
  if (!candidate.image_candidates?.length) return 70;
  if ((imageEvaluation.image_quality_score || 0) >= 85) return 90;
  return 75;
}

function getRiskLevel(overallRiskScore, sourceRiskLevel) {
  if (overallRiskScore >= 85 && sourceRiskLevel === 'low') return 'low';
  if (overallRiskScore >= 60) return 'medium';
  return 'high';
}

function assessMaterialRisk({ candidate = {}, imageEvaluation = {}, articleReview = {} } = {}) {
  const source = classifySource(candidate);
  const imageScores = scoreFromImageEvaluation(imageEvaluation);
  const sourceRiskScore = clampScore(source.source_risk_score);
  const imageCopyrightRiskScore = clampScore(imageScores.imageCopyright);
  const articleRewriteRiskScore = assessRewriteRisk(articleReview);
  const imageArticleMatchScore = assessImageArticleMatch(candidate, imageEvaluation);
  const watermarkRiskScore = clampScore(imageScores.watermark);
  const platformComplianceScore = assessPlatformCompliance(articleReview);

  const overallRiskScore = clampScore(
    sourceRiskScore * 0.25
    + imageCopyrightRiskScore * 0.25
    + articleRewriteRiskScore * 0.2
    + imageArticleMatchScore * 0.15
    + watermarkRiskScore * 0.1
    + platformComplianceScore * 0.05
  );
  const riskLevel = getRiskLevel(overallRiskScore, source.source_risk_level);

  return {
    risk_level: riskLevel,
    overall_risk_score: overallRiskScore,
    source_risk_score: sourceRiskScore,
    image_copyright_risk_score: imageCopyrightRiskScore,
    article_rewrite_risk_score: articleRewriteRiskScore,
    image_article_match_score: imageArticleMatchScore,
    watermark_risk_score: watermarkRiskScore,
    platform_compliance_score: platformComplianceScore,
    source_risk_level: source.source_risk_level,
    source_policy_result: source.source_policy_result,
    copyright_notes: imageEvaluation.image_quality_notes || source.source_policy_result,
    risk_snapshot_json: JSON.stringify({ source, imageEvaluation, articleReview })
  };
}

function decideAutomatedAction({ risk = {}, scores = {}, duplicateCheck = {}, hasCover = false, inlineImageCount = 0 } = {}) {
  if (duplicateCheck.duplicated) {
    return { status: 'skipped', auto_action_taken: 'none', auto_action_reason: duplicateCheck.reason, logTask: 'skipped_duplicate_person' };
  }

  const highRisk = risk.risk_level === 'high'
    || risk.source_risk_level === 'high'
    || risk.image_copyright_risk_score < 60
    || risk.article_rewrite_risk_score < 60
    || risk.watermark_risk_score < 60
    || risk.image_article_match_score < 70;
  if (highRisk) {
    return {
      status: 'skipped',
      auto_action_taken: 'blocked_high_risk',
      auto_action_reason: '高风险内容不得自动生成草稿或自动发布。',
      logTask: 'skipped_high_risk'
    };
  }

  if (risk.risk_level === 'medium') {
    const allowDraft = config.automation.allowMediumRiskDraft;
    return {
      status: allowDraft ? 'auto_draft_only' : 'review',
      auto_action_taken: allowDraft ? 'draft_allowed_review_required' : 'review_required',
      auto_action_reason: allowDraft ? '中风险：允许生成草稿，但必须人工审核后发布。' : '中风险：配置不允许自动生成草稿。',
      logTask: allowDraft ? 'auto_draft_created' : 'auto_publish_blocked'
    };
  }

  const lowRiskReady = risk.risk_level === 'low'
    && risk.source_risk_level === 'low'
    && (scores.total_score || 0) >= 90
    && risk.image_article_match_score >= 85
    && risk.image_copyright_risk_score >= 85
    && risk.article_rewrite_risk_score >= 85;

  if (!lowRiskReady || !hasCover || inlineImageCount < 1) {
    return {
      status: 'review',
      auto_action_taken: 'review_required',
      auto_action_reason: '低风险基础条件不足：需要总分、封面图、正文图和图文一致性达标。',
      logTask: 'auto_publish_blocked'
    };
  }

  return {
    status: 'ready',
    auto_action_taken: config.automation.autoPublishLowRisk ? 'auto_publish_blocked_by_project_policy' : 'draft_allowed_publish_manual',
    auto_action_reason: config.automation.autoPublishLowRisk
      ? '项目当前禁止自动发布：只允许创建草稿并人工发布。'
      : '低风险内容可进入草稿，AUTO_PUBLISH_LOW_RISK=false，等待人工发布。',
    logTask: config.automation.autoPublishLowRisk ? 'auto_publish_blocked' : 'auto_draft_created'
  };
}

module.exports = { assessMaterialRisk, decideAutomatedAction };
