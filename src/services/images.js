const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const slugify = require('slugify');
const config = require('../config');

const MAX_IMAGE_WIDTH = 1600;
const IMAGE_JPEG_QUALITY = 88;
const DOWNLOAD_TIMEOUT_MS = 15000;

class ImageProcessingError extends Error {
  constructor(message, code = 'IMAGE_PROCESSING_ERROR') {
    super(message);
    this.name = 'ImageProcessingError';
    this.code = code;
  }
}

function ensureImageDir() {
  fs.mkdirSync(config.imageDir, { recursive: true });
}

function buildOutputPath(sourceName = 'image') {
  ensureImageDir();
  const basename = slugify(sourceName, { lower: true, strict: true }) || 'image';
  const filename = `${Date.now()}-${basename}.jpg`;
  return path.join(config.imageDir, filename);
}

function toRelativeStoragePath(absolutePath) {
  return path.relative(config.rootDir, absolutePath).replace(/\\/g, '/');
}

async function writeProcessedImage(buffer, sourceName = 'image') {
  const absolutePath = buildOutputPath(sourceName);

  try {
    await sharp(buffer)
      .rotate()
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true })
      .toFile(absolutePath);
  } catch (error) {
    throw new ImageProcessingError('图片格式无法处理', 'IMAGE_PROCESS_FAILED');
  }

  return toRelativeStoragePath(absolutePath);
}

function isTimeoutError(error) {
  const code = error?.cause?.code || error?.code || '';
  return error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || code.includes('TIMEOUT')
    || code === 'UND_ERR_CONNECT_TIMEOUT';
}

function normalizeDownloadError(error) {
  if (error instanceof ImageProcessingError) return error;
  if (isTimeoutError(error)) {
    return new ImageProcessingError('图片下载超时，请改用本地上传', 'IMAGE_DOWNLOAD_TIMEOUT');
  }
  return new ImageProcessingError('图片下载失败，请改用本地上传', 'IMAGE_DOWNLOAD_FAILED');
}

async function downloadImage(url, sourceName = 'image') {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) {
      throw new ImageProcessingError(`图片下载失败：${response.status} ${response.statusText}`, 'IMAGE_DOWNLOAD_FAILED');
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      throw new ImageProcessingError('该链接不是图片直链', 'IMAGE_NOT_DIRECT_LINK');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return await writeProcessedImage(buffer, sourceName);
  } catch (error) {
    throw normalizeDownloadError(error);
  }
}

async function processUploadedImage(filePath, originalName = 'image', sourceName = 'image') {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return await writeProcessedImage(buffer, sourceName || originalName || 'image');
  } catch (error) {
    throw error instanceof ImageProcessingError
      ? error
      : new ImageProcessingError('图片格式无法处理', 'IMAGE_PROCESS_FAILED');
  } finally {
    await fs.promises.rm(filePath, { force: true }).catch(() => {});
  }
}

module.exports = {
  ImageProcessingError,
  downloadImage,
  processUploadedImage
};
