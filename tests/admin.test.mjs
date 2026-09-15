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

test('production entry point can still issue an admin session even though community accounts are retired',()=>{
  const entry=fs.readFileSync('src/entry.ts','utf8');
  const communityBlockIndex=entry.search(/path\.startsWith\('\/api\/community'\)/);
  const loginRouteIndex=entry.search(/path==='\/api\/community\/login'/);
  assert.match(entry,/import \{ownerAdminLogin\} from '\.\/admin-auth\.ts'/);
  assert.ok(loginRouteIndex>=0,'entry.ts must route /api/community/login somewhere');
  assert.ok(communityBlockIndex>=0,'entry.ts must still retire the rest of /api/community');
  assert.ok(loginRouteIndex<communityBlockIndex,'/api/community/login must be handled before the blanket /api/community retirement, or admin login is permanently unreachable in production');
  assert.match(entry,/path==='\/api\/community\/login'&&request\.method==='POST'\)return ownerAdminLogin\(request,env\)/);
});

test('admin management-mutation endpoints reject cross-origin requests like every other admin mutation route',()=>{
  const talentAdmin=fs.readFileSync('src/talent-admin.ts','utf8');
  const talentNetwork=fs.readFileSync('src/talent-network.ts','utf8');
  assert.match(talentAdmin,/import \{adminAccount,sameOrigin\} from '\.\/admin-session\.ts'/);
  const setBody=talentAdmin.slice(talentAdmin.indexOf('export async function setManagementApi'),talentAdmin.indexOf('export async function endManagementApi'));
  assert.match(setBody,/if\(!sameOrigin\(request\)\)/);
  const endBody=talentAdmin.slice(talentAdmin.indexOf('export async function endManagementApi'));
  assert.match(endBody,/if\(!sameOrigin\(request\)\)/);
  assert.match(talentNetwork,/import \{adminAccount,sameOrigin\} from '\.\/admin-session\.ts'/);
  const talentAdminApiBody=talentNetwork.slice(talentNetwork.indexOf('export async function talentAdminApi'));
  assert.match(talentAdminApiBody,/if\(!sameOrigin\(request\)\)/);
});
