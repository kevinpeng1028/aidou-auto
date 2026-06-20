const express = require('express');
const config = require('../config');
const { db } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    articles: db.prepare('SELECT COUNT(*) AS count FROM articles').get().count,
    topics: db.prepare('SELECT COUNT(*) AS count FROM topics').get().count,
    images: db.prepare('SELECT COUNT(*) AS count FROM images').get().count,
    todayArticles: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE date(created_at) = date('now', 'localtime')").get().count,
    todayTopics: db.prepare("SELECT COUNT(*) AS count FROM topics WHERE date(created_at) = date('now', 'localtime')").get().count
  };
  const logs = db.prepare('SELECT * FROM task_logs ORDER BY created_at DESC LIMIT 8').all();

  res.render('dashboard', {
    title: 'Dashboard',
    today,
    stats,
    logs,
    system: {
      node: process.version,
      env: config.env,
      database: config.dbPath,
      openai: config.openaiApiKey ? '已配置' : '未配置，使用本地兜底生成',
      autoPublish: config.autoPublish
    }
  });
});

module.exports = router;
