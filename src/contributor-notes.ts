import {contributor} from './contributors.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const ID_RE=/^[1-9]\d{0,14}$/;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});

async function boutForNotes(db:D1Database,id:string){
  if(!ID_RE.test(id)||!Number.isSafeInteger(Number(id)))return null;
  return db.prepare(`SELECT b.id,b.status,b.fighter_a_id,b.fighter_b_id,e.starts_at
    FROM bouts b JOIN events e ON e.id=b.event_id
    WHERE b.id=? AND EXISTS(SELECT 1 FROM predictions p WHERE p.bout_id=b.id)`).bind(Number(id)).first<Row>();
}

async function notesForBout(db:D1Database,boutId:number){
  const rows=await db.prepare(`SELECT n.contributor_id,c.slug,c.display_name,c.bio,n.title,n.body,n.picked_fighter_id,n.revision
    FROM contributor_prefight_notes n JOIN contributors c ON c.id=n.contributor_id
    WHERE n.bout_id=?
    ORDER BY CASE WHEN c.slug='primary-contributor' THEN 0 ELSE 1 END,c.display_name COLLATE NOCASE,c.id`).bind(boutId).all<Row>();
  return rows.results;
}

export async function getContributorNotes(_request:Request,env:Env,id:string){
  const bout=await boutForNotes(env.DB,id);
  if(!bout)return json({error:'fight_not_found'},404);
  const start=Date.parse(bout.starts_at),canPublish=bout.status==='scheduled'&&Number.isFinite(start)&&Date.now()<start;
  return json({notes:await notesForBout(env.DB,bout.id),meta:{can_publish:canPublish,locks_at:bout.starts_at}});
}

export async function saveContributorNote(request:Request,env:Env,id:string){
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)return json({error:'Cross-origin publishing is not allowed.'},403);
  const who=await contributor(request,env.DB);
  if(!who)return json({error:'A valid contributor publishing key is required.'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Send application/json.'},415);
  const text=await request.text();
  if(new TextEncoder().encode(text).length>36000)return json({error:'Pre-fight note is too large.'},413);
  let body:any;try{body=JSON.parse(text);}catch{return json({error:'Invalid JSON.'},400);}
  if(!Number.isInteger(body?.revision)||body.revision<0)return json({error:'Include a valid revision.'},400);
  const title=typeof body.title==='string'?body.title.trim():'';
  const article=typeof body.body==='string'?body.body.trim():'';
  if(title.length>160)return json({error:'Headline must be 160 characters or fewer.'},400);
  if(article.length<1||article.length>30000)return json({error:'Pre-fight note must be between 1 and 30,000 characters.'},400);
  const picked=body.picked_fighter_id===null||body.picked_fighter_id===undefined?null:Number(body.picked_fighter_id);
  if(picked!==null&&!Number.isInteger(picked))return json({error:'Pick must be one of the two fighters or no pick.'},400);

  const bout=await boutForNotes(env.DB,id);
  if(!bout)return json({error:'fight_not_found'},404);
  const start=Date.parse(bout.starts_at);
  if(bout.status!=='scheduled'||!Number.isFinite(start)||Date.now()>=start)return json({error:'Pre-fight notes are locked once the card starts.'},409);
  if(picked!==null&&![Number(bout.fighter_a_id),Number(bout.fighter_b_id)].includes(picked))return json({error:'Pick must be one of the two fighters or no pick.'},400);

  const result=body.revision===0
    ?await env.DB.prepare(`INSERT INTO contributor_prefight_notes(bout_id,contributor_id,title,body,picked_fighter_id,revision)
      VALUES(?,?,?,?,?,1) ON CONFLICT(bout_id,contributor_id) DO NOTHING RETURNING revision`).bind(bout.id,who.id,title,article,picked).first<Row>()
    :await env.DB.prepare(`UPDATE contributor_prefight_notes SET title=?,body=?,picked_fighter_id=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE bout_id=? AND contributor_id=? AND revision=? RETURNING revision`).bind(title,article,picked,bout.id,who.id,body.revision).first<Row>();
  if(!result)return json({error:'This pre-fight note changed in another editor. Reload before saving again.'},409);
  return json({revision:result.revision,notes:await notesForBout(env.DB,bout.id)});
}
