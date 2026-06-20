const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

function touchArticle(id) {
  db.prepare('UPDATE articles SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

module.exports = { db, initDb, touchArticle };
