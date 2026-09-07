PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS forum_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK(category IN ('cagemetrix','mma','off-topic')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 120),
  account_id INTEGER NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY(account_id) REFERENCES community_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_forum_threads_category_activity ON forum_threads(category,updated_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS forum_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  parent_id INTEGER,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY(thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
  FOREIGN KEY(account_id) REFERENCES community_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_id) REFERENCES forum_posts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_forum_posts_thread ON forum_posts(thread_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_forum_posts_account ON forum_posts(account_id,created_at DESC);

CREATE TABLE IF NOT EXISTS forum_reactions (
  post_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(post_id,account_id),
  FOREIGN KEY(post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
  FOREIGN KEY(account_id) REFERENCES community_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS forum_reports (
  post_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'user_report',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  PRIMARY KEY(post_id,reporter_id),
  FOREIGN KEY(post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
  FOREIGN KEY(reporter_id) REFERENCES community_accounts(id) ON DELETE CASCADE
);
