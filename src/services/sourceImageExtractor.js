const { rejectImageByText } = require('./imageRelevance');

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

function pickFromSrcset(srcset) {
  const candidates = String(srcset || '').split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, descriptor] = entry.split(/\s+/);
      const width = descriptor && descriptor.endsWith('w') ? Number(descriptor.replace('w', '')) : 0;
      const density = descriptor && descriptor.endsWith('x') ? Number(descriptor.replace('x', '')) * 1000 : 0;
      return { url, score: width || density || 1 };
    })
    .filter((entry) => entry.url);
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.url || '';
}

function isUsableImageUrl(url) {
  const lower = String(url || '').toLowerCase();
  if (!lower || lower.startsWith('data:') || lower.includes('base64')) return false;
  if (lower.endsWith('.svg') || lower.endsWith('.gif')) return false;
  if (lower.includes('sprite') || lower.includes('blank') || lower.includes('pixel') || lower.includes('tracking')) return false;
  return /\.(jpe?g|png|webp)(\?|#|$)/i.test(lower) || lower.includes('image') || lower.includes('/photo') || lower.includes('/img');
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
  const caption = after.match(/<(?:p|span|div)[^>]+class=["'][^"']*(?:caption|desc|photo|credit|summary)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|span|div)>/i);
  return caption ? stripHtml(caption[1]).slice(0, 180) : '';
}

function pushImage(images, seen, image, pageTitle) {
  if (!image.original_url || seen.has(image.original_url) || !isUsableImageUrl(image.original_url)) return;
  const rejectReason = rejectImageByText(image, pageTitle);
  seen.add(image.original_url);
  images.push({
    ...image,
    image_reject_reason: rejectReason || '',
    image_relevance_score: rejectReason ? 20 : 60,
    import_status: rejectReason ? 'imported_review' : 'imported_review',
    candidate_eligible: rejectReason ? false : null,
    reject_for_candidate_reason: rejectReason || ''
  });
}

function extractJsonLdImages(html, baseUrl) {
  const results = [];
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(String(html || '')))) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed['@graph']) ? parsed['@graph'] : [])];
      for (const node of nodes.filter(Boolean)) {
        const image = node.image;
        const values = Array.isArray(image) ? image : [image];
        for (const value of values) {
          const rawUrl = typeof value === 'string' ? value : value?.url;
          const url = absoluteUrl(rawUrl, baseUrl);
          if (url) results.push(url);
        }
      }
    } catch (error) {
      // Ignore malformed JSON-LD and continue extracting regular images.
    }
  }
  return results;
}

function extractArticleImages(html, baseUrl, options = {}) {
  const images = [];
  const seen = new Set();
  const pageTitle = options.pageTitle || matchMeta(html, 'og:title') || '';
  const coverCandidates = [matchMeta(html, 'og:image'), matchMeta(html, 'twitter:image'), ...extractJsonLdImages(html, baseUrl)]
    .map((rawUrl) => absoluteUrl(rawUrl, baseUrl))
    .filter(Boolean);

  for (const url of coverCandidates) {
    pushImage(images, seen, {
      original_url: url,
      source_url: baseUrl,
      usage_hint: 'cover_candidate',
      image_role_guess: 'og_image',
      image_alt: '',
      image_caption: 'Open Graph / structured image from source page',
      image_description: '',
      surrounding_text: ''
    }, pageTitle);
  }

  const sourceRegex = /<source\b[^>]*>/gi;
  let sourceMatch;
  while ((sourceMatch = sourceRegex.exec(String(html || '')))) {
    const tag = sourceMatch[0];
    const rawSrc = pickFromSrcset(getAttribute(tag, 'srcset') || getAttribute(tag, 'data-srcset')) || getAttribute(tag, 'src') || getAttribute(tag, 'data-src');
    const url = absoluteUrl(rawSrc, baseUrl);
    pushImage(images, seen, {
      original_url: url,
      source_url: baseUrl,
      usage_hint: 'inline_candidate',
      image_role_guess: 'body_image',
      image_alt: '',
      image_caption: extractCaption(html, sourceMatch.index),
      image_description: '',
      surrounding_text: nearbyText(html, sourceMatch.index)
    }, pageTitle);
  }

  const imgRegex = /<img\b[^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(String(html || '')))) {
    const tag = match[0];
    const rawSrc = getAttribute(tag, 'src')
      || getAttribute(tag, 'data-src')
      || getAttribute(tag, 'data-original')
      || getAttribute(tag, 'data-lazy')
      || getAttribute(tag, 'data-lazy-src')
      || getAttribute(tag, 'data-url')
      || pickFromSrcset(getAttribute(tag, 'srcset') || getAttribute(tag, 'data-srcset'));
    const url = absoluteUrl(rawSrc, baseUrl);
    pushImage(images, seen, {
      original_url: url,
      source_url: baseUrl,
      usage_hint: images.length === 0 ? 'cover_candidate' : 'inline_candidate',
      image_role_guess: images.length === 0 ? 'cover' : 'body_image',
      image_alt: getAttribute(tag, 'alt'),
      image_caption: extractCaption(html, match.index),
      image_description: '',
      surrounding_text: nearbyText(html, match.index)
    }, pageTitle);
  }

  return images.slice(0, 12);
}

module.exports = { extractArticleImages, matchMeta, stripHtml, isUsableImageUrl, pickFromSrcset };
