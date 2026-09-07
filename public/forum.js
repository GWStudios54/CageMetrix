(()=>{
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(path,opt={}){const init={credentials:'same-origin',...opt};if(init.body&&typeof init.body!=='string'){init.headers={'content-type':'application/json',...(init.headers||{})};init.body=JSON.stringify(init.body)}const r=await fetch(path,init),j=await r.json().catch(()=>({error:'Request failed.'}));if(!r.ok){const e=new Error(j.error||'Request failed.');e.status=r.status;throw e}return j;}
  function auth(){const b=$('[data-cm-account-button]');if(b)b.click();else location.href='/community'}

  async function initIndex(){
    const form=$('[data-forum-new-thread]');if(!form)return;
    form.onsubmit=async e=>{e.preventDefault();const err=$('[data-forum-error]',form);err.textContent='';const button=$('button[type="submit"]',form);button.disabled=true;try{const data=Object.fromEntries(new FormData(form).entries()),j=await api('/api/forum/threads',{method:'POST',body:data});location.href=j.url}catch(ex){button.disabled=false;if(ex.status===401){auth();return}err.textContent=ex.message}};
  }

  async function initThread(){
    const root=$('[data-forum-thread]');if(!root)return;const id=root.dataset.forumThread,holder=$('[data-forum-posts]',root),form=$('[data-forum-compose]',root),replyInput=$('input[name="parent_id"]',form),label=$('[data-forum-compose-label]',form),cancel=$('[data-forum-cancel-reply]',form),err=$('[data-forum-compose-error]',form);
    function resetReply(){replyInput.value='';label.textContent='Add to the thread';cancel.hidden=true}
    async function load(){try{const j=await api(`/api/forum/threads/${id}`);render(j)}catch(ex){holder.innerHTML=`<div class="forum-empty">${esc(ex.message)}</div>`}}
    function render(j){
      holder.innerHTML='';if(!j.posts.length)holder.innerHTML='<div class="forum-empty">No posts yet.</div>';
      for(const p of j.posts){const el=document.createElement('article');el.className=`forum-post${p.parent_id?' is-reply':''}`;el.innerHTML=`<div class="forum-post-head"><a href="${esc(p.author.profile_url)}"><strong>${esc(p.author.display_name)}</strong> <small>@${esc(p.author.handle)}</small></a><time>${esc(new Date(p.created_at).toLocaleString())}</time></div><div class="forum-post-body"></div><div class="forum-post-actions"><button type="button" data-react>${p.my_reacted?'♥':'♡'} ${p.reactions}</button><button type="button" data-reply>Reply</button><button type="button" data-report>Report</button><button type="button" data-block>Block @${esc(p.author.handle)}</button></div>`;$('.forum-post-body',el).textContent=p.body;$('[data-react]',el).onclick=async()=>{try{await api(`/api/forum/posts/${p.id}/react`,{method:'PUT',body:{on:!p.my_reacted}});load()}catch(ex){if(ex.status===401)auth()}};$('[data-reply]',el).onclick=()=>{replyInput.value=String(p.id);label.textContent=`Reply to @${p.author.handle}`;cancel.hidden=false;$('textarea',form).focus()};$('[data-report]',el).onclick=async()=>{try{await api(`/api/forum/posts/${p.id}/report`,{method:'POST'});$('[data-report]',el).textContent='Reported'}catch(ex){if(ex.status===401)auth()}};$('[data-block]',el).onclick=async()=>{if(!confirm(`Block @${p.author.handle}?`))return;try{await api(`/api/community/users/${encodeURIComponent(p.author.handle)}/block`,{method:'PUT',body:{blocked:true}});load()}catch(ex){if(ex.status===401)auth()}};holder.appendChild(el)}
      if(j.thread.locked){form.hidden=true}else form.hidden=false;
    }
    cancel.onclick=resetReply;
    form.onsubmit=async e=>{e.preventDefault();err.textContent='';const data=Object.fromEntries(new FormData(form).entries());data.parent_id=data.parent_id?Number(data.parent_id):null;try{await api(`/api/forum/threads/${id}/posts`,{method:'POST',body:data});$('textarea',form).value='';resetReply();load()}catch(ex){if(ex.status===401){auth();return}err.textContent=ex.message}};
    window.addEventListener('cm-auth-changed',load);load();
  }
  initIndex();initThread();
})();
