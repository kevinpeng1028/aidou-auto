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
  ['inline_image_ids', "TEXT NOT NULL DEFAULT '[]'"]
];

function migrateArticlesTable() {
  const columns = db.prepare('PRAGMA table_info(articles)').all().map((column) => column.name);
  for (const [name, definition] of articleColumns) {
    if (!columns.includes(name)) {
      db.exec(`ALTER TABLE articles ADD COLUMN ${name} ${definition}`);
    }
  }
}

function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrateArticlesTable();
}

function touchArticle(id) {
  db.prepare('UPDATE articles SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

module.exports = { db, initDb, touchArticle };
