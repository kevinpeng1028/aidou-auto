const express = require('express');
const config = require('../config');
const { db } = require('../db');
const { generateDailyMaterials } = require('../services/dailyMaterial');
const { generateDailyCandidates } = require('../services/dailyCandidateSelector');

const router = express.Router();

function countLog(taskName) {
  return db.prepare("SELECT COUNT(*) AS count FROM task_logs WHERE task_name = ? AND date(created_at) = date('now', 'localtime')").get(taskName).count;
}

router.get('/', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    articles: db.prepare('SELECT COUNT(*) AS count FROM articles').get().count,
    ready: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE status = 'ready'").get().count,
    review: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE status = 'review'").get().count,
    autoDraftOnly: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE status = 'auto_draft_only'").get().count,
    skipped: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE status = 'skipped'").get().count,
    topics: db.prepare('SELECT COUNT(*) AS count FROM topics').get().count,
    candidatesToday: db.prepare("SELECT COUNT(*) AS count FROM daily_candidates WHERE run_date = date('now', 'localtime')").get().count,
    selectedCandidateToday: db.prepare("SELECT COUNT(*) AS count FROM daily_candidates WHERE status = 'selected_candidate' AND run_date = date('now', 'localtime')").get().count,
    images: db.prepare('SELECT COUNT(*) AS count FROM images').get().count,
    todayArticles: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE date(created_at) = date('now', 'localtime')").get().count,
    todayTopics: db.prepare("SELECT COUNT(*) AS count FROM topics WHERE date(created_at) = date('now', 'localtime')").get().count,
    todayLowRiskReady: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE risk_level = 'low' AND status IN ('ready', 'selected_candidate') AND date(created_at) = date('now', 'localtime')").get().count,
    todayMediumDrafts: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE risk_level = 'medium' AND status IN ('auto_draft_only', 'review', 'selected_candidate') AND date(created_at) = date('now', 'localtime')").get().count,
    todayHighSkipped: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE risk_level = 'high' AND status IN ('skipped', 'review', 'selected_candidate') AND date(created_at) = date('now', 'localtime')").get().count,
    todayDraftCreated: countLog('auto_draft_created'),
    todayPublishAllowed: countLog('auto_publish_allowed'),
    todayPublishBlocked: countLog('auto_publish_blocked') + countLog('auto_publish_blocked_dry_run'),
    todayPublished: countLog('auto_published')
  };
  const logs = db.prepare('SELECT * FROM task_logs ORDER BY created_at DESC LIMIT 8').all();
  const dailyMaterialResult = req.session.dailyMaterialResult;
  const dailyMaterialError = req.session.dailyMaterialError;
  const dailyCandidateResult = req.session.dailyCandidateResult;
  const dailyCandidateError = req.session.dailyCandidateError;
  delete req.session.dailyMaterialResult;
  delete req.session.dailyMaterialError;
  delete req.session.dailyCandidateResult;
  delete req.session.dailyCandidateError;

  res.render('dashboard', {
    title: 'Dashboard',
    today,
    stats,
    logs,
    dailyMaterialResult,
    dailyMaterialError,
    dailyCandidateResult,
    dailyCandidateError,
    automation: config.automation,
    system: {
      node: process.version,
      env: config.env,
      database: config.dbPath,
      openai: config.openaiApiKey ? '已配置' : '未配置，使用本地兜底生成',
      autoPublish: config.autoPublish
    }
  });
});

router.post('/daily-candidates/generate', async (req, res) => {
  try {
    req.session.dailyCandidateResult = await generateDailyCandidates();
  } catch (error) {
    req.session.dailyCandidateError = {
      message: error.message || '生成每日候选失败',
      code: error.code || 'DAILY_CANDIDATES_FAILED'
    };
    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
      .run('daily_candidates_failed', 'failed', req.session.dailyCandidateError.message);
  }

  res.redirect('/');
});

router.post('/daily-materials/generate', async (req, res) => {
  try {
    req.session.dailyMaterialResult = await generateDailyMaterials();
  } catch (error) {
    req.session.dailyMaterialError = {
      message: error.message || '生成今日素材失败',
      code: error.code || 'DAILY_MATERIAL_FAILED'
    };
    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
      .run('daily_material_failed', 'failed', req.session.dailyMaterialError.message);
  }

  res.redirect('/');
});

module.exports = router;
