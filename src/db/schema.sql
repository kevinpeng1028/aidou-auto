CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  keyword TEXT,
  markdown TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  risk_score INTEGER NOT NULL DEFAULT 100,
  risk_report TEXT NOT NULL DEFAULT '',
  idol_name TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  material_scores_json TEXT NOT NULL DEFAULT '{}',
  source_url TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '',
  source_published_at TEXT,
  discovered_at TEXT,
  selected_reason TEXT NOT NULL DEFAULT '',
  cover_image_id INTEGER,
  inline_image_ids TEXT NOT NULL DEFAULT '[]',
  wechat_draft_media_id TEXT,
  wechat_thumb_media_id TEXT,
  draft_created_at TEXT,
  wechat_template_id TEXT,
  template_id TEXT,
  rendered_html TEXT,
  preview_html TEXT,
  total_score INTEGER,
  risk_level TEXT NOT NULL DEFAULT '中',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  title TEXT NOT NULL,
  angle TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER,
  url TEXT NOT NULL DEFAULT '',
  original_url TEXT,
  source_url TEXT,
  source_name TEXT NOT NULL DEFAULT '',
  source_note TEXT NOT NULL DEFAULT '',
  auth_status TEXT NOT NULL DEFAULT '待确认',
  risk_level TEXT NOT NULL DEFAULT '中',
  usage_scene TEXT NOT NULL DEFAULT '文章内图',
  local_path TEXT,
  image_caption TEXT,
  caption TEXT,
  image_description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_idol_name ON articles(idol_name);
CREATE INDEX IF NOT EXISTS idx_articles_group_name ON articles(group_name);
CREATE INDEX IF NOT EXISTS idx_articles_cover_image_id ON articles(cover_image_id);
CREATE INDEX IF NOT EXISTS idx_articles_wechat_template_id ON articles(wechat_template_id);
CREATE INDEX IF NOT EXISTS idx_topics_created_at ON topics(created_at);
CREATE INDEX IF NOT EXISTS idx_images_article_id ON images(article_id);
