// One request at a time; pause while hidden and refresh when the tab returns.
window.startAutoRefresh = (load, onError, interval = 30_000) => {
  let timer, running = false, stopped = false;
  async function refresh() {
    clearTimeout(timer);
    if (stopped || running || document.hidden) return;
    running = true;
    try { await load(); } catch (error) { onError(error); }
    finally {
      running = false;
      if (!stopped && !document.hidden) timer = setTimeout(refresh, interval);
    }
  }
  const visibility = () => { clearTimeout(timer); if (!document.hidden) refresh(); };
  document.addEventListener('visibilitychange', visibility);
  refresh();
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
};
