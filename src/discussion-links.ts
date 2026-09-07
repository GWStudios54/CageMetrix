export function separateDiscussion(response:Response,scope:'event'|'fight',key:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const href=scope==='event'?`/forum/event/${encodeURIComponent(key)}`:`/forum/fight/${encodeURIComponent(key)}`;
  const link=`<div class="cm-forum-jump"><div><p class="eyebrow">DISCUSSION</p><strong>${scope==='event'?'Event thread':'Fight thread'}</strong><span>Take the argument to the CageMetrix Forum.</span></div><a class="button secondary" href="${href}">Discuss ${scope==='event'?'the card':'this fight'} →</a></div>`;
  const rewriter=new HTMLRewriter()
    .on('.topbar nav a[href="/community"]',{element(el){el.setAttribute('href','/forum');el.setInnerContent('Forum');}})
    .on('head',{element(el){el.append('<style>.cm-forum-jump{margin-top:24px;padding:16px 0;border-top:1px solid var(--line,#333);display:flex;align-items:center;justify-content:space-between;gap:16px}.cm-forum-jump div{display:grid;gap:4px}.cm-forum-jump strong{font-size:1.05rem}.cm-forum-jump span{color:var(--muted,#888);font-size:.82rem}@media(max-width:700px){.cm-forum-jump{align-items:stretch;flex-direction:column}.cm-forum-jump .button{width:100%;text-align:center}}</style>',{html:true});}});
  if(scope==='event')rewriter.on('.cm-thread',{element(el){el.replace(`${link}<div data-cm-thread data-scope="event" hidden><div data-cm-posts></div><div data-cm-compose></div></div>`,{html:true});}});
  else rewriter.on('.cm-fight-thread',{element(el){el.setInnerContent(`${link}<div data-cm-thread data-scope="fight" data-scope-id="${key}" hidden><div data-cm-posts></div><div data-cm-compose></div></div>`,{html:true});}});
  return rewriter.transform(response);
}
