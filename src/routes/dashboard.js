const express = require('express');
const config = require('../config');
const { db } = require('../db');
const { generateDailyMaterials } = require('../services/dailyMaterial');

const router = express.Router();

router.get('/', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    articles: db.prepare('SELECT COUNT(*) AS count FROM articles').get().count,
    ready: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE status = 'ready'").get().count,
    review: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE status = 'review'").get().count,
    topics: db.prepare('SELECT COUNT(*) AS count FROM topics').get().count,
    images: db.prepare('SELECT COUNT(*) AS count FROM images').get().count,
    todayArticles: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE date(created_at) = date('now', 'localtime')").get().count,
    todayTopics: db.prepare("SELECT COUNT(*) AS count FROM topics WHERE date(created_at) = date('now', 'localtime')").get().count
  };
  const logs = db.prepare('SELECT * FROM task_logs ORDER BY created_at DESC LIMIT 8').all();
  const dailyMaterialResult = req.session.dailyMaterialResult;
  const dailyMaterialError = req.session.dailyMaterialError;
  delete req.session.dailyMaterialResult;
  delete req.session.dailyMaterialError;

  res.render('dashboard', {
    title: 'Dashboard',
    today,
    stats,
    logs,
    dailyMaterialResult,
    dailyMaterialError,
    system: {
      node: process.version,
      env: config.env,
      database: config.dbPath,
      openai: config.openaiApiKey ? '已配置' : '未配置，使用本地兜底生成',
      autoPublish: config.autoPublish
    }
  });
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
