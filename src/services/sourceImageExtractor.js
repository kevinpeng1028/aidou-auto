function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function getAttribute(tag, name) {
  const match = String(tag || '').match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeHtml(match[1]) : '';
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchMeta(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match) return decodeHtml(match[1]);
  }
  return '';
}

function absoluteUrl(rawUrl, baseUrl) {
  try {
    return new URL(decodeHtml(rawUrl), baseUrl).toString();
  } catch (error) {
    return '';
  }
}

function isUsableImageUrl(url) {
  const lower = String(url || '').toLowerCase();
  if (!lower || lower.startsWith('data:') || lower.includes('base64')) return false;
  if (lower.endsWith('.svg') || lower.endsWith('.gif')) return false;
  if (lower.includes('logo') || lower.includes('icon') || lower.includes('avatar') || lower.includes('pixel')) return false;
  return /\.(jpe?g|png|webp)(\?|#|$)/i.test(lower) || lower.includes('image');
}

function nearbyText(html, index) {
  const start = Math.max(0, index - 500);
  const end = Math.min(String(html).length, index + 500);
  return stripHtml(String(html).slice(start, end)).slice(0, 240);
}

function extractCaption(html, index) {
  const after = String(html).slice(index, index + 1200);
  const figcaption = after.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
  if (figcaption) return stripHtml(figcaption[1]).slice(0, 180);
  const caption = after.match(/<(?:p|span|div)[^>]+class=["'][^"']*(?:caption|desc|photo|credit)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|span|div)>/i);
  return caption ? stripHtml(caption[1]).slice(0, 180) : '';
}

function extractArticleImages(html, baseUrl) {
  const images = [];
  const seen = new Set();
  const coverCandidates = [matchMeta(html, 'og:image'), matchMeta(html, 'twitter:image')]
    .map((rawUrl) => absoluteUrl(rawUrl, baseUrl))
    .filter(Boolean);

  for (const url of coverCandidates) {
    if (!isUsableImageUrl(url) || seen.has(url)) continue;
    seen.add(url);
    images.push({
      original_url: url,
      source_url: baseUrl,
      usage_hint: 'cover_candidate',
      image_alt: '',
      image_caption: 'Open Graph image from source page',
      image_description: '',
      surrounding_text: ''
    });
  }

  const imgRegex = /<img\b[^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(String(html || '')))) {
    const tag = match[0];
    const rawSrc = getAttribute(tag, 'src') || getAttribute(tag, 'data-src') || getAttribute(tag, 'data-original');
    const url = absoluteUrl(rawSrc, baseUrl);
    if (!url || seen.has(url) || !isUsableImageUrl(url)) continue;
    seen.add(url);
    images.push({
      original_url: url,
      source_url: baseUrl,
      usage_hint: 'inline_candidate',
      image_alt: getAttribute(tag, 'alt'),
      image_caption: extractCaption(html, match.index),
      image_description: '',
      surrounding_text: nearbyText(html, match.index)
    });
  }

  return images.slice(0, 8);
}

module.exports = { extractArticleImages, matchMeta, stripHtml };
