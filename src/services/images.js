const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const slugify = require('slugify');
const config = require('../config');

async function downloadImage(url, sourceName = 'image') {
  fs.mkdirSync(config.imageDir, { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const basename = slugify(sourceName, { lower: true, strict: true }) || 'image';
  const filename = `${Date.now()}-${basename}.jpg`;
  const absolutePath = path.join(config.imageDir, filename);

  await sharp(buffer)
    .rotate()
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toFile(absolutePath);

  return path.relative(config.rootDir, absolutePath).replace(/\\/g, '/');
}

module.exports = { downloadImage };
