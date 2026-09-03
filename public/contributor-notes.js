(() => {
  const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id=location.pathname.match(/^\/fights\/([1-9]\d*)\/?$/)?.[1];
  if(!id||!$('#prefight-notes'))return;
  let data={notes:[],meta:{can_publish:false}},who=null,token='',revision=0;
  let fight=null;try{fight=JSON.parse($('#fight-data')?.textContent||'null');}catch{}
  const fighters=fight?{
    a:{id:Number(fight.bout.fighter_a_id),name:fight.prediction.snapshot?.available?fight.prediction.snapshot.fighters.a.name:fight.bout.fighter_a_name},
    b:{id:Number(fight.bout.fighter_b_id),name:fight.prediction.snapshot?.available?fight.prediction.snapshot.fighters.b.name:fight.bout.fighter_b_name}
  }:null;
  const authHeaders=extra=>{const headers={...extra};if(token)headers.authorization=`Bearer ${token}`;return headers;};
  const paragraphs=body=>String(body||'').split(/\n\s*\n/).filter(Boolean).map(p=>`<p>${esc(p)}</p>`).join('');
  const fighterName=id=>fighters&&Number(id)===fighters.a.id?fighters.a.name:fighters&&Number(id)===fighters.b.id?fighters.b.name:null;
  function renderNotes(){
    $('#prefight-notes').innerHTML=data.notes.length?`<div class="prefight-note-list">${data.notes.map(note=>{
      const pick=fighterName(note.picked_fighter_id);
      return `<article class="prefight-note"><header><div><div class="byline">By ${esc(note.display_name)}</div><h3>${esc(note.title||'Contributor note')}</h3></div>${pick?`<span class="pick-badge">Pick: ${esc(pick)}</span>`:''}</header><div class="prefight-note-body">${paragraphs(note.body)}</div></article>`;
    }).join('')}</div>`:'<p class="prefight-note-empty">No contributor pre-fight notes have been published yet.</p>';
    const lock=$('#note-lock');if(lock){lock.hidden=data.meta.can_publish;lock.textContent='Pre-fight notes are locked once the published card starts. Existing notes remain on the record.';}
    const editor=$('.note-editor');if(editor)editor.hidden=!data.meta.can_publish;
    if(who&&data.meta.can_publish)loadEditor();
  }
  function loadEditor(){
    const form=$('#prefight-note-form');if(!form||!data.meta.can_publish)return;
    const mine=data.notes.find(n=>n.contributor_id===who.id);revision=mine?.revision||0;
    $('#note-title').value=mine?.title||'';$('#note-body').value=mine?.body||'';
    $('#note-pick').value=mine?.picked_fighter_id==null?'':String(mine.picked_fighter_id);
    $('#note-editor-name').textContent=`Publishing as ${who.display_name}`;
    $('#note-connect').hidden=true;form.hidden=false;
  }
  async function load(){
    const r=await fetch(`/api/fights/${id}/notes`,{cache:'no-store'});if(!r.ok)throw new Error('Contributor notes unavailable');
    data=await r.json();renderNotes();
  }
  async function restore(){
    try{const r=await fetch('/api/contributors/me',{cache:'no-store'});if(!r.ok)return;who=await r.json();token='';if(data.meta.can_publish)loadEditor();}catch{}
  }
  if(fighters){
    $('#note-pick').innerHTML=`<option value="">No pick — analysis only</option><option value="${fighters.a.id}">${esc(fighters.a.name)}</option><option value="${fighters.b.id}">${esc(fighters.b.name)}</option>`;
  }
  $('#note-connect-form')?.addEventListener('submit',async e=>{e.preventDefault();
    const candidate=$('#note-publishing-key').value.trim(),remember=$('#note-remember-device').checked;$('#note-publishing-key').value='';
    try{
      const r=await fetch('/api/contributors/me',{headers:{authorization:`Bearer ${candidate}`},cache:'no-store'});let body=await r.json();if(!r.ok)throw new Error(body.error);
      token=candidate;who=body;
      if(remember){const keep=await fetch('/api/contributors/device',{method:'POST',headers:{authorization:`Bearer ${candidate}`},cache:'no-store'});body=await keep.json();if(!keep.ok)throw new Error(body.error);who=body;token='';}
      loadEditor();$('#note-editor-status').textContent=remember?`This phone is remembered as ${who.display_name}.`:`Connected as ${who.display_name} for this page.`;
    }catch(err){$('#note-editor-status').textContent=err.message||'Could not connect.';}
  });
  $('#prefight-note-form')?.addEventListener('submit',async e=>{e.preventDefault();
    const button=$('#prefight-note-form button[type="submit"]');button.disabled=true;
    try{
      const picked=$('#note-pick').value;
      const r=await fetch(`/api/fights/${id}/notes`,{method:'PUT',headers:authHeaders({'content-type':'application/json'}),body:JSON.stringify({revision,title:$('#note-title').value,body:$('#note-body').value,picked_fighter_id:picked===''?null:Number(picked)}),cache:'no-store'});
      const body=await r.json();if(!r.ok)throw new Error(body.error);
      revision=body.revision;data.notes=body.notes;renderNotes();$('#note-editor-status').textContent='Pre-fight note published.';
    }catch(err){$('#note-editor-status').textContent=err.message||'Could not publish your pre-fight note.';}finally{button.disabled=false;}
  });
  Promise.allSettled([load(),restore()]).then(results=>{if(results[0].status==='rejected')$('#prefight-notes').innerHTML='<p class="prefight-note-empty">Contributor notes are temporarily unavailable.</p>';});
})();
