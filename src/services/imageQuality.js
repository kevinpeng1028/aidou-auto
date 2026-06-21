const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');

function resolveImagePath(localPath) {
  if (!localPath) return '';
  return path.isAbsolute(localPath) ? localPath : path.resolve(config.rootDir, localPath);
}

function detectWatermarkRisk(metadata, image = {}) {
  const note = `${image.source_note || ''} ${image.source_name || ''}`.toLowerCase();
  if (note.includes('watermark') || note.includes('水印')) return 'medium';
  if (metadata.width && metadata.height && (metadata.width < 640 || metadata.height < 640)) return 'medium';
  return 'low';
}

async function evaluateImageQuality(image) {
  const absolutePath = resolveImagePath(image.local_path);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    return {
      image_quality_score: 0,
      watermark_risk: 'unknown',
      image_quality_notes: '图片没有本地文件，无法评估质量。'
    };
  }

  const metadata = await sharp(absolutePath).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const minSide = Math.min(width, height);
  const maxSide = Math.max(width, height);
  let score = 95;
  const notes = [`尺寸 ${width}x${height}`];

  if (minSide < 640) {
    score -= 30;
    notes.push('分辨率不足');
  } else if (minSide < 900) {
    score -= 12;
    notes.push('分辨率一般');
  }

  if (maxSide / Math.max(minSide, 1) > 2.2) {
    score -= 10;
    notes.push('画幅过窄或过宽');
  }

  const watermarkRisk = detectWatermarkRisk(metadata, image);
  if (watermarkRisk !== 'low') {
    score -= 15;
    notes.push('疑似存在水印或来源标记，需人工审核');
  }

  return {
    image_quality_score: Math.max(0, Math.min(100, score)),
    watermark_risk: watermarkRisk,
    image_quality_notes: notes.join('；')
  };
}

async function evaluateImageSet(images) {
  const results = [];
  for (const image of images) {
    results.push(await evaluateImageQuality(image));
  }

  if (!results.length) {
    return {
      image_quality_score: 0,
      watermark_risk: 'unknown',
      image_quality_notes: '未找到可用图片。'
    };
  }

  const averageScore = Math.round(results.reduce((sum, item) => sum + item.image_quality_score, 0) / results.length);
  const watermarkRisk = results.some((item) => item.watermark_risk !== 'low') ? 'medium' : 'low';

  return {
    image_quality_score: averageScore,
    watermark_risk: watermarkRisk,
    image_quality_notes: results.map((item) => item.image_quality_notes).join(' | ')
  };
}

module.exports = { evaluateImageQuality, evaluateImageSet };
