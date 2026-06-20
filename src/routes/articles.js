const express = require('express');
const path = require('path');
const config = require('../config');
const { db, touchArticle } = require('../db');
const { generateArticle, auditArticle } = require('../services/openai');
const { exportArticlePackage } = require('../services/exporter');

const router = express.Router();

function getArticle(id) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}

router.get('/articles', (req, res) => {
  const articles = db.prepare('SELECT * FROM articles ORDER BY updated_at DESC').all();
  res.render('articles/index', { title: '文章库', articles });
});

router.get('/articles/new', (req, res) => {
  res.render('articles/form', {
    title: '新增文章',
    article: { title: '', keyword: '', markdown: '', status: 'draft' },
    action: '/articles'
  });
});

router.post('/articles', async (req, res, next) => {
  try {
    const { title, keyword, markdown, status } = req.body;
    const review = await auditArticle(markdown || '');
    const result = db.prepare(`
      INSERT INTO articles (title, keyword, markdown, status, risk_score, risk_report)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(title, keyword, markdown || '', status || 'draft', review.score, review.report);
    res.redirect(`/articles/${result.lastInsertRowid}`);
  } catch (error) {
    next(error);
  }
});

router.post('/articles/generate', async (req, res, next) => {
  try {
    const keyword = req.body.keyword || '今日爱豆动态';
    const generated = await generateArticle(keyword);
    const review = await auditArticle(generated.markdown);
    const result = db.prepare(`
      INSERT INTO articles (title, keyword, markdown, status, risk_score, risk_report)
      VALUES (?, ?, ?, 'draft', ?, ?)
    `).run(generated.title, keyword, generated.markdown, review.score, review.report);

    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
      .run('article_generate', 'success', `已根据“${keyword}”生成文章，风险分 ${review.score}`);
    res.redirect(`/articles/${result.lastInsertRowid}`);
  } catch (error) {
    next(error);
  }
});

router.get('/articles/:id', (req, res) => {
  const article = getArticle(req.params.id);
  if (!article) return res.status(404).render('error', { title: '未找到', message: '文章不存在' });
  const images = db.prepare('SELECT * FROM images WHERE article_id = ? ORDER BY created_at DESC').all(article.id);
  res.render('articles/show', { title: article.title, article, images });
});

router.get('/articles/:id/edit', (req, res) => {
  const article = getArticle(req.params.id);
  if (!article) return res.status(404).render('error', { title: '未找到', message: '文章不存在' });
  res.render('articles/form', { title: '编辑文章', article, action: `/articles/${article.id}` });
});

router.post('/articles/:id', async (req, res, next) => {
  try {
    const article = getArticle(req.params.id);
    if (!article) return res.status(404).render('error', { title: '未找到', message: '文章不存在' });

    const { title, keyword, markdown, status } = req.body;
    const review = await auditArticle(markdown || '');
    db.prepare(`
      UPDATE articles
      SET title = ?, keyword = ?, markdown = ?, status = ?, risk_score = ?, risk_report = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, keyword, markdown || '', status || 'draft', review.score, review.report, article.id);
    res.redirect(`/articles/${article.id}`);
  } catch (error) {
    next(error);
  }
});

router.post('/articles/:id/delete', (req, res) => {
  db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id);
  res.redirect('/articles');
});

router.post('/articles/:id/export', async (req, res, next) => {
  try {
    const article = getArticle(req.params.id);
    if (!article) return res.status(404).render('error', { title: '未找到', message: '文章不存在' });
    const images = db.prepare('SELECT * FROM images WHERE article_id = ? ORDER BY created_at ASC').all(article.id);
    const zipRelPath = await exportArticlePackage(article, images);
    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
      .run('export_package', 'success', `已导出素材包 ${zipRelPath}`);
    res.download(path.resolve(config.rootDir, zipRelPath));
  } catch (error) {
    next(error);
  }
});

router.post('/articles/:id/audit', async (req, res, next) => {
  try {
    const article = getArticle(req.params.id);
    if (!article) return res.status(404).render('error', { title: '未找到', message: '文章不存在' });
    const review = await auditArticle(article.markdown);
    db.prepare('UPDATE articles SET risk_score = ?, risk_report = ? WHERE id = ?').run(review.score, review.report, article.id);
    touchArticle(article.id);
    res.redirect(`/articles/${article.id}`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
