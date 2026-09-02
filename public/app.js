const label = document.querySelector('#status-label');
const dot = document.querySelector('#status-dot');

async function checkHealth() {
  try {
    const response = await fetch('/api/health', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    label.textContent = data.ok ? `API online · model ${data.model_version}` : 'API reachable · database not ready';
    dot.classList.add(data.ok ? 'ok' : 'bad');
  } catch (error) {
    label.textContent = 'API setup pending';
    dot.classList.add('bad');
  }
}

checkHealth();
