const { db } = require('../db');

function normalizeUsageScene(usageScene = '') {
  return String(usageScene || '').trim().toLowerCase();
}

function isCoverUsage(usageScene = '') {
  const normalized = normalizeUsageScene(usageScene);
  return usageScene === '封面图' || normalized === 'cover' || normalized === 'cover_image';
}

function isInlineUsage(usageScene = '') {
  const normalized = normalizeUsageScene(usageScene);
  return usageScene === '文章内图' || normalized === 'inline' || normalized === 'inline_image';
}

function parseInlineImageIds(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed)
      ? parsed.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
      : [];
  } catch (error) {
    return [];
  }
}

function stringifyInlineImageIds(ids) {
  return JSON.stringify([...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]);
}

function getArticle(articleId) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
}

function getImage(imageId) {
  return db.prepare('SELECT * FROM images WHERE id = ?').get(imageId);
}

function getImagesByIds(ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const images = db.prepare(`SELECT * FROM images WHERE id IN (${placeholders})`).all(...ids);
  const byId = new Map(images.map((image) => [image.id, image]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function setCoverImage(articleId, imageId) {
  db.prepare('UPDATE articles SET cover_image_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(imageId, articleId);
}

function appendInlineImage(articleId, imageId) {
  const article = getArticle(articleId);
  if (!article) return;
  const ids = parseInlineImageIds(article.inline_image_ids);
  if (!ids.includes(Number(imageId))) ids.push(Number(imageId));
  db.prepare('UPDATE articles SET inline_image_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(stringifyInlineImageIds(ids), articleId);
}

function associateImageWithArticle(articleId, imageId, usageScene) {
  if (!articleId || !imageId) return;
  if (isCoverUsage(usageScene)) {
    setCoverImage(articleId, imageId);
    return;
  }
  if (isInlineUsage(usageScene)) {
    appendInlineImage(articleId, imageId);
  }
}

function findLatestCoverImage(articleId) {
  return db.prepare(`
    SELECT * FROM images
    WHERE article_id = ?
      AND (usage_scene = '封面图' OR lower(usage_scene) IN ('cover', 'cover_image'))
    ORDER BY id DESC
    LIMIT 1
  `).get(articleId);
}

function findInlineImages(articleId) {
  return db.prepare(`
    SELECT * FROM images
    WHERE article_id = ?
      AND (usage_scene = '文章内图' OR lower(usage_scene) IN ('inline', 'inline_image'))
    ORDER BY id ASC
  `).all(articleId);
}

function resolveArticleImageAssociations(article) {
  let coverImage = article.cover_image_id ? getImage(article.cover_image_id) : null;
  if (!coverImage) {
    coverImage = findLatestCoverImage(article.id) || null;
    if (coverImage) setCoverImage(article.id, coverImage.id);
  }

  let inlineImageIds = parseInlineImageIds(article.inline_image_ids);
  let inlineImages = getImagesByIds(inlineImageIds);
  if (!inlineImages.length) {
    inlineImages = findInlineImages(article.id);
    inlineImageIds = inlineImages.map((image) => image.id);
    if (inlineImageIds.length) {
      db.prepare('UPDATE articles SET inline_image_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(stringifyInlineImageIds(inlineImageIds), article.id);
    }
  }

  return { coverImage, inlineImages, inlineImageIds };
}

function getArticleImagesForDraft(article) {
  const { coverImage, inlineImages } = resolveArticleImageAssociations(article);
  return [coverImage, ...inlineImages].filter(Boolean);
}

module.exports = {
  associateImageWithArticle,
  getArticleImagesForDraft,
  isCoverUsage,
  isInlineUsage,
  parseInlineImageIds,
  resolveArticleImageAssociations
};
