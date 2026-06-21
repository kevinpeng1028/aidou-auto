const express = require('express');
const path = require('path');
const config = require('../config');
const { db, touchArticle } = require('../db');
const { generateArticle, auditArticle } = require('../services/openai');
const { exportArticlePackage } = require('../services/exporter');
const { downloadImage } = require('../services/images');
const { createDraftArticle } = require('../services/wechat');

const router = express.Router();

function getArticle(id) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}

function getArticleImages(articleId) {
  return db.prepare('SELECT * FROM images WHERE article_id = ? ORDER BY created_at DESC').all(articleId);
}

function nowText() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

async function ensureImageLocalPath(image) {
  if (image.local_path) return image;
  if (!image.url) {
    const error = new Error('图片缺少本地文件和外部 URL，请先手动上传/保存图片');
    error.errcode = 'IMAGE_SOURCE_MISSING';
    throw error;
  }

  try {
    const localPath = await downloadImage(image.url, image.source_note || image.usage_scene || `image-${image.id}`);
    db.prepare('UPDATE images SET local_path = ? WHERE id = ?').run(localPath, image.id);
    return { ...image, local_path: localPath };
  } catch (downloadError) {
    const error = new Error('图片下载失败，请先手动上传/保存图片');
    error.errcode = 'IMAGE_DOWNLOAD_FAILED';
    error.errmsg = downloadError.message;
    throw error;
  }
}

async function prepareWechatImages(images) {
  const coverImage = images.find((image) => image.usage_scene === '封面图');
  if (!coverImage) {
    const error = new Error('请先为文章选择封面图');
    error.errcode = 'COVER_IMAGE_REQUIRED';
    throw error;
  }

  const prepared = [];
  for (const image of images) {
    if (image.usage_scene === '封面图' || image.url || image.local_path) {
      prepared.push(await ensureImageLocalPath(image));
    } else {
      prepared.push(image);
    }
  }
  return prepared;
}

function formatWechatError(error) {
  return {
    message: '微信接口错误',
    errcode: error.errcode || 'UNKNOWN_ERROR',
    errmsg: error.errmsg || error.message || '未知错误',
    createdAt: nowText(),
    suggestions: ['AppID / AppSecret', 'IP白名单', '图片格式', '封面图']
  };
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
  const images = getArticleImages(article.id);
  const wechatDraftResult = req.session.wechatDraftResult;
  const wechatDraftError = req.session.wechatDraftError;
  delete req.session.wechatDraftResult;
  delete req.session.wechatDraftError;
  res.render('articles/show', { title: article.title, article, images, wechatDraftResult, wechatDraftError });
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

router.post('/articles/:id/wechat-draft', async (req, res) => {
  const article = getArticle(req.params.id);
  if (!article) {
    return res.status(404).render('error', { title: '未找到', message: '文章不存在' });
  }

  try {
    const images = await prepareWechatImages(getArticleImages(article.id));
    const mediaId = await createDraftArticle(article, images);
    const createdAt = nowText();
    req.session.wechatDraftResult = { mediaId, createdAt };
    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
      .run('wechat_draft_create', 'success', `文章 ${article.id} 已创建微信公众号草稿 media_id=${mediaId}`);
  } catch (error) {
    const formatted = formatWechatError(error);
    req.session.wechatDraftError = formatted;
    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
      .run('wechat_draft_create', 'failed', `文章 ${article.id} 创建微信公众号草稿失败 errcode=${formatted.errcode} errmsg=${formatted.errmsg}`);
  }

  return res.redirect(`/articles/${article.id}`);
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
