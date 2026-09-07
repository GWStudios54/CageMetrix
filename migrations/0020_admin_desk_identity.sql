PRAGMA foreign_keys=ON;

UPDATE community_accounts
SET handle='cagemetrix_desk',
    display_name='CageMetrix Desk',
    updated_at=CURRENT_TIMESTAMP
WHERE handle='cagemetrix_owner54' COLLATE NOCASE;
