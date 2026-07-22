const API = '';
let token = localStorage.getItem('orkesta_token');
let currentUser = null;

// ---- API helpers ----
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (res.status === 401) {
    logout();
    throw new Error('Sesión expirada');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

// ---- Auth ----
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('orkesta_token');
  showView('login-view');
}

async function checkAuth() {
  if (!token) { showView('login-view'); return; }
  try {
    currentUser = await api('/api/auth/me');
    document.getElementById('user-name').textContent = currentUser.nombre;
    showView('dashboard-view');
    loadProspects();
    loadCampaigns();
    loadCalls();
  } catch {
    logout();
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value,
      }),
    });
    token = data.token;
    localStorage.setItem('orkesta_token', token);
    currentUser = data.user;
    document.getElementById('user-name').textContent = data.user.nombre;
    showView('dashboard-view');
    loadProspects();
    loadCampaigns();
    loadCalls();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('signup-error');
  errEl.textContent = '';
  try {
    await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        nombre: document.getElementById('signup-nombre').value,
        email: document.getElementById('signup-email').value,
        password: document.getElementById('signup-password').value,
      }),
    });
    alert('Cuenta creada. Inicia sesión.');
    showView('login-view');
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('show-signup').addEventListener('click', (e) => { e.preventDefault(); showView('signup-view'); });
document.getElementById('show-login').addEventListener('click', (e) => { e.preventDefault(); showView('login-view'); });
document.getElementById('logout-btn').addEventListener('click', logout);

// ---- Tabs ----
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ---- Prospects ----
let prospects = [];

async function loadProspects() {
  try {
    prospects = await api('/api/prospects');
    renderProspects();
  } catch (err) {
    console.error('Error loading prospects:', err);
  }
}

function renderProspects() {
  const list = document.getElementById('prospects-list');
  if (prospects.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No hay prospectos aún</p><p style="font-size:0.9rem">Agrega tu primer prospecto para comenzar</p></div>';
    return;
  }
  list.innerHTML = prospects.map(p => `
    <div class="card">
      <div class="card-info">
        <h3>${esc(p.nombre)} ${p.do_not_call ? '🚫' : ''}</h3>
        <p>${esc(p.telefono)} ${p.empresa ? '· ' + esc(p.empresa) : ''}</p>
      </div>
      <div class="card-actions">
        <span class="status-badge status-${p.status}">${p.status.replace('_', ' ')}</span>
        ${!p.do_not_call ? `<button class="btn btn-call" onclick="openCallModal('${p.id}')">Llamar</button>` : ''}
        <button class="btn btn-small" onclick="editProspect('${p.id}')">Editar</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('add-prospect-btn').addEventListener('click', () => {
  document.getElementById('prospect-id').value = '';
  document.getElementById('prospect-form').reset();
  document.getElementById('prospect-modal-title').textContent = 'Nuevo prospecto';
  document.getElementById('prospect-modal').classList.remove('hidden');
});

document.getElementById('close-prospect-modal').addEventListener('click', () => {
  document.getElementById('prospect-modal').classList.add('hidden');
});

window.editProspect = function(id) {
  const p = prospects.find(x => x.id === id);
  if (!p) return;
  document.getElementById('prospect-id').value = p.id;
  document.getElementById('prospect-nombre').value = p.nombre;
  document.getElementById('prospect-telefono').value = p.telefono;
  document.getElementById('prospect-empresa').value = p.empresa || '';
  document.getElementById('prospect-email').value = p.email || '';
  document.getElementById('prospect-notas').value = p.notas || '';
  document.getElementById('prospect-modal-title').textContent = 'Editar prospecto';
  document.getElementById('prospect-modal').classList.remove('hidden');
};

document.getElementById('prospect-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('prospect-id').value;
  const body = {
    nombre: document.getElementById('prospect-nombre').value,
    telefono: document.getElementById('prospect-telefono').value,
    empresa: document.getElementById('prospect-empresa').value || null,
    email: document.getElementById('prospect-email').value || null,
    notas: document.getElementById('prospect-notas').value || null,
  };

  try {
    if (id) {
      await api(`/api/prospects/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await api('/api/prospects', { method: 'POST', body: JSON.stringify(body) });
    }
    document.getElementById('prospect-modal').classList.add('hidden');
    loadProspects();
  } catch (err) {
    alert(err.message);
  }
});

