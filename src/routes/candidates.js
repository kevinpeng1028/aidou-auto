const express = require('express');
const { db } = require('../db');
const { generateDailyCandidates, getCandidatesForToday } = require('../services/dailyCandidateSelector');
const { testTavilySearch } = require('../services/koreanMediaSearch');

const router = express.Router();

function parseImages(row) {
  try {
    return JSON.parse(row.image_candidates_json || '[]');
  } catch (error) {
    return [];
  }
}

function parseInlineIds(row) {
  try {
    return JSON.parse(row.inline_image_ids || '[]');
  } catch (error) {
    return [];
  }
}

function getCandidateTaskState() {
  if (!globalThis.__aidouDailyCandidateTask) {
    globalThis.__aidouDailyCandidateTask = { running: false, lastResult: null, lastError: null };
  }
  return globalThis.__aidouDailyCandidateTask;
}

function startDailyCandidateJob() {
  const state = getCandidateTaskState();
  if (state.running) {
    return { started: false, running: true, message: '候选生成任务正在运行，请不要重复点击。' };
  }

  state.running = true;
  state.lastError = null;
  db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
    .run('daily_candidates_background_job', 'running', '候选生成任务已开始，请稍后刷新查看结果。');

  Promise.resolve()
    .then(() => generateDailyCandidates())
    .then((result) => {
      state.lastResult = result;
      const status = result.partialSuccess ? 'partial_success' : 'success';
      db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
        .run('daily_candidates_background_job', status, result.message || `候选生成完成 importedPackageCount=${result.importedPackageCount || 0} selectedCandidateCount=${result.selectedCandidateCount || 0}`);
    })
    .catch((error) => {
      state.lastError = { message: error.message || '生成每日候选失败', code: error.code || 'DAILY_CANDIDATES_FAILED' };
      db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
        .run('daily_candidates_background_job', 'failed', state.lastError.message);
    })
    .finally(() => {
      state.running = false;
    });

  return { started: true, running: true, message: '候选生成任务已开始，请稍后刷新查看结果。' };
}

function summarizeRows(rows) {
  const selected = rows.find((row) => row.status === 'selected_candidate');
  return {
    generatedCount: rows.length,
    scoredCount: rows.filter((row) => row.total_score > 0).length,
    completeSourcePackageCount: rows.filter((row) => row.cover_image_id && parseInlineIds(row).length).length,
    downloadedImageCount: rows.reduce((sum, row) => sum + Number(row.usable_image_count || 0), 0),
    selectedCandidateCount: rows.filter((row) => row.status === 'selected_candidate').length,
    reviewCount: rows.filter((row) => ['review', 'review_images_needed'].includes(row.status)).length,
    imageInsufficientCount: rows.filter((row) => row.status === 'image_insufficient').length,
    highRiskSkippedCount: rows.filter((row) => row.status === 'high_risk_skipped').length,
    lowRiskCount: rows.filter((row) => row.risk_level === 'low').length,
    mediumRiskCount: rows.filter((row) => row.risk_level === 'medium').length,
    highRiskCount: rows.filter((row) => row.risk_level === 'high').length,
    selectedCandidate: selected ? {
      title: selected.title,
      total_score: selected.total_score,
      risk_level: selected.risk_level,
      article_id: selected.article_id,
      source_package_id: selected.source_package_id,
      cover_image_id: selected.cover_image_id,
      inline_image_ids: parseInlineIds(selected)
    } : null
  };
}

router.get('/candidates', (req, res) => {
  const rows = getCandidatesForToday().map((row) => ({ ...row, image_candidates: parseImages(row) }));
  const taskState = getCandidateTaskState();
  const result = req.session.dailyCandidateResult || taskState.lastResult || null;
  const error = req.session.dailyCandidateError || taskState.lastError || null;
  const tavilyTestResult = req.session.tavilyTestResult || null;
  const tavilyTestError = req.session.tavilyTestError || null;
  delete req.session.dailyCandidateResult;
  delete req.session.dailyCandidateError;
  delete req.session.tavilyTestResult;
  delete req.session.tavilyTestError;

  res.render('candidates/index', {
    title: '每日候选文章',
    rows,
    summary: summarizeRows(rows),
    result,
    error,
    taskRunning: taskState.running,
    tavilyTestResult,
    tavilyTestError
  });
});

router.post('/candidates/test-tavily', async (req, res) => {
  try {
    const query = String(req.body.query || 'K-pop idol photos site:soompi.com').trim().slice(0, 200);
    const maxResults = Math.max(1, Math.min(10, Number(req.body.max_results || 5)));
    req.session.tavilyTestResult = await testTavilySearch({ query, maxResults });
    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
      .run('tavily_search_tested', 'success', `Tavily 搜索测试 query="${query}" results=${req.session.tavilyTestResult.result_count}`);
  } catch (error) {
    req.session.tavilyTestError = {
      message: error.message || 'Tavily 搜索测试失败',
      code: error.code || 'TAVILY_TEST_FAILED'
    };
    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
      .run('tavily_search_test_failed', 'failed', req.session.tavilyTestError.message);
  }
  res.redirect('/candidates');
});

router.post('/candidates/generate', (req, res) => {
  const result = startDailyCandidateJob();
  req.session.dailyCandidateResult = result;
  res.redirect('/candidates');
});

module.exports = router;
