const { classifySource } = require('../config/sourcePolicy');
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

function extractTitle(html) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return (ogTitle || title || '韩国娱乐公开动态').replace(/\s+/g, ' ').trim();
}

function extractPublishedAt(html) {
  return html.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|date|pubdate)["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';
}

function extractImageUrls(html, baseUrl) {
  const urls = [];
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (ogImage) urls.push(new URL(ogImage, baseUrl).toString());

  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    const imageUrl = match[1];
    if (!imageUrl.startsWith('data:')) urls.push(new URL(imageUrl, baseUrl).toString());
  }
  return [...new Set(urls)].slice(0, 6);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPublicHtml(url) {
  assertPublicUrl(url);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'aidou-auto/1.0 public-content-importer' }
  });
  if (!response.ok) {
    throw new KoreanArticleImportError(`公开页面抓取失败：${response.status}`, 'FETCH_FAILED');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    throw new KoreanArticleImportError('该 URL 不是公开 HTML 文章页面', 'NOT_HTML');
  }
  return response.text();
}

async function previewKoreanArticleImport(url) {
  const html = await fetchPublicHtml(url);
  detectBlockedContent(html, url);
  const sourcePolicy = classifySource({ source_url: url, source_name: new URL(url).hostname });
  const imported = {
    source_url: url,
    source_name: new URL(url).hostname,
    title: extractTitle(html),
    source_published_at: extractPublishedAt(html),
    text_excerpt: stripHtml(html).slice(0, 800),
    image_candidates: extractImageUrls(html, url),
    source_type: sourcePolicy.source_type,
    source_risk_level: sourcePolicy.source_risk_level,
    source_policy_result: sourcePolicy.source_policy_result
  };

  const risk = assessMaterialRisk({
    candidate: imported,
    imageEvaluation: { image_quality_score: imported.image_candidates.length ? 80 : 0, watermark_risk: 'unknown', image_quality_notes: '导入预览尚未下载图片。' },
    articleReview: { score: 75, report: '导入预览尚未生成原创中文文章。' }
  });
  const action = decideAutomatedAction({ risk, scores: { total_score: 0 }, duplicateCheck: { duplicated: false }, hasCover: false, inlineImageCount: imported.image_candidates.length });

  return { imported, risk, action };
}

module.exports = {
  KoreanArticleImportError,
  previewKoreanArticleImport
};