// ---- Campaigns ----
let campaigns = [];

async function loadCampaigns() {
  try {
    campaigns = await api('/api/campaigns');
    renderCampaigns();
  } catch (err) {
    console.error('Error loading campaigns:', err);
  }
}

function renderCampaigns() {
  const list = document.getElementById('campaigns-list');
  if (campaigns.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No hay campañas aún</p><p style="font-size:0.9rem">Crea una campaña con tu guion de ventas</p></div>';
    return;
  }
  list.innerHTML = campaigns.map(c => `
    <div class="card">
      <div class="card-info">
        <h3>${esc(c.nombre)}</h3>
        <p>${esc(c.objetivo.substring(0, 100))}${c.objetivo.length > 100 ? '...' : ''}</p>
      </div>
      <div class="card-actions">
        <span class="status-badge ${c.activa ? 'status-interesado' : 'status-descartado'}">${c.activa ? 'activa' : 'pausada'}</span>
      </div>
    </div>
  `).join('');
}

document.getElementById('add-campaign-btn').addEventListener('click', () => {
  document.getElementById('campaign-form').reset();
  document.getElementById('campaign-modal').classList.remove('hidden');
});

document.getElementById('close-campaign-modal').addEventListener('click', () => {
  document.getElementById('campaign-modal').classList.add('hidden');
});

document.getElementById('campaign-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        nombre: document.getElementById('campaign-nombre').value,
        objetivo: document.getElementById('campaign-objetivo').value,
        contexto_negocio: document.getElementById('campaign-contexto').value,
        system_prompt: document.getElementById('campaign-prompt').value,
      }),
    });
    document.getElementById('campaign-modal').classList.add('hidden');
    loadCampaigns();
  } catch (err) {
    alert(err.message);
  }
});

// ---- Calls ----
async function loadCalls() {
  try {
    const calls = await api('/api/calls');
    renderCalls(calls);
  } catch (err) {
    console.error('Error loading calls:', err);
  }
}

