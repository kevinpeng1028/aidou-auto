const crypto = require('crypto');
const config = require('../config');
const { db } = require('../db');
const { generateArticle, auditArticle } = require('./openai');
const { createMockImage, downloadImageWithMetadata } = require('./images');
const { mockSearchRecentTopics, isWithinLast24Hours, normalizeCandidate } = require('./searchProvider');
const { searchKoreanMediaUrlsDetailed } = require('./koreanMediaSearch');
const { importKoreanArticleWithImages } = require('./koreanArticleImporter');
const { classifySource } = require('../config/sourcePolicy');
const { rejectSourcePage, scoreImageCandidate } = require('./imageRelevance');

function logTask(taskName, status, message) {
  db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)').run(taskName, status, message);
}

function clamp(value, min, max) {
  const number = Math.round(Number(value || 0));
  return Math.max(min, Math.min(max, number));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function hoursSince(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return 999;
  return Math.max(0, (Date.now() - time) / (60 * 60 * 1000));
}

function isWithinLast48Hours(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) && Date.now() - time <= 48 * 60 * 60 * 1000 && time <= Date.now();
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function sameSourceImages(candidate) {
  return (candidate.image_candidates || []).filter((image) => image.source_url && image.source_url === candidate.source_url);
}

function fallbackArticle(candidate) {
  const subject = candidate.idol_name || candidate.group_name || candidate.keyword || '这次公开动态';
  return {
    title: `${subject}这次公开动态，状态观察可以写一写`,
    markdown: [
      `${subject}这次更新，比较适合放在今天的状态观察里看。`,
      '这篇候选的重点不是先写文章再另外找图，而是把同一 source package 里的公开事实、来源信息和图片说明放在一起处理。图文来自同一个页面，写作时就不需要创造额外关联。',
      '从公众号文章的角度看，这类素材适合写得克制一点。重点可以放在近期公开行程、整体气质和账号呈现上，不补未经确认的画面细节，也不把普通动态写成夸张爆点。',
      '如果后续配图授权和图文一致性都能确认，这篇可以作为今日候选继续推进。它的优势不是噱头，而是足够稳，适合留给人工最后确认。'
    ].join('\n\n')
  };
}

function scoreCandidate(candidate) {
  const sourcePolicy = classifySource(candidate);
  const sourceImages = sameSourceImages(candidate);
  const imageRelevanceScore = Math.max(0, ...sourceImages.map((image) => Number(image.image_relevance_score || 0)));
  const usableImageCount = sourceImages.filter((image) => Number(image.image_relevance_score || 0) >= 80 && !image.image_reject_reason).length;
  const scores = {
    freshness_score: hoursSince(candidate.source_published_at) <= 24 ? 15 : (hoursSince(candidate.source_published_at) <= 48 ? 8 : 0),
    topic_heat_score: clamp((candidate.social_signal || 0) * 0.45 + (candidate.media_signal || 0) * 0.4 + (candidate.audience_signal || 0) * 0.55 + (candidate.source_count || 0), 0, 15),
    image_quality_score: usableImageCount >= 3 ? 15 : (usableImageCount >= 2 ? 13 : (usableImageCount === 1 ? 8 : 0)),
    image_article_match_score: imageRelevanceScore >= 90 ? 15 : (imageRelevanceScore >= 80 ? 13 : 0),
    article_quality_score: [candidate.title, candidate.source_summary, candidate.angle].filter(Boolean).join(' ').length >= 80 ? 15 : 10,
    predicted_read_score: clamp((candidate.audience_signal || 0) * 0.6 + (candidate.social_signal || 0) * 0.25 + (candidate.media_signal || 0) * 0.15, 0, 10),
    risk_score: 0,
    anti_ai_score: /爆料|网传|疑似|塌房|撕|争议/.test([candidate.title, candidate.source_summary, candidate.candidate_reason].join(' ')) ? 1 : 5
  };
  scores.risk_score = sourcePolicy.source_risk_level === 'low' && scores.image_quality_score >= 12 && scores.image_article_match_score >= 13 ? 10 : (sourcePolicy.source_risk_level === 'medium' ? 6 : 2);
  scores.total_score = Object.values(scores).reduce((sum, value) => sum + Number(value || 0), 0);
  const riskText = [candidate.title, candidate.source_summary, candidate.candidate_reason, candidate.source_name, candidate.source_url].join(' ');
  const riskLevel = sourcePolicy.source_risk_level === 'high' || /爆料|网传|争议|隐私|未证实|水印|搬运|粉丝站|图包/.test(riskText) ? 'high' : (sourcePolicy.source_risk_level === 'low' ? 'low' : 'medium');
  const rejectedReasons = sourceImages.map((image) => image.image_reject_reason).filter(Boolean);
  const riskNotes = [
    sourcePolicy.source_policy_result,
    usableImageCount < 2 ? '真实爱豆人物图不足，不能进入 ready 或 selected_candidate。' : '',
    rejectedReasons.length ? `已拒绝非爱豆图：${[...new Set(rejectedReasons)].join(', ')}` : '',
    sourceImages.some((image) => image.source_url !== candidate.source_url) ? '检测到非同源图片，必须跳过。' : '',
    imageRelevanceScore < 80 ? '图片内容相关性低于 80，不能作为首选候选。' : ''
  ].filter(Boolean).join(' ');

  return {
    ...scores,
    risk_level: riskLevel,
    sourcePolicy,
    risk_notes: riskNotes,
    image_relevance_score: imageRelevanceScore,
    usable_image_candidate_count: usableImageCount
  };
}

function duplicateReason(candidate) {
  if (candidate.source_url) {
    const existingSource = db.prepare('SELECT id, title FROM articles WHERE source_url = ? LIMIT 1').get(candidate.source_url);
    if (existingSource) return `同一 source_url 已入库：文章 #${existingSource.id} ${existingSource.title}`;
  }
  if (candidate.idol_name) {
    const existingIdol = db.prepare(`SELECT id, title FROM articles WHERE idol_name = ? AND status = 'selected_candidate' AND datetime(created_at) >= datetime('now', '-3 days') ORDER BY created_at DESC LIMIT 1`).get(candidate.idol_name);
    if (existingIdol) return `同一人物 3 天内已进入 selected_candidate：文章 #${existingIdol.id} ${existingIdol.title}`;
  }
  if (candidate.group_name) {
    const existingGroup = db.prepare(`SELECT id, title FROM articles WHERE group_name = ? AND status = 'selected_candidate' AND datetime(created_at) >= datetime('now', '-1 day') ORDER BY created_at DESC LIMIT 1`).get(candidate.group_name);
    if (existingGroup) return `同一组合 24 小时内已进入 selected_candidate：文章 #${existingGroup.id} ${existingGroup.title}`;
  }
  return '';
}

function upsertSourcePackage(candidate, scored, status = 'candidate') {
  db.prepare(`INSERT OR IGNORE INTO source_packages (source_url, source_name, source_type, source_risk_level, source_risk_score, original_title, original_excerpt, article_text_hash, source_published_at, idol_name, group_name, topic_keyword, event_type, package_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    candidate.source_url, candidate.source_name, scored.sourcePolicy.source_type, scored.sourcePolicy.source_risk_level, scored.sourcePolicy.source_risk_score, candidate.title, candidate.source_summary, hashText(`${candidate.title}\n${candidate.source_summary}`), candidate.source_published_at || null, candidate.idol_name, candidate.group_name, candidate.keyword, candidate.event_type || '', status
  );
  db.prepare(`UPDATE source_packages SET source_name = ?, source_type = ?, source_risk_level = ?, source_risk_score = ?, original_title = ?, original_excerpt = ?, article_text_hash = ?, source_published_at = ?, idol_name = ?, group_name = ?, topic_keyword = ?, event_type = ?, package_status = ?, total_score = ?, freshness_score = ?, topic_heat_score = ?, image_quality_score = ?, image_article_match_score = ?, article_quality_score = ?, predicted_read_score = ?, risk_score = ?, anti_ai_score = ?, risk_level = ?, risk_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE source_url = ?`).run(
    candidate.source_name, scored.sourcePolicy.source_type, scored.sourcePolicy.source_risk_level, scored.sourcePolicy.source_risk_score, candidate.title, candidate.source_summary, hashText(`${candidate.title}\n${candidate.source_summary}`), candidate.source_published_at || null, candidate.idol_name, candidate.group_name, candidate.keyword, candidate.event_type || '', status, scored.total_score, scored.freshness_score, scored.topic_heat_score, scored.image_quality_score, scored.image_article_match_score, scored.article_quality_score, scored.predicted_read_score, scored.risk_score, scored.anti_ai_score, scored.risk_level, scored.risk_notes, candidate.source_url
  );
  return db.prepare('SELECT * FROM source_packages WHERE source_url = ?').get(candidate.source_url);
}

function scoredRiskLevelForImage(candidate) {
  if (String(candidate.source_type || '').includes('official')) return '低';
  if (String(candidate.source_type || '').includes('high') || String(candidate.source_name || '').includes('fansite')) return '高';
  return '中';
}

async function savePackageImage(candidate, sourcePackage, image, index, mockMode) {
  let localPath = '';
  let copyrightRisk = image.image_reject_reason || '';
  let metadataText = '';
  const sameSource = image.source_url === candidate.source_url;
  const relevanceScore = Number(image.image_relevance_score || 0);
  if (!sameSource) {
    copyrightRisk = '图片与文章不是同一 source_url，不能自动使用。';
  } else if (copyrightRisk || relevanceScore < 80) {
    copyrightRisk = copyrightRisk || 'image_subject_uncertain';
  } else {
    try {
      if (mockMode) {
        localPath = await createMockImage(`${candidate.group_name || candidate.idol_name || candidate.keyword}-${sourcePackage.id}`, index);
        metadataText = 'mock image';
      } else {
        const downloaded = await downloadImageWithMetadata(image.original_url, `${candidate.source_name}-${sourcePackage.id}-${index}`);
        localPath = downloaded.localPath;
        metadataText = `${downloaded.metadata.width}x${downloaded.metadata.height}`;
      }
    } catch (error) {
      copyrightRisk = error.code || error.message;
    }
  }

  const usageScene = index === 0 ? '封面图' : '文章内图';
  const result = db.prepare(`INSERT INTO images (article_id, source_package_id, url, original_url, source_url, source_name, source_note, image_caption, caption, image_description, image_alt, surrounding_text, auth_status, license_status, copyright_risk, watermark_detected, image_quality_score, risk_level, usage_scene, local_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    null,
    sourcePackage.id,
    image.original_url || '',
    image.original_url || '',
    image.source_url || '',
    candidate.source_name,
    `${candidate.source_name} 同源 source package 图片；relevance=${relevanceScore}${metadataText ? `；metadata=${metadataText}` : ''}`,
    image.image_caption || '',
    image.image_caption || '',
    [image.image_description, image.image_reject_reason ? `reject:${image.image_reject_reason}` : '', metadataText].filter(Boolean).join(' / '),
    image.image_alt || '',
    image.surrounding_text || '',
    candidate.source_type === 'official_low_risk' ? '待确认：官方公开来源' : '待确认：公开来源',
    '待确认',
    copyrightRisk,
    0,
    localPath ? Math.max(70, relevanceScore) : 0,
    scoredRiskLevelForImage(candidate),
    usageScene,
    localPath
  );
  return db.prepare('SELECT * FROM images WHERE id = ?').get(result.lastInsertRowid);
}

async function ensurePackageImages(candidate, sourcePackage, mockMode) {
  const existing = db.prepare('SELECT * FROM images WHERE source_package_id = ? ORDER BY id ASC').all(sourcePackage.id);
  if (existing.some((image) => image.local_path)) return existing;
  const sameSourceCandidates = sameSourceImages(candidate).sort((left, right) => Number(right.image_relevance_score || 0) - Number(left.image_relevance_score || 0));
  const imagesToSave = sameSourceCandidates.slice(0, 6);
  const saved = [];
  for (let index = 0; index < imagesToSave.length; index += 1) saved.push(await savePackageImage(candidate, sourcePackage, imagesToSave[index], index, mockMode));
  return saved;
}

function updateSourcePackageImages(sourcePackageId, images) {
  const usableImages = images.filter((image) => image.local_path && Number(image.image_quality_score || 0) >= 70 && !image.copyright_risk);
  const cover = usableImages[0] || null;
  const inlineIds = usableImages.slice(1, 5).map((image) => image.id);
  db.prepare(`UPDATE source_packages SET image_count = ?, usable_image_count = ?, cover_image_id = ?, inline_image_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(images.length, usableImages.length, cover?.id || null, JSON.stringify(inlineIds), sourcePackageId);
  return {
    cover,
    inlineIds,
    imageQualityScore: usableImages.length >= 2 ? 85 : 0,
    imageArticleMatchScore: usableImages.length ? Math.min(...usableImages.map((image) => Number(image.image_quality_score || 0))) : 0,
    imageRejectReasons: images.map((image) => image.copyright_risk).filter(Boolean)
  };
}

function insertCandidate(candidate, scored, sourcePackage, imageInfo, rank, status, selectedReason) {
  return db.prepare(`INSERT OR REPLACE INTO daily_candidates (article_id, source_package_id, cover_image_id, inline_image_ids, image_count, usable_image_count, run_date, rank, title, idol_name, group_name, topic_keyword, source_url, source_name, source_published_at, source_type, source_summary, candidate_reason, selected_reason, risk_notes, image_candidates_json, risk_level, status, freshness_score, topic_heat_score, image_quality_score, image_article_match_score, article_quality_score, predicted_read_score, risk_score, anti_ai_score, total_score, updated_at) VALUES (COALESCE((SELECT article_id FROM daily_candidates WHERE source_url = ?), NULL), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(
    candidate.source_url, sourcePackage.id, imageInfo.cover?.id || null, JSON.stringify(imageInfo.inlineIds), imageInfo.imageCount, imageInfo.usableImageCount, today(), rank, candidate.title, candidate.idol_name, candidate.group_name, candidate.keyword, candidate.source_url, candidate.source_name, candidate.source_published_at, scored.sourcePolicy.source_type, candidate.source_summary, candidate.candidate_reason, selectedReason, [scored.risk_notes, imageInfo.imageRejectReasons.length ? `图片拒绝原因：${imageInfo.imageRejectReasons.join(', ')}` : ''].filter(Boolean).join(' '), JSON.stringify(candidate.image_candidates), scored.risk_level, status, scored.freshness_score, scored.topic_heat_score, imageInfo.imageQualityScore >= 70 ? scored.image_quality_score : 0, imageInfo.imageArticleMatchScore >= 80 ? scored.image_article_match_score : 0, scored.article_quality_score, scored.predicted_read_score, scored.risk_score, scored.anti_ai_score, scored.total_score
  ).lastInsertRowid;
}

async function buildSelectedArticle(candidate, scored, sourcePackage, packageImages, imageInfo) {
  let generated;
  try {
    const imageContext = packageImages.filter((image) => image.local_path).map((image) => [image.image_caption, image.image_alt, image.surrounding_text].filter(Boolean).join(' ')).join('\n');
    generated = await generateArticle(`${candidate.keyword}\nsource_summary:${candidate.source_summary}\nsource_url:${candidate.source_url}\nimage_context:${imageContext}`);
  } catch (error) {
    generated = fallbackArticle(candidate);
  }
  let review;
  try {
    review = await auditArticle(generated.markdown);
  } catch (error) {
    review = { score: scored.risk_score * 10, report: `本地 dry-run 审核：${error.message}`, allowed: scored.risk_score >= 8 };
  }
  const materialScores = {
    ...scored,
    source_package_id: sourcePackage.id,
    cover_image_id: imageInfo.cover?.id || null,
    inline_image_ids: imageInfo.inlineIds,
    image_count: imageInfo.imageCount,
    usable_image_count: imageInfo.usableImageCount,
    image_relevance_score: imageInfo.imageArticleMatchScore,
    source_policy_result: scored.sourcePolicy.source_policy_result,
    source_risk_level: scored.sourcePolicy.source_risk_level,
    source_urls: [candidate.source_url].filter(Boolean),
    selected_reason: '今日 10 篇候选中综合评分最高，已标记为 selected_candidate；本次 dry-run 不发布。',
    risk_notes: scored.risk_notes,
    image_quality_notes: imageInfo.cover && imageInfo.inlineIds.length ? '同源真实爱豆图已通过相关性与尺寸检查。' : `同源图片不足或被拒绝：${imageInfo.imageRejectReasons.join(', ') || '未知原因'}`,
    duplicate_check_result: '未命中 selected_candidate 去重规则。'
  };
  const articleId = db.prepare(`INSERT INTO articles (source_package_id, title, keyword, markdown, status, risk_score, risk_report, idol_name, group_name, material_scores_json, source_url, source_name, source_published_at, discovered_at, selected_reason, cover_image_id, inline_image_ids, total_score, topic_heat_score, freshness_score, image_quality_score, image_article_match_score, article_quality_score, predicted_read_score, anti_ai_score, risk_level, overall_risk_score, source_risk_score, image_copyright_risk_score, article_rewrite_risk_score, watermark_risk_score, platform_compliance_score, source_risk_level, source_policy_result, copyright_notes, auto_action_taken, auto_action_reason, auto_publish_reason, risk_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    sourcePackage.id, generated.title || candidate.title, candidate.keyword, generated.markdown || '', 'selected_candidate', review.score, review.report, candidate.idol_name, candidate.group_name, JSON.stringify(materialScores), candidate.source_url, candidate.source_name, candidate.source_published_at, materialScores.selected_reason, imageInfo.cover?.id || null, JSON.stringify(imageInfo.inlineIds), scored.total_score, scored.topic_heat_score, scored.freshness_score, scored.image_quality_score, scored.image_article_match_score, scored.article_quality_score, scored.predicted_read_score, scored.anti_ai_score, scored.risk_level, scored.total_score, scored.sourcePolicy.source_risk_score, Math.min(100, scored.image_quality_score * 7), review.score, scored.risk_level === 'high' ? 40 : 90, review.score, scored.sourcePolicy.source_risk_level, scored.sourcePolicy.source_policy_result, scored.risk_notes, 'dry_run_saved_to_articles', '已保存今日首选候选；本次 dry-run 不创建真实草稿、不发布。', 'dry-run no-publish：项目禁止自动发布。', JSON.stringify({ candidate, scored, review, source_package_id: sourcePackage.id })
  ).lastInsertRowid;
  db.prepare('UPDATE images SET article_id = ? WHERE source_package_id = ? AND local_path IS NOT NULL AND local_path <> ?').run(articleId, sourcePackage.id, '');
  db.prepare(`UPDATE source_packages SET article_id = ?, package_status = 'selected_candidate', cover_image_id = ?, inline_image_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(articleId, imageInfo.cover?.id || null, JSON.stringify(imageInfo.inlineIds), sourcePackage.id);
  return { articleId, generated, review, materialScores };
}

function getCandidatesForToday() {
  return db.prepare("SELECT * FROM daily_candidates WHERE run_date = date('now', 'localtime') ORDER BY rank ASC, total_score DESC").all();
}

function candidateFromSourcePackage(sourcePackage, searchItem = {}) {
  const title = sourcePackage.original_title || searchItem.title || '韩国娱乐公开图文';
  const baseCandidate = normalizeCandidate({
    keyword: sourcePackage.topic_keyword || title,
    title,
    angle: '基于同一个韩国媒体 source package 的公开事实和同页图片，改写成中文公众号素材。',
    idol_name: sourcePackage.idol_name || '',
    group_name: sourcePackage.group_name || '',
    event_type: sourcePackage.event_type || '',
    source_url: sourcePackage.source_url,
    source_name: sourcePackage.source_name,
    source_type: sourcePackage.source_type,
    source_summary: sourcePackage.original_excerpt || searchItem.snippet || '',
    candidate_reason: '真实搜索导入的同源图文 source package，文章和图片均来自同一个 source_url。',
    source_published_at: sourcePackage.source_published_at || searchItem.source_published_at || new Date().toISOString(),
    discovered_at: new Date().toISOString(),
    why_recent: sourcePackage.source_published_at ? '搜索结果标记为 48 小时内或页面提供发布时间。' : '页面未提供可靠发布时间，需人工复核。',
    source_count: 1,
    social_signal: sourcePackage.source_risk_level === 'low' ? 8 : 6,
    media_signal: sourcePackage.source_risk_level === 'high' ? 4 : 9,
    freshness_signal: 8,
    image_signal: sourcePackage.article_images.length,
    audience_signal: 8,
    image_candidates: sourcePackage.article_images
  });
  baseCandidate.image_candidates = baseCandidate.image_candidates.map((image) => {
    const evaluated = scoreImageCandidate(image, baseCandidate, title);
    return { ...image, image_relevance_score: evaluated.score, image_reject_reason: evaluated.rejectReason };
  });
  return baseCandidate;
}

async function loadCandidateSources() {
  const provider = config.search.provider || process.env.SEARCH_PROVIDER || 'mock';
  if (provider === 'mock') {
    const candidates = mockSearchRecentTopics().filter((candidate) => isWithinLast24Hours(candidate.source_published_at)).map(normalizeCandidate);
    return { candidates, searchMetrics: { provider, queryCount: 0, rawUrlCount: candidates.length, dedupedUrlCount: candidates.length, skippedCount: 0, skippedReasons: [] }, searchedUrlCount: candidates.length, importedPackageCount: candidates.length, mockMode: true };
  }
  const searchResult = await searchKoreanMediaUrlsDetailed();
  const searchedUrls = searchResult.items;
  logTask('korean_media_search_completed', 'success', `provider=${provider} query=${searchResult.metrics.queryCount} raw=${searchResult.metrics.rawUrlCount} deduped=${searchResult.metrics.dedupedUrlCount}`);
  const imported = [];
  let importSkippedCount = 0;
  const importSkippedReasons = [];
  for (const item of searchedUrls) {
    if (imported.length >= config.search.maxSourcePackagesPerRun) break;
    try {
      const sourcePackage = await importKoreanArticleWithImages(item.source_url, { source_name: item.source_name, source_type: item.source_type, source_published_at: item.source_published_at });
      const pageReject = rejectSourcePage(sourcePackage);
      if (pageReject) {
        importSkippedCount += 1;
        importSkippedReasons.push({ reason: pageReject, url: sourcePackage.source_url });
        logTask('source_package_skipped_non_idol_page', 'skipped', `${sourcePackage.source_url} ${pageReject}`);
        continue;
      }
      if (sourcePackage.source_published_at && !isWithinLast48Hours(sourcePackage.source_published_at)) {
        importSkippedCount += 1;
        importSkippedReasons.push({ reason: '发布时间超过 48 小时', url: sourcePackage.source_url });
        continue;
      }
      const candidate = candidateFromSourcePackage(sourcePackage, item);
      const usable = sameSourceImages(candidate).filter((image) => Number(image.image_relevance_score || 0) >= 80 && !image.image_reject_reason);
      if (usable.length < 2) {
        importSkippedCount += 1;
        const reasons = sameSourceImages(candidate).map((image) => image.image_reject_reason || (Number(image.image_relevance_score || 0) < 80 ? 'image_subject_uncertain' : '')).filter(Boolean);
        importSkippedReasons.push({ reason: `没有足够真实爱豆图：${[...new Set(reasons)].join(', ') || 'image_subject_uncertain'}`, url: sourcePackage.source_url });
        logTask('source_package_skipped_no_idol_images', 'skipped', `${sourcePackage.source_url} 没有足够真实爱豆图`);
        continue;
      }
      imported.push(candidate);
      logTask('source_package_imported', 'success', `${sourcePackage.source_url} 可用爱豆图 ${usable.length} 张`);
    } catch (error) {
      importSkippedCount += 1;
      importSkippedReasons.push({ reason: error.message, url: item.source_url });
      logTask('source_package_import_failed', 'failed', `${item.source_url} ${error.message}`);
    }
  }
  return { candidates: imported, searchMetrics: { ...searchResult.metrics, importSkippedCount, skippedCount: searchResult.metrics.skippedCount + importSkippedCount, skippedReasons: [...searchResult.metrics.skippedReasons, ...importSkippedReasons].slice(0, 20) }, searchedUrlCount: searchedUrls.length, importedPackageCount: imported.length, mockMode: false };
}

function isEligibleSelectedCandidate(row) {
  const realSourceOk = row.mockMode || !String(row.candidate.source_url || '').includes('example.com/mock');
  return realSourceOk
    && !row.duplicate
    && row.scored.risk_level !== 'high'
    && row.imageInfo.cover
    && row.imageInfo.inlineIds.length > 0
    && row.imageInfo.imageArticleMatchScore >= 80
    && row.imageInfo.imageQualityScore >= 70
    && row.scored.image_article_match_score >= 13
    && row.candidate.image_candidates.every((image) => image.source_url === row.candidate.source_url);
}

async function prepareCandidateRow(candidate, scored, rank, duplicate, mockMode) {
  const sourcePackage = upsertSourcePackage(candidate, scored, duplicate ? 'skipped' : 'candidate');
  const packageImages = await ensurePackageImages(candidate, sourcePackage, mockMode);
  const association = updateSourcePackageImages(sourcePackage.id, packageImages);
  const imageInfo = { ...association, imageCount: packageImages.length, usableImageCount: packageImages.filter((image) => image.local_path).length };
  const status = duplicate || !imageInfo.cover || !imageInfo.inlineIds.length ? 'skipped' : 'candidate';
  const selectedReason = duplicate || (!imageInfo.cover || !imageInfo.inlineIds.length ? `图片未通过相关性/尺寸检查：${imageInfo.imageRejectReasons.join(', ') || 'no_usable_idol_images'}` : candidate.candidate_reason);
  const id = insertCandidate(candidate, scored, sourcePackage, imageInfo, rank, status, selectedReason);
  return { id, candidate, scored, status, duplicate, selectedReason, sourcePackage, packageImages, imageInfo, mockMode };
}

async function generateDailyCandidates() {
  logTask('daily_candidates_started', 'started', '开始生成今日 10 篇候选文章，source package dry-run/no-publish');
  const loaded = await loadCandidateSources();
  const candidates = loaded.candidates.slice(0, config.search.maxSourcePackagesPerRun || 10);
  if (!candidates.length) throw new Error('未导入可用的同源真实爱豆图 source package。请检查 Tavily 搜索结果或媒体页面图片。');
  const scored = candidates.map((candidate) => ({ candidate, scored: scoreCandidate(candidate) })).sort((left, right) => right.scored.total_score - left.scored.total_score).slice(0, 10);
  const rows = [];
  for (const [index, item] of scored.entries()) rows.push(await prepareCandidateRow(item.candidate, item.scored, index + 1, duplicateReason(item.candidate), loaded.mockMode));
  const selected = rows.find(isEligibleSelectedCandidate);
  if (!selected) throw new Error('未生成带同源封面图和正文图、且图片相关性达标的可用非高风险候选文章。');
  const articleResult = await buildSelectedArticle(selected.candidate, selected.scored, selected.sourcePackage, selected.packageImages, selected.imageInfo);
  db.prepare(`UPDATE daily_candidates SET status = 'selected_candidate', article_id = ?, cover_image_id = ?, inline_image_ids = ?, selected_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(articleResult.articleId, selected.imageInfo.cover?.id || null, JSON.stringify(selected.imageInfo.inlineIds), '今日 10 篇候选中综合评分最高且拥有同源真实爱豆封面图和正文图，已保存到文章素材库。', selected.id);
  logTask('selected_candidate_saved_to_articles', 'success', `文章 #${articleResult.articleId} 已保存，cover_image_id=${selected.imageInfo.cover?.id || '-'} inline_image_ids=${JSON.stringify(selected.imageInfo.inlineIds)}`);
  logTask('auto_publish_blocked_dry_run', 'blocked', '本次试运行禁止发布接口调用，只保存候选、同源图片和文章素材。');
  return {
    generatedCount: rows.length,
    scoredCount: rows.length,
    searchProvider: loaded.searchMetrics.provider,
    searchQueryCount: loaded.searchMetrics.queryCount,
    tavilyReturnedUrlCount: loaded.searchMetrics.rawUrlCount,
    dedupedUrlCount: loaded.searchMetrics.dedupedUrlCount,
    skippedCount: loaded.searchMetrics.skippedCount + rows.filter((row) => row.status === 'skipped').length,
    skippedReasons: [...loaded.searchMetrics.skippedReasons, ...rows.filter((row) => row.status === 'skipped').map((row) => ({ reason: row.selectedReason, url: row.candidate.source_url }))].slice(0, 20),
    searchedUrlCount: loaded.searchedUrlCount,
    importedPackageCount: loaded.importedPackageCount,
    completeSourcePackageCount: rows.filter((row) => row.imageInfo.cover && row.imageInfo.inlineIds.length).length,
    downloadedImageCount: rows.reduce((sum, row) => sum + row.imageInfo.usableImageCount, 0),
    coverImageCount: rows.filter((row) => row.imageInfo.cover).length,
    inlineImagePackageCount: rows.filter((row) => row.imageInfo.inlineIds.length).length,
    sameSourcePassedCount: rows.filter((row) => row.candidate.image_candidates.every((image) => image.source_url === row.candidate.source_url)).length,
    lowRiskCount: rows.filter((row) => row.scored.risk_level === 'low').length,
    mediumRiskCount: rows.filter((row) => row.scored.risk_level === 'medium').length,
    highRiskCount: rows.filter((row) => row.scored.risk_level === 'high').length,
    selectedCandidate: { title: selected.candidate.title, total_score: selected.scored.total_score, risk_level: selected.scored.risk_level, article_id: articleResult.articleId, source_package_id: selected.sourcePackage.id, cover_image_id: selected.imageInfo.cover?.id || null, inline_image_ids: selected.imageInfo.inlineIds, source_url: selected.candidate.source_url, source_name: selected.candidate.source_name, image_relevance_score: selected.imageInfo.imageArticleMatchScore },
    savedToArticles: true,
    savedToImages: true,
    wechatDraftCreated: false,
    published: false,
    dryRun: true,
    mockMode: loaded.mockMode
  };
}

module.exports = { generateDailyCandidates, getCandidatesForToday, scoreCandidate };
