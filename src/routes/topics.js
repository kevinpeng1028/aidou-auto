const express = require('express');
const { db } = require('../db');
const { generateTopics } = require('../services/openai');

const router = express.Router();

router.get('/topics', (req, res) => {
  const topics = db.prepare('SELECT * FROM topics ORDER BY created_at DESC').all();
  res.render('topics/index', { title: '选题池', topics, keyword: '' });
});

router.post('/topics/generate', async (req, res, next) => {
  try {
    const keyword = req.body.keyword || '今日爱豆动态';
    const topics = await generateTopics(keyword);
    const insert = db.prepare('INSERT INTO topics (keyword, title, angle) VALUES (?, ?, ?)');
    const insertMany = db.transaction((items) => {
      for (const item of items) insert.run(keyword, item.title, item.angle || '');
    });
    insertMany(topics);

    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
      .run('topic_generate', 'success', `已根据“${keyword}”生成 ${topics.length} 个候选选题`);
    res.redirect('/topics');
  } catch (error) {
    next(error);
  }
});

router.post('/topics/:id/status', (req, res) => {
  db.prepare('UPDATE topics SET status = ? WHERE id = ?').run(req.body.status || 'candidate', req.params.id);
  res.redirect('/topics');
});

router.post('/topics/:id/delete', (req, res) => {
  db.prepare('DELETE FROM topics WHERE id = ?').run(req.params.id);
  res.redirect('/topics');
});

module.exports = router;
