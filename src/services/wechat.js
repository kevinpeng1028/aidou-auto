const fs = require('fs');
const path = require('path');
const config = require('../config');

const WECHAT_API_BASE = 'https://api.weixin.qq.com/cgi-bin';
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

let cachedToken = null;

class WeChatApiError extends Error {
  constructor(message, payload = {}) {
    super(message);
    this.name = 'WeChatApiError';
    this.errcode = payload.errcode;
    this.errmsg = payload.errmsg;
  }
}

function getWechatCredentials() {
  const appId = process.env.WECHAT_APP_ID || '';
  const appSecret = process.env.WECHAT_APP_SECRET || '';

  if (!appId || !appSecret) {
    throw new WeChatApiError('微信 AppID 或 AppSecret 未配置', {
      errcode: 'CONFIG_MISSING',
      errmsg: '请检查 WECHAT_APP_ID / WECHAT_APP_SECRET'
    });
  }

  return { appId, appSecret };
}

async function readWechatJson(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new WeChatApiError('微信接口返回非 JSON 内容', {
      errcode: response.status,
      errmsg: text.slice(0, 200)
    });
  }

  if (!response.ok || payload.errcode) {
    throw new WeChatApiError('微信接口错误', payload);
  }

  return payload;
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()) {
    return cachedToken.value;
  }

  const { appId, appSecret } = getWechatCredentials();
  const url = `${WECHAT_API_BASE}/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const payload = await readWechatJson(await fetch(url));

  cachedToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 7200) * 1000
  };

  return cachedToken.value;
}

function resolveLocalImage(localImagePath) {
  if (!localImagePath) return '';
  return path.isAbsolute(localImagePath)
    ? localImagePath
    : path.resolve(config.rootDir, localImagePath);
}

function assertLocalImage(localImagePath, message) {
  const absolutePath = resolveLocalImage(localImagePath);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new WeChatApiError(message, {
      errcode: 'LOCAL_IMAGE_MISSING',
      errmsg: message
    });
  }
  return absolutePath;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

async function uploadMultipart(url, localImagePath) {
  const buffer = fs.readFileSync(localImagePath);
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: getMimeType(localImagePath) }), path.basename(localImagePath));
  return readWechatJson(await fetch(url, { method: 'POST', body: form }));
}

async function uploadCoverImage(localImagePath) {
  const absolutePath = assertLocalImage(localImagePath, '请先为文章选择封面图');
  const accessToken = await getAccessToken();
  const url = `${WECHAT_API_BASE}/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=thumb`;
  const payload = await uploadMultipart(url, absolutePath);

  if (!payload.media_id) {
    throw new WeChatApiError('微信封面图上传失败', payload);
  }

  return payload.media_id;
}

async function uploadInlineImage(localImagePath) {
  const absolutePath = assertLocalImage(localImagePath, '正文图片不存在，请先保存图片到本地');
  const accessToken = await getAccessToken();
  const url = `${WECHAT_API_BASE}/media/uploadimg?access_token=${encodeURIComponent(accessToken)}`;
  const payload = await uploadMultipart(url, absolutePath);

  if (!payload.url) {
    throw new WeChatApiError('微信正文图片上传失败', payload);
  }

  return payload.url;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(value) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function markdownToWechatHtml(markdown, title) {
  const paragraphs = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => paragraph.replace(/^#{1,6}\s+/, '').trim())
    .filter((paragraph, index) => !(index === 0 && paragraph === title));

  return paragraphs
    .map((paragraph) => `<p>${paragraph.split('\n').map(renderInlineMarkdown).join('<br>')}</p>`)
    .join('\n');
}

function findCoverImage(images) {
  return images.find((image) => image.usage_scene === '封面图');
}

function findInlineImages(images) {
  return images.filter((image) => image.usage_scene !== '封面图' && image.local_path);
}

async function createDraftArticle(article, images = []) {
  const coverImage = findCoverImage(images);
  if (!coverImage || !coverImage.local_path) {
    throw new WeChatApiError('请先为文章选择封面图', {
      errcode: 'COVER_IMAGE_REQUIRED',
      errmsg: '请先为文章选择封面图'
    });
  }

  const thumbMediaId = await uploadCoverImage(coverImage.local_path);
  const inlineImageUrls = [];
  for (const image of findInlineImages(images)) {
    inlineImageUrls.push(await uploadInlineImage(image.local_path));
  }

  const inlineHtml = inlineImageUrls
    .map((url) => `<p><img src="${escapeHtml(url)}" /></p>`)
    .join('\n');
  const content = [markdownToWechatHtml(article.markdown, article.title), inlineHtml]
    .filter(Boolean)
    .join('\n');

  const accessToken = await getAccessToken();
  const payload = await readWechatJson(await fetch(`${WECHAT_API_BASE}/draft/add?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      articles: [
        {
          title: article.title,
          thumb_media_id: thumbMediaId,
          author: '',
          digest: '',
          show_cover_pic: 0,
          content,
          content_source_url: '',
          need_open_comment: 0,
          only_fans_can_comment: 0
        }
      ]
    })
  }));

  if (!payload.media_id) {
    throw new WeChatApiError('微信公众号草稿创建失败', payload);
  }

  return payload.media_id;
}

module.exports = {
  WeChatApiError,
  getAccessToken,
  uploadCoverImage,
  uploadInlineImage,
  createDraftArticle
};
