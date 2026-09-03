-- Seed one operator-owned contributor key for the site owner's trusted device.
-- Only the SHA-256 hash is stored; the plaintext publishing key is never committed.
INSERT OR IGNORE INTO contributors(id,slug,display_name,bio)
VALUES(1000000,'primary-contributor','CageMetrix Desk','Primary CageMetrix contributor.');

INSERT OR IGNORE INTO contributor_keys(id,contributor_id,token_hash)
SELECT 'd2ef5253-f6c5-421b-b253-0abe29c82a33',id,'278fcfa3ba05fcc45db32232645d1cf3ce23f43cbf5b0604f70f7cb970e39f87'
FROM contributors WHERE slug='primary-contributor';
