const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const articleColumns = [
  ['idol_name', "TEXT NOT NULL DEFAULT ''"],
  ['group_name', "TEXT NOT NULL DEFAULT ''"],
  ['material_scores_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['source_url', "TEXT NOT NULL DEFAULT ''"],
  ['source_name', "TEXT NOT NULL DEFAULT ''"],
  ['source_published_at', 'TEXT'],
  ['discovered_at', 'TEXT'],
  ['selected_reason', "TEXT NOT NULL DEFAULT ''"],
  ['cover_image_id', 'INTEGER'],
  ['inline_image_ids', "TEXT NOT NULL DEFAULT '[]'"],
  ['wechat_draft_media_id', 'TEXT'],
  ['wechat_thumb_media_id', 'TEXT'],
  ['draft_created_at', 'TEXT'],
  ['wechat_template_id', 'TEXT'],
  ['template_id', 'TEXT'],
  ['rendered_html', 'TEXT'],
  ['preview_html', 'TEXT'],
  ['total_score', 'INTEGER'],
  ['topic_heat_score', 'INTEGER'],
  ['freshness_score', 'INTEGER'],
  ['image_quality_score', 'INTEGER'],
  ['image_relevance_score', 'INTEGER'],
  ['image_article_match_score', 'INTEGER'],
  ['article_quality_score', 'INTEGER'],
  ['predicted_read_score', 'INTEGER'],
  ['anti_ai_score', 'INTEGER'],
  ['risk_level', "TEXT NOT NULL DEFAULT '中'"],
  ['overall_risk_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['source_risk_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['image_copyright_risk_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['article_rewrite_risk_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['watermark_risk_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['platform_compliance_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['source_risk_level', "TEXT NOT NULL DEFAULT ''"],
  ['source_policy_result', "TEXT NOT NULL DEFAULT ''"],
  ['copyright_notes', "TEXT NOT NULL DEFAULT ''"],
  ['auto_action_taken', "TEXT NOT NULL DEFAULT ''"],
  ['auto_action_reason', "TEXT NOT NULL DEFAULT ''"],
  ['wechat_publish_id', "TEXT NOT NULL DEFAULT ''"],
  ['published_at', 'TEXT'],
  ['auto_publish_reason', "TEXT NOT NULL DEFAULT ''"],
  ['risk_snapshot_json', "TEXT NOT NULL DEFAULT '{}'"]
];

const imageColumns = [
  ['article_id', 'INTEGER'],
  ['usage_scene', "TEXT NOT NULL DEFAULT '文章内图'"],
  ['local_path', 'TEXT'],
  ['original_url', 'TEXT'],
  ['source_url', 'TEXT'],
  ['source_name', "TEXT NOT NULL DEFAULT ''"],
  ['source_note', "TEXT NOT NULL DEFAULT ''"],
  ['image_caption', 'TEXT'],
  ['caption', 'TEXT'],
  ['image_description', 'TEXT'],
  ['risk_level', "TEXT NOT NULL DEFAULT '中'"]
];

const dailyCandidateColumns = [
  ['article_id', 'INTEGER'],
  ['run_date', "TEXT NOT NULL DEFAULT ''"],
  ['rank', 'INTEGER NOT NULL DEFAULT 0'],
  ['title', "TEXT NOT NULL DEFAULT ''"],
  ['idol_name', "TEXT NOT NULL DEFAULT ''"],
  ['group_name', "TEXT NOT NULL DEFAULT ''"],
  ['topic_keyword', "TEXT NOT NULL DEFAULT ''"],
  ['source_url', "TEXT NOT NULL DEFAULT ''"],
  ['source_name', "TEXT NOT NULL DEFAULT ''"],
  ['source_published_at', 'TEXT'],
  ['source_type', "TEXT NOT NULL DEFAULT ''"],
  ['source_summary', "TEXT NOT NULL DEFAULT ''"],
  ['candidate_reason', "TEXT NOT NULL DEFAULT ''"],
  ['selected_reason', "TEXT NOT NULL DEFAULT ''"],
  ['risk_notes', "TEXT NOT NULL DEFAULT ''"],
  ['image_candidates_json', "TEXT NOT NULL DEFAULT '[]'"],
  ['risk_level', "TEXT NOT NULL DEFAULT ''"],
  ['status', "TEXT NOT NULL DEFAULT 'candidate'"],
  ['freshness_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['topic_heat_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['image_quality_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['image_article_match_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['article_quality_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['predicted_read_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['risk_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['anti_ai_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['total_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['created_at', "TEXT NOT NULL DEFAULT ''"],
  ['updated_at', "TEXT NOT NULL DEFAULT ''"]
];

function migrateTable(tableName, columnsToAdd) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
  for (const [name, definition] of columnsToAdd) {
    if (!columns.includes(name)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`);
    }
  }
}

function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrateTable('articles', articleColumns);
  migrateTable('images', imageColumns);
  migrateTable('daily_candidates', dailyCandidateColumns);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_cover_image_id ON articles(cover_image_id);
    CREATE INDEX IF NOT EXISTS idx_articles_wechat_template_id ON articles(wechat_template_id);
    CREATE INDEX IF NOT EXISTS idx_articles_risk_level ON articles(risk_level);
    CREATE INDEX IF NOT EXISTS idx_articles_overall_risk_score ON articles(overall_risk_score);
    CREATE INDEX IF NOT EXISTS idx_daily_candidates_run_date ON daily_candidates(run_date);
    CREATE INDEX IF NOT EXISTS idx_daily_candidates_status ON daily_candidates(status);
    CREATE INDEX IF NOT EXISTS idx_daily_candidates_score ON daily_candidates(total_score);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_candidates_source_url ON daily_candidates(source_url) WHERE source_url <> '';
    CREATE INDEX IF NOT EXISTS idx_images_article_id ON images(article_id);
  `);
}

function touchArticle(id) {
  db.prepare('UPDATE articles SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

module.exports = { db, initDb, touchArticle };
