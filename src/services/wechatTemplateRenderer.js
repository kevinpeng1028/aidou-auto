'use strict';

const { getDefaultTemplate, getTemplateById } = require('../config/wechatArticleTemplates');

const DEFAULT_STYLES = getDefaultTemplate().styles;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripUnsafeMarkup(text) {
  return String(text || '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(?:^|\s)#[^\s#]+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/<\/?(?:script|iframe)[^>]*>/gi, '')
    .trim();
}

function removeRepeatedTitle(body, title) {
  if (!title) return body;
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.replace(new RegExp(`^\\s*${escapedTitle}\\s*`, 'i'), '').trim();
}

function splitLongParagraph(paragraph, maxLength = 120) {
  const text = paragraph.trim();
  if (text.length <= maxLength) return [text];

  const parts = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitAt = Math.max(
      remaining.lastIndexOf('。', maxLength),
      remaining.lastIndexOf('；', maxLength),
      remaining.lastIndexOf('，', maxLength),
      remaining.lastIndexOf(' ', maxLength)
    );
    if (splitAt < 40) splitAt = maxLength;
    parts.push(remaining.slice(0, splitAt + 1).trim());
    remaining = remaining.slice(splitAt + 1).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function splitBodyParagraphs(body, title) {
  const cleaned = removeRepeatedTitle(stripUnsafeMarkup(body), title);
  return cleaned
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .flatMap((part) => splitLongParagraph(part))
    .map((part) => part.trim())
    .filter(Boolean);
}

function getImageCaption(image, index) {
  return image.caption || image.image_caption || image.source_note || `图片 ${index + 1}`;
}

function renderParagraph(text, styles = DEFAULT_STYLES) {
  const html = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, `<strong style="${styles.strong}">$1</strong>`)
    .replace(/\n/g, '<br>');
  return `<p style="${styles.paragraph}">${html}</p>`;
}

function renderImage(image, index, styles = DEFAULT_STYLES) {
  const url = image.wechatUrl || image.previewUrl || image.localUrl || image.url;
  if (!url) return '';
  const caption = getImageCaption(image, index);
  const captionHtml = caption ? `<p style="${styles.caption}">${escapeHtml(caption)}</p>` : '';
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(caption)}" style="${styles.image}">${captionHtml}`;
}

function getImageInsertPositions(paragraphCount, imageCount) {
  if (!imageCount || paragraphCount <= 0) return [];
  const lastBeforeEnding = Math.max(0, paragraphCount - 2);

  if (imageCount === 1) return [Math.min(1, paragraphCount - 1)];
  if (imageCount === 2) return [0, Math.max(1, Math.floor(paragraphCount / 2) - 1)];
  if (imageCount === 3) return [0, Math.max(1, Math.floor(paragraphCount / 2) - 1), lastBeforeEnding];

  return [
    0,
    Math.max(1, Math.floor(paragraphCount / 3) - 1),
    Math.max(1, Math.floor((paragraphCount * 2) / 3) - 1),
    lastBeforeEnding
  ];
}

function renderBodyWithImages(paragraphs, inlineImages, styles = DEFAULT_STYLES) {
  const images = inlineImages.slice(0, 4);
  const insertPositions = getImageInsertPositions(paragraphs.length, images.length);
  const chunks = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    chunks.push(renderParagraph(paragraph, styles));
    insertPositions.forEach((position, imageIndex) => {
      if (position === paragraphIndex) {
        chunks.push(renderImage(images[imageIndex], imageIndex, styles));
      }
    });
  });

  return chunks.join('\n');
}

function inferArticleText(article) {
  return [article.title, article.markdown, article.body, article.keyword]
    .filter(Boolean)
    .join('\n');
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function evaluateImageConsistency(article, images) {
  const issues = [];
  const articleText = inferArticleText(article);
  const articleIdol = normalize(article.idol_name || article.person_name || article.actor_name);
  const articleGroup = normalize(article.group_name);

  images.forEach((image) => {
    const imageIdol = normalize(image.idol_name);
    const imageGroup = normalize(image.group_name);
    const description = [image.image_description, image.caption, image.image_caption, image.source_note, image.usage_scene]
      .filter(Boolean)
      .join(' ');

    if (articleIdol && imageIdol && articleIdol !== imageIdol) {
      issues.push(`图片 ${image.id} 人物与文章不一致`);
    }

    if (articleGroup && imageGroup && articleGroup !== imageGroup) {
      issues.push(`图片 ${image.id} 组合与文章不一致`);
    }

    if (/机场/.test(articleText) && description && !/机场/.test(description)) {
      issues.push(`图片 ${image.id} 可能不是机场图`);
    }

    if (/品牌|活动/.test(articleText) && description && !/品牌|活动/.test(description)) {
      issues.push(`图片 ${image.id} 可能不是品牌活动图`);
    }
  });

  const score = Math.max(0, 100 - issues.length * 15);
  return {
    passed: score >= 85,
    score,
    issues
  };
}

function buildTemplateData({ article, paragraphs, inlineImages, bodyHtml, consistency, styles }) {
  const title = article.title || '未命名文章';
  const intro = paragraphs[0] || '';
  const ending = paragraphs[paragraphs.length - 1] || '';
  const summary = article.summary || article.selected_reason || intro;

  const data = {
    TITLE: escapeHtml(title),
    SUMMARY: escapeHtml(summary),
    INTRO: intro ? renderParagraph(intro, styles) : '',
    BODY_PARAGRAPHS: bodyHtml,
    ENDING: ending ? renderParagraph(ending, styles) : '',
    CONSISTENCY_SCORE: String(consistency.score)
  };

  inlineImages.slice(0, 4).forEach((image, index) => {
    data[`IMAGE_${index + 1}`] = renderImage(image, index, styles);
    data[`CAPTION_${index + 1}`] = escapeHtml(getImageCaption(image, index));
  });

  return data;
}

function sanitizeTemplateHtml(html) {
  return String(html || '{{BODY_PARAGRAPHS}}')
    .replace(/<\/?(?:script|iframe|style|link)[^>]*>/gi, '')
    .replace(/\son[a-z]+="[^"]*"/gi, '');
}

function applyTemplate(template, data) {
  return sanitizeTemplateHtml(template.html).replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (_match, key) => data[key] || '');
}

function renderWechatArticleHtml({ article, inlineImages = [], templateId = null }) {
  const template = getTemplateById(templateId || article.wechat_template_id || article.template_id) || getDefaultTemplate();
  const styles = { ...DEFAULT_STYLES, ...(template.styles || {}) };
  const paragraphs = splitBodyParagraphs(article.markdown || article.body || '', article.title);
  const consistency = evaluateImageConsistency(article, inlineImages);
  const bodyHtml = renderBodyWithImages(paragraphs, inlineImages, styles);
  const data = buildTemplateData({ article, paragraphs, inlineImages, bodyHtml, consistency, styles });
  const html = applyTemplate({ ...template, styles }, data);

  return {
    html: `<section style="${styles.wrapper}">${html}</section>`,
    templateName: template.name,
    templateId: template.id,
    imageCount: inlineImages.length,
    consistency,
    paragraphs
  };
}

module.exports = {
  renderWechatArticleHtml,
  splitBodyParagraphs,
  evaluateImageConsistency
};