function renderCalls(calls) {
  const list = document.getElementById('calls-list');
  if (calls.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No hay llamadas aún</p><p style="font-size:0.9rem">Inicia tu primera llamada desde la pestaña de prospectos</p></div>';
    return;
  }
  list.innerHTML = calls.map(c => {
    const date = new Date(c.inicio).toLocaleString('es-MX');
    const prospect = c.prospects;
    const duration = c.duracion_segundos ? formatDuration(c.duracion_segundos) : '-';
    return `
      <div class="card" style="cursor:pointer" onclick="viewCallDetail('${c.id}')">
        <div class="card-info">
          <h3>${prospect ? esc(prospect.nombre) : 'Desconocido'} ${prospect?.empresa ? '· ' + esc(prospect.empresa) : ''}</h3>
          <p>${date} · Duración: ${duration}</p>
        </div>
        <div class="card-actions">
          ${c.outcome ? `<span class="status-badge status-${c.outcome === 'contestado' ? 'contactado' : 'no_contesta'}">${c.outcome}</span>` : ''}
          ${c.disposition ? `<span class="status-badge status-${c.disposition === 'interesado' || c.disposition === 'agendo' ? 'interesado' : 'no_interesado'}">${c.disposition}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.viewCallDetail = async function(callId) {
  try {
    const detail = await api(`/api/calls/${callId}`);
    renderCallDetail(detail);
    document.getElementById('call-detail-modal').classList.remove('hidden');
  } catch (err) {
    alert('Error cargando detalle: ' + err.message);
  }
};

function renderCallDetail(detail) {
  const { call, transcripts, report } = detail;
  const date = new Date(call.inicio).toLocaleString('es-MX');
  const duration = call.duracion_segundos ? formatDuration(call.duracion_segundos) : '-';

  let html = `
    <div class="call-meta">
      <div class="meta-item"><label>Fecha</label><span>${date}</span></div>
      <div class="meta-item"><label>Duración</label><span>${duration}</span></div>
      <div class="meta-item"><label>Resultado</label><span>${call.outcome || '-'}</span></div>
      <div class="meta-item"><label>Disposición</label><span>${call.disposition || '-'}</span></div>
    </div>
  `;

  if (report) {
    const interestPct = (report.nivel_interes / 5) * 100;
    const interestColor = report.nivel_interes >= 4 ? '#00B894' : report.nivel_interes >= 3 ? '#FDCB6E' : '#E17055';

    html += `
      <div class="report-section">
        <h3>Reporte de la llamada</h3>
        <p>${esc(report.resumen)}</p>

        <h4 style="margin-top:1rem;font-size:0.9rem">Nivel de interés: ${report.nivel_interes}/5</h4>
        <div class="interest-bar">
          <div class="interest-fill" style="width:${interestPct}%;background:${interestColor}"></div>
        </div>

        ${report.puntos_clave?.length ? `
          <h4 style="margin-top:1rem;font-size:0.9rem">Puntos clave</h4>
          <ul>${report.puntos_clave.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        ` : ''}

        ${report.objeciones_detectadas?.length ? `
          <h4 style="margin-top:1rem;font-size:0.9rem">Objeciones detectadas</h4>
          <ul>${report.objeciones_detectadas.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
        ` : ''}

        ${report.recomendacion_siguiente_paso ? `
          <h4 style="margin-top:1rem;font-size:0.9rem">Siguiente paso recomendado</h4>
          <p>${esc(report.recomendacion_siguiente_paso)}</p>
        ` : ''}
      </div>
    `;
  }

  if (transcripts.length > 0) {
    html += `
      <div class="transcript">
        <h3>Transcript</h3>
        ${transcripts.map(t => `
          <div class="transcript-turn">
            <span class="speaker ${t.speaker}">${t.speaker === 'agente' ? 'Agente' : 'Prospecto'}</span>
            <p class="text">${esc(t.texto)}</p>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    html += '<div class="transcript"><h3>Transcript</h3><p style="color:var(--text-secondary)">No hay transcript disponible</p></div>';
  }

  document.getElementById('call-detail-content').innerHTML = html;
}

document.getElementById('close-call-detail').addEventListener('click', () => {
  document.getElementById('call-detail-modal').classList.add('hidden');
});

// ---- Call initiation ----
let callProspectId = null;

window.openCallModal = function(prospectId) {
  callProspectId = prospectId;
  const p = prospects.find(x => x.id === prospectId);
  document.getElementById('call-prospect-info').textContent = `Llamar a ${p.nombre} (${p.telefono})`;
  document.getElementById('call-error').textContent = '';

  const select = document.getElementById('call-campaign-select');
  select.innerHTML = '<option value="">Sin campaña</option>' +
    campaigns.filter(c => c.activa).map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');

  document.getElementById('call-modal').classList.remove('hidden');
};

document.getElementById('close-call-modal').addEventListener('click', () => {
  document.getElementById('call-modal').classList.add('hidden');
});

document.getElementById('start-call-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('call-error');
  errEl.textContent = '';

  try {
    const campaignId = document.getElementById('call-campaign-select').value;
    const data = await api('/api/calls/initiate', {
      method: 'POST',
      body: JSON.stringify({ prospectId: callProspectId, campaignId: campaignId || undefined }),
    });
    document.getElementById('call-modal').classList.add('hidden');
    alert(`Llamada iniciada (SID: ${data.callSid})`);
    setTimeout(loadCalls, 3000);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---- Helpers ----
function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ---- Init ----
checkAuth();
