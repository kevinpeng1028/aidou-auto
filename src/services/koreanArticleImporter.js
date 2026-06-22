const crypto = require('crypto');
const { classifySource } = require('../config/sourcePolicy');
const { extractArticleImages, matchMeta, stripHtml } = require('./sourceImageExtractor');
const { assessMaterialRisk, decideAutomatedAction } = require('./riskAssessment');

class KoreanArticleImportError extends Error {
  constructor(message, code = 'KOREAN_ARTICLE_IMPORT_FAILED') {
    super(message);
    this.name = 'KoreanArticleImportError';
    this.code = code;
  }
}

function assertPublicUrl(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new KoreanArticleImportError('只允许导入公开 http/https URL', 'INVALID_URL');
  }
  return parsed;
}

function detectBlockedContent(html, url) {
  const text = `${url}\n${html}`.toLowerCase();
  const blockedSignals = ['login', 'paywall', 'subscribe', 'forbidden', 'captcha', 'robots', '禁止转载', '禁止复制', '付费', '登录后'];
  const matched = blockedSignals.find((signal) => text.includes(signal));
  if (matched) {
    throw new KoreanArticleImportError('该来源可能需要登录、付费、绕过限制或禁止转载，已停止导入。', 'SOURCE_ACCESS_BLOCKED');
  }
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function extractTitle(html) {
  const ogTitle = matchMeta(html, 'og:title');
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return (ogTitle || title || '韩国娱乐公开动态').replace(/\s+/g, ' ').trim();
}

function extractPublishedAt(html) {
  return matchMeta(html, 'article:published_time') || matchMeta(html, 'date') || matchMeta(html, 'pubdate') || '';
}

async function fetchPublicHtml(url) {
  const parsed = assertPublicUrl(url);
  const response = await fetch(parsed.toString(), {
    headers: { 'User-Agent': 'aidou-auto/1.0 public-content-importer' },
    redirect: 'follow'
  });
  if (!response.ok) {
    throw new KoreanArticleImportError(`公开页面抓取失败：${response.status}`, 'FETCH_FAILED');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    throw new KoreanArticleImportError('该 URL 不是公开 HTML 文章页面', 'NOT_HTML');
  }
  const html = await response.text();
  detectBlockedContent(html, response.url || parsed.toString());
  return { html, finalUrl: response.url || parsed.toString() };
}

function buildSourcePackage(html, finalUrl, overrides = {}) {
  const sourceName = overrides.source_name || matchMeta(html, 'og:site_name') || new URL(finalUrl).hostname;
  const articleText = stripHtml(html).slice(0, 3000);
  const sourcePolicy = classifySource({
    source_url: finalUrl,
    source_name: sourceName,
    source_type: overrides.source_type || ''
  });
  const articleImages = extractArticleImages(html, finalUrl);

  return {
    source_url: finalUrl,
    source_name: sourceName,
    source_type: sourcePolicy.source_type,
    source_risk_level: sourcePolicy.source_risk_level,
    source_risk_score: sourcePolicy.source_risk_score,
    source_policy_result: sourcePolicy.source_policy_result,
    original_title: overrides.original_title || extractTitle(html),
    original_excerpt: articleText.slice(0, 1200),
    article_text_hash: hashText(articleText),
    source_published_at: overrides.source_published_at || extractPublishedAt(html),
    idol_name: overrides.idol_name || '',
    group_name: overrides.group_name || '',
    topic_keyword: overrides.topic_keyword || '',
    event_type: overrides.event_type || '',
    image_count: articleImages.length,
    usable_image_count: articleImages.filter((image) => image.source_url === finalUrl).length,
    article_images: articleImages
  };
}

async function importKoreanArticleWithImages(url, overrides = {}) {
  const { html, finalUrl } = await fetchPublicHtml(url);
  return buildSourcePackage(html, finalUrl, overrides);
}

async function previewKoreanArticleImport(url) {
  const sourcePackage = await importKoreanArticleWithImages(url);
  const imported = {
    source_package: sourcePackage,
    source_url: sourcePackage.source_url,
    source_name: sourcePackage.source_name,
    title: sourcePackage.original_title,
    source_published_at: sourcePackage.source_published_at,
    text_excerpt: sourcePackage.original_excerpt,
    image_candidates: sourcePackage.article_images,
    source_type: sourcePackage.source_type,
    source_risk_level: sourcePackage.source_risk_level,
    source_policy_result: sourcePackage.source_policy_result
  };

  const risk = assessMaterialRisk({
    candidate: imported,
    imageEvaluation: {
      image_quality_score: imported.image_candidates.length ? 80 : 0,
      watermark_risk: 'unknown',
      image_quality_notes: imported.image_candidates.length ? '导入预览已提取同页图片，尚未下载。' : '未在同一页面提取到可用图片。'
    },
    articleReview: { score: 75, report: '导入预览尚未生成原创中文文章。' }
  });
  const action = decideAutomatedAction({
    risk,
    scores: { total_score: 0 },
    duplicateCheck: { duplicated: false },
    hasCover: imported.image_candidates.length > 0,
    inlineImageCount: Math.max(0, imported.image_candidates.length - 1)
  });

  return { imported, risk, action };
}

module.exports = {
  KoreanArticleImportError,
  fetchPublicHtml,
  importKoreanArticleWithImages,
  previewKoreanArticleImport
};
