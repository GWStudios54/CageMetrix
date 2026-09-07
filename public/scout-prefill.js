(()=>{
  const question=new URLSearchParams(location.search).get('question')?.trim();
  if(!question)return;
  const form=document.querySelector('#scout-ai-form'),input=document.querySelector('#scout-ai-question');
  if(!form||!input)return;
  input.value=question.slice(0,500);
  requestAnimationFrame(()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
})();
