PRAGMA foreign_keys=ON;

UPDATE community_accounts
SET recovery_hash='9ae5e0ca4f77555dc73ac5b36ae0848bd060fe871843f2b0023f4612d882bc40',
    role='admin',
    display_name='CageMetrix Owner',
    bio='CageMetrix administrator.',
    updated_at=CURRENT_TIMESTAMP
WHERE handle='cagemetrix_owner54' COLLATE NOCASE;

INSERT INTO community_accounts(handle,display_name,bio,recovery_hash,fan_voter_id,role)
SELECT
  'cagemetrix_owner54',
  'CageMetrix Owner',
  'CageMetrix administrator.',
  '9ae5e0ca4f77555dc73ac5b36ae0848bd060fe871843f2b0023f4612d882bc40',
  'df6145ac-b0c8-4874-aab9-fa13d2d44a55',
  'admin'
WHERE NOT EXISTS(
  SELECT 1 FROM community_accounts WHERE handle='cagemetrix_owner54' COLLATE NOCASE
);
