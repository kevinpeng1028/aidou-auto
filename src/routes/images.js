const express = require('express');
const { db } = require('../db');
const { downloadImage } = require('../services/images');

const router = express.Router();

router.get('/images', (req, res) => {
  const images = db.prepare(`
    SELECT images.*, articles.title AS article_title
    FROM images
    LEFT JOIN articles ON articles.id = images.article_id
    ORDER BY images.created_at DESC
  `).all();
  const articles = db.prepare('SELECT id, title FROM articles ORDER BY updated_at DESC').all();
  res.render('images/index', { title: '图片管理', images, articles });
});

router.post('/images', async (req, res, next) => {
  try {
    const { article_id, url, source_note, auth_status, risk_level, usage_scene } = req.body;
    let localPath = '';
    if (req.body.download === 'on') {
      localPath = await downloadImage(url, source_note || usage_scene || 'idol-image');
    }

    db.prepare(`
      INSERT INTO images (article_id, url, source_note, auth_status, risk_level, usage_scene, local_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      article_id || null,
      url,
      source_note || '',
      auth_status || '待确认',
      risk_level || '中',
      usage_scene || '文章内图',
      localPath
    );
    res.redirect('/images');
  } catch (error) {
    next(error);
  }
});

router.post('/images/:id/download', async (req, res, next) => {
  try {
    const image = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
    if (!image) return res.status(404).render('error', { title: '未找到', message: '图片不存在' });
    const localPath = await downloadImage(image.url, image.source_note || `image-${image.id}`);
    db.prepare('UPDATE images SET local_path = ? WHERE id = ?').run(localPath, image.id);
    res.redirect('/images');
  } catch (error) {
    next(error);
  }
});

router.post('/images/:id/delete', (req, res) => {
  db.prepare('DELETE FROM images WHERE id = ?').run(req.params.id);
  res.redirect('/images');
});

module.exports = router;
