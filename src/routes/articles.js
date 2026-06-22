const express = require('express');
const path = require('path');
const config = require('../config');
const { db, touchArticle } = require('../db');
const { generateArticle, auditArticle } = require('../services/openai');
const { exportArticlePackage } = require('../services/exporter');
const { resolveArticleImageAssociations } = require('../services/articleImages');
const { createDraftArticle, uploadInlineImage } = require('../services/wechat');
const { renderWechatArticleHtml } = require('../services/wechatTemplateRenderer');

const router = express.Router();
const materialStatuses = ['ready', 'review', 'rejected', 'skipped', 'archived'];

function getArticle(id) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}

function getArticleImages(articleId) {
  return db.prepare('SELECT * FROM images WHERE article_id = ? ORDER BY created_at DESC').all(articleId);
}

function parseMaterialScores(article) {
  try {
    return JSON.parse(article.material_scores_json || '{}');
  } catch (error) {
    return {};
  }
}

function firstPresent(values, fallback = '') {
  return values.find((value) => String(value || '').trim()) || fallback;
}

function getMaterialReason(article) {
  const scores = parseMaterialScores(article);
  if (article.status === 'skipped') {
    return firstPresent([
      scores.duplicate_check_result,
      scores.image_quality_notes,
      scores.risk_notes,
      scores.selected_reason,
      article.selected_reason
    ], '未记录原因，请检查日志');
  }

  return firstPresent([
    scores.selected_reason,
    article.selected_reason,
    scores.risk_notes,
    scores.image_quality_notes
  ], '-');
}

function getSkippedNotice(article, materialScores) {
  if (article.status !== 'skipped') return null;
  const text = [
    materialScores.duplicate_check_result,
    materialScores.image_quality_notes,
    materialScores.risk_notes,
    materialScores.selected_reason,
    article.selected_reason,
    materialScores.source_name
  ].filter(Boolean).join(' ');

  if (text.includes('人物') && (text.includes('3 天') || text.includes('3天') || text.includes('重复'))) {
    return '3天内人物重复';
  }
  if (text.toLowerCase().includes('mock')) {
    return '当前为 mock 测试模式，无法确认真实热度';
  }
  if (text.includes('图片') || text.includes('分辨率') || text.includes('水印') || text.includes('未找到可用图片')) {
    return '图片不足或图片质量未达标';
  }
  return '未记录明确跳过原因';
}

function nowText() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function syncArticleImageFields(article, coverImage, inlineImageIds) {
  if (coverImage) article.cover_image_id = coverImage.id;
  article.inline_image_ids = JSON.stringify(inlineImageIds || []);
}

function resolveArticleImages(article) {
  const { coverImage, inlineImages, inlineImageIds } = resolveArticleImageAssociations(article);
  syncArticleImageFields(article, coverImage, inlineImageIds);
  return { coverImage, inlineImages, inlineImageIds };
}

function getWechatDraftImages(article) {
  const { coverImage, inlineImages, inlineImageIds } = resolveArticleImages(article);

  if (!article.cover_image_id || !coverImage) {
    const error = new Error('请先上传或选择封面图');
    error.errcode = 'COVER_IMAGE_REQUIRED';
    error.errmsg = '请先上传或选择封面图';
    throw error;
  }

  if (!coverImage.local_path) {
    const error = new Error('封面图本地文件不存在');
    error.errcode = 'LOCAL_IMAGE_MISSING';
    error.errmsg = '封面图本地文件不存在';
    throw error;
  }

  const localInlineImages = inlineImages.filter((image) => image.local_path);
  return {
    images: [coverImage, ...localInlineImages],
    coverImage,
    inlineImages: localInlineImages,
    inlineImageIds,
    note: localInlineImages.length ? '' : '当前没有正文图'
  };
}

function withLocalPreviewUrls(images) {
  return images.map((image) => ({
    ...image,
    previewUrl: image.local_path ? `/${String(image.local_path).replace(/^\/+/, '')}` : '',
    localUrl: image.local_path ? `/${String(image.local_path).replace(/^\/+/, '')}` : ''
  }));
}

function renderPreviewHtml(article, inlineImages) {
  return renderWechatArticleHtml({
    article,
    inlineImages: withLocalPreviewUrls(inlineImages),
    templateId: article.wechat_template_id || article.template_id
  });
}

