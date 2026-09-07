PRAGMA foreign_keys=ON;

ALTER TABLE community_accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin'));
ALTER TABLE community_reports ADD COLUMN resolved_at TEXT;
ALTER TABLE community_reports ADD COLUMN resolved_by INTEGER;

CREATE INDEX IF NOT EXISTS idx_community_accounts_role ON community_accounts(role);
CREATE INDEX IF NOT EXISTS idx_community_reports_open ON community_reports(resolved_at,created_at);

INSERT OR IGNORE INTO community_accounts(
  handle,display_name,bio,recovery_hash,fan_voter_id,role
) VALUES(
  'cagemetrix_owner54',
  'CageMetrix Owner',
  'CageMetrix administrator.',
  '93b4fd84a0bb9da38da446db3a30092bd30fdaa3d82a486d21b0c4e74a06db7f',
  'bc0d27a9-2782-4b43-90ec-f7ec2ac05526',
  'admin'
);
