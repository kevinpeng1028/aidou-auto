const express = require('express');
const { db } = require('../db');
const { generateDailyCandidates, getCandidatesForToday } = require('../services/dailyCandidateSelector');

const router = express.Router();

function parseImages(row) {
  try {
    return JSON.parse(row.image_candidates_json || '[]');
  } catch (error) {
    return [];
  }
}

function summarizeRows(rows) {
  const selected = rows.find((row) => row.status === 'selected_candidate');
  return {
    generatedCount: rows.length,
    scoredCount: rows.filter((row) => row.total_score > 0).length,
    lowRiskCount: rows.filter((row) => row.risk_level === 'low').length,
    mediumRiskCount: rows.filter((row) => row.risk_level === 'medium').length,
    highRiskCount: rows.filter((row) => row.risk_level === 'high').length,
    selectedCandidate: selected ? {
      title: selected.title,
      total_score: selected.total_score,
      risk_level: selected.risk_level,
      article_id: selected.article_id
    } : null
  };
}

router.get('/candidates', (req, res) => {
  const rows = getCandidatesForToday().map((row) => ({ ...row, image_candidates: parseImages(row) }));
  const result = req.session.dailyCandidateResult || null;
  const error = req.session.dailyCandidateError || null;
  delete req.session.dailyCandidateResult;
  delete req.session.dailyCandidateError;

  res.render('candidates/index', {
    title: '每日候选文章',
    rows,
    summary: summarizeRows(rows),
    result,
    error
  });
});

router.post('/candidates/generate', async (req, res) => {
  try {
    req.session.dailyCandidateResult = await generateDailyCandidates();
  } catch (error) {
    req.session.dailyCandidateError = {
      message: error.message || '生成每日候选失败',
      code: error.code || 'DAILY_CANDIDATES_FAILED'
    };
    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
      .run('daily_candidates_failed', 'failed', req.session.dailyCandidateError.message);
  }
  res.redirect('/candidates');
});

module.exports = router;
