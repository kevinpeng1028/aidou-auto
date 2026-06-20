const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const config = require('../config');

function csvEscape(value) {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

function exportArticlePackage(article, images) {
  fs.mkdirSync(config.exportDir, { recursive: true });
  const zipPath = path.join(config.exportDir, `article-${article.id}-${Date.now()}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const manifest = [
    ['url', 'source_note', 'auth_status', 'risk_level', 'usage_scene', 'local_path'].map(csvEscape).join(','),
    ...images.map((image) => [
      image.url,
      image.source_note,
      image.auth_status,
      image.risk_level,
      image.usage_scene,
      image.local_path
    ].map(csvEscape).join(','))
  ].join('\n');

  archive.pipe(output);
  archive.append(article.markdown, { name: 'article.md' });
  archive.append(manifest, { name: 'image_manifest.csv' });
  archive.append(article.risk_report || '', { name: 'risk_report.md' });

  for (const image of images) {
    if (!image.local_path) continue;
    const absolute = path.resolve(config.rootDir, image.local_path);
    if (fs.existsSync(absolute)) {
      archive.file(absolute, { name: `images/${path.basename(absolute)}` });
    }
  }

  archive.finalize();

  return new Promise((resolve, reject) => {
    output.on('close', () => resolve(path.relative(config.rootDir, zipPath).replace(/\\/g, '/')));
    archive.on('error', reject);
  });
}

module.exports = { exportArticlePackage };
