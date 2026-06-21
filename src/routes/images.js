const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { db } = require('../db');
const { ImageProcessingError, downloadImage, processUploadedImage } = require('../services/images');

const router = express.Router();
const uploadDir = path.join(config.rootDir, 'storage/uploads');
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      fs.mkdirSync(uploadDir, { recursive: true });
      callback(null, uploadDir);
    },
    filename(req, file, callback) {
      const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
      callback(null, safeName);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return callback(new ImageProcessingError('仅支持 jpg、jpeg、png、webp 图片', 'IMAGE_TYPE_NOT_ALLOWED'));
    }
    return callback(null, true);
  }
});

function flashImageMessage(req, type, message) {
  req.session.imageFlash = { type, message };
}

function takeImageFlash(req) {
  const flash = req.session.imageFlash;
  delete req.session.imageFlash;
  return flash;
}

function formatImageError(error) {
  if (error instanceof ImageProcessingError) return error.message;
  if (error?.code === 'LIMIT_FILE_SIZE') return '图片文件过大，请控制在 15MB 以内';
  return error?.message || '图片保存失败';
}

function uploadMiddleware(req, res, next) {
  upload.single('image_file')(req, res, (error) => {
    if (!error) return next();
    flashImageMessage(req, 'error', formatImageError(error));
    return res.redirect('/images');
  });
}

function insertImage({ articleId, url, sourceNote, licenseStatus, riskLevel, usageScene, localPath }) {
  return db.prepare(`
    INSERT INTO images (article_id, url, source_note, auth_status, risk_level, usage_scene, local_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    articleId || null,
    url || '',
    sourceNote || '',
    licenseStatus || '待确认',
    riskLevel || '中',
    usageScene || '文章内图',
    localPath || ''
  );
}

router.get('/images', (req, res) => {
  const images = db.prepare(`
    SELECT images.*, articles.title AS article_title
    FROM images
    LEFT JOIN articles ON articles.id = images.article_id
    ORDER BY images.created_at DESC
  `).all();
  const articles = db.prepare('SELECT id, title FROM articles ORDER BY updated_at DESC').all();
  res.render('images/index', { title: '图片管理', images, articles, flash: takeImageFlash(req) });
});

router.post('/images', uploadMiddleware, async (req, res) => {
  try {
    const {
      article_id: articleId,
      url,
      source_note: sourceNote,
      risk_level: riskLevel,
      usage_scene: usageScene
    } = req.body;
    const licenseStatus = req.body.license_status || req.body.auth_status || '待确认';
    let localPath = '';
    let savedUrl = url || '';

    if (req.file) {
      localPath = await processUploadedImage(req.file.path, req.file.originalname, sourceNote || usageScene || 'idol-image');
      savedUrl = '';
    } else if (savedUrl) {
      if (req.body.download === 'on') {
        localPath = await downloadImage(savedUrl, sourceNote || usageScene || 'idol-image');
      }
    } else {
      throw new ImageProcessingError('请选择本地图片或填写图片 URL', 'IMAGE_SOURCE_REQUIRED');
    }

    insertImage({ articleId, url: savedUrl, sourceNote, licenseStatus, riskLevel, usageScene, localPath });
    flashImageMessage(req, 'success', req.file ? '本地图片已上传并保存' : '图片记录已保存');
    return res.redirect('/images');
  } catch (error) {
    if (req.file?.path) await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
    flashImageMessage(req, 'error', formatImageError(error));
    return res.redirect('/images');
  }
});

router.post('/images/:id/download', async (req, res) => {
  try {
    const image = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
    if (!image) {
      flashImageMessage(req, 'error', '图片不存在');
      return res.redirect('/images');
    }
    if (!image.url) {
      flashImageMessage(req, 'error', '该图片没有外部 URL，请改用本地上传');
      return res.redirect('/images');
    }

    const localPath = await downloadImage(image.url, image.source_note || `image-${image.id}`);
    db.prepare('UPDATE images SET local_path = ? WHERE id = ?').run(localPath, image.id);
    flashImageMessage(req, 'success', '图片已下载并压缩到本地');
    return res.redirect('/images');
  } catch (error) {
    flashImageMessage(req, 'error', formatImageError(error));
    return res.redirect('/images');
  }
});

router.post('/images/:id/delete', (req, res) => {
  db.prepare('DELETE FROM images WHERE id = ?').run(req.params.id);
  flashImageMessage(req, 'success', '图片记录已删除');
  res.redirect('/images');
});

module.exports = router;