async function renderDraftHtml(article, inlineImages) {
  const uploadedImages = [];
  for (const image of inlineImages) {
    const wechatUrl = await uploadInlineImage(image.local_path);
    uploadedImages.push({ ...image, wechatUrl });
  }

  return renderWechatArticleHtml({
    article,
    inlineImages: uploadedImages,
    templateId: article.wechat_template_id || article.template_id
  });
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
  const status = materialStatuses.includes(req.query.status) ? req.query.status : '';
  const articles = status
    ? db.prepare('SELECT * FROM articles WHERE status = ? ORDER BY updated_at DESC').all(status)
    : db.prepare('SELECT * FROM articles ORDER BY updated_at DESC').all();
  const articlesWithReasons = articles.map((article) => ({
    ...article,
    material_reason: getMaterialReason(article)
  }));
  res.render('articles/index', { title: '文章库', articles: articlesWithReasons, status, materialStatuses });
});

router.get('/articles/new', (req, res) => {
  res.render('articles/form', {
    title: '新增文章',
    article: { title: '', keyword: '', markdown: '', status: 'draft' },
    materialReason: '',
    skippedNotice: null,
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
  const { coverImage, inlineImages } = resolveArticleImages(article);
  const materialScores = parseMaterialScores(article);
  const skippedNotice = getSkippedNotice(article, materialScores);
  const materialReason = getMaterialReason(article);
  const wechatDraftResult = req.session.wechatDraftResult;
  const wechatDraftError = req.session.wechatDraftError;
  delete req.session.wechatDraftResult;
  delete req.session.wechatDraftError;
  res.render('articles/show', {
    title: article.title,
    article,
    images,
    coverImage,
    inlineImages,
    materialScores,
    materialReason,
    skippedNotice,
    wechatDraftResult,
    wechatDraftError
  });
});

router.get('/articles/:id/wechat-preview', (req, res) => {
  const article = getArticle(req.params.id);
  if (!article) return res.status(404).render('error', { title: '未找到', message: '文章不存在' });

  const { inlineImages } = resolveArticleImages(article);
  const rendered = renderPreviewHtml(article, inlineImages.filter((image) => image.local_path));
  db.prepare('UPDATE articles SET preview_html = ? WHERE id = ?').run(rendered.html, article.id);

  return res.render('articles/wechat-preview', {
    title: '微信排版预览',
    article,
    rendered
  });
});

router.get('/articles/:id/edit', (req, res) => {
  const article = getArticle(req.params.id);
  if (!article) return res.status(404).render('error', { title: '未找到', message: '文章不存在' });
  const materialScores = parseMaterialScores(article);
  res.render('articles/form', {
    title: '编辑文章',
    article,
    materialReason: getMaterialReason(article),
    skippedNotice: getSkippedNotice(article, materialScores),
    action: `/articles/${article.id}`
  });
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
    const { images, coverImage, inlineImages, note } = getWechatDraftImages(article);
    const preview = renderPreviewHtml(article, inlineImages);
    if (!preview.consistency.passed) {
      const error = new Error('文章与图片素材不一致，请人工检查。');
      error.errcode = 'IMAGE_CONSISTENCY_LOW';
      error.errmsg = `文章与图片素材不一致，请人工检查。评分 ${preview.consistency.score}`;
      throw error;
    }

    const rendered = await renderDraftHtml(article, inlineImages);
    const draft = await createDraftArticle(article, images, { contentHtml: rendered.html });
    const createdAt = nowText();

    db.prepare(`
      UPDATE articles
      SET wechat_draft_media_id = ?, wechat_thumb_media_id = ?, draft_created_at = ?, rendered_html = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(draft.mediaId, draft.thumbMediaId, createdAt, rendered.html, article.id);

    req.session.wechatDraftResult = {
      mediaId: draft.mediaId,
      thumbMediaId: draft.thumbMediaId,
      coverImageId: coverImage.id,
      coverLocalPath: coverImage.local_path,
      templateName: rendered.templateName,
      inlineImageCount: rendered.imageCount,
      consistencyPassed: rendered.consistency.passed,
      consistencyScore: rendered.consistency.score,
      note,
      createdAt
    };
    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
      .run('wechat_draft_create', 'success', `文章 ${article.id} 已创建微信公众号草稿 media_id=${draft.mediaId} thumb_media_id=${draft.thumbMediaId}`);
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
