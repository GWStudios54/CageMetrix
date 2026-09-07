import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('owner admin account is role-gated and moderation routes are wired',()=>{
  const migration=fs.readFileSync('migrations/0018_admin_account.sql','utf8');
  const rename=fs.readFileSync('migrations/0020_admin_desk_identity.sql','utf8');
  const worker=fs.readFileSync('src/worker.ts','utf8');
  const admin=fs.readFileSync('src/admin.ts','utf8');
  const session=fs.readFileSync('src/admin-session.ts','utf8');
  const auth=fs.readFileSync('src/admin-auth.ts','utf8');
  assert.match(migration,/ADD COLUMN role TEXT NOT NULL DEFAULT 'member'/);
  assert.match(migration,/cagemetrix_owner54/);
  assert.match(migration,/'admin'/);
  assert.match(rename,/handle='cagemetrix_desk'/);
  assert.match(rename,/display_name='CageMetrix Desk'/);
  assert.match(worker,/cagemetrix_desk/);
  assert.match(worker,/\/u\/cagemetrix_owner54/);
  assert.match(auth,/OWNER_HANDLE='cagemetrix_desk'/);
  assert.match(worker,/\/api\/admin/);
  assert.match(worker,/adminModeratePost/);
  assert.match(worker,/adminResolveReports/);
  assert.match(session,/a\.role='admin'/);
  assert.match(admin,/Admin panel/);
  assert.match(admin,/resolved_at/);
});
