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

// ---- Toast notifications ----
function showToast(message, type = 'info', duration = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ---- Confirm Modal ----
function showConfirm({ title, message, icon, confirmText, danger }) {
  return new Promise((resolve) => {
    document.getElementById('confirm-icon').textContent = icon || '';
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const okBtn = document.getElementById('confirm-ok-btn');
    okBtn.textContent = confirmText || 'Confirmar';
    okBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    okBtn.style.width = 'auto';
    okBtn.style.minWidth = '120px';
    document.getElementById('confirm-modal').classList.remove('hidden');

    function cleanup() {
      document.getElementById('confirm-modal').classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      document.getElementById('confirm-cancel-btn').removeEventListener('click', onCancel);
    }

    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }

    okBtn.addEventListener('click', onOk);
    document.getElementById('confirm-cancel-btn').addEventListener('click', onCancel);
  });
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

async function handleLogout() {
  const confirmed = await showConfirm({
    title: 'Cerrar sesión',
    message: '¿Estás seguro de que deseas cerrar sesión?',
    icon: '',
    confirmText: 'Cerrar sesión',
    danger: true,
  });
  if (confirmed) logout();
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
    showToast('Cuenta creada. Inicia sesión.', 'success');
    showView('login-view');
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('show-signup').addEventListener('click', (e) => { e.preventDefault(); showView('signup-view'); });
document.getElementById('show-login').addEventListener('click', (e) => { e.preventDefault(); showView('login-view'); });
document.getElementById('logout-btn').addEventListener('click', handleLogout);

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
    list.innerHTML = '<div class="empty-state"><p>No hay prospectos aún</p><p style="font-size:0.9rem">Agrega tu primer prospecto o importa desde Excel</p></div>';
    return;
  }
  list.innerHTML = prospects.map(p => `
    <div class="card">
      <div class="card-info">
        <h3>${esc(p.nombre)}</h3>
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
    showToast(id ? 'Prospecto actualizado' : 'Prospecto creado', 'success');
    loadProspects();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ---- Excel Import/Export ----
document.getElementById('download-template-btn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = `/api/prospects/template`;
  a.download = 'plantilla_prospectos.xlsx';
  if (token) {
    fetch(`${API}/api/prospects/template`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    .then(r => r.blob())
    .then(blob => {
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch(err => showToast('Error descargando plantilla: ' + err.message, 'error'));
  }
});

let uploadedFile = null;

document.getElementById('upload-prospects-btn').addEventListener('click', () => {
  uploadedFile = null;
  document.getElementById('upload-file-input').value = '';
  document.getElementById('upload-file-name').textContent = '';
  document.getElementById('upload-error').textContent = '';
  document.getElementById('upload-submit-btn').disabled = true;
  document.getElementById('upload-modal').classList.remove('hidden');
});

document.getElementById('close-upload-modal').addEventListener('click', () => {
  document.getElementById('upload-modal').classList.add('hidden');
});

document.getElementById('upload-drop-area').addEventListener('click', () => {
  document.getElementById('upload-file-input').click();
});

document.getElementById('upload-drop-area').addEventListener('dragover', (e) => {
  e.preventDefault();
  e.currentTarget.style.borderColor = 'var(--primary)';
});

document.getElementById('upload-drop-area').addEventListener('dragleave', (e) => {
  e.currentTarget.style.borderColor = 'var(--border)';
});

document.getElementById('upload-drop-area').addEventListener('drop', (e) => {
  e.preventDefault();
  e.currentTarget.style.borderColor = 'var(--border)';
  if (e.dataTransfer.files.length > 0) {
    handleFileSelect(e.dataTransfer.files[0]);
  }
});

document.getElementById('upload-file-input').addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFileSelect(e.target.files[0]);
  }
});

function handleFileSelect(file) {
  if (!file.name.match(/\.xlsx?$/i)) {
    document.getElementById('upload-error').textContent = 'Solo se aceptan archivos .xlsx';
    return;
  }
  uploadedFile = file;
  document.getElementById('upload-file-name').textContent = file.name;
  document.getElementById('upload-error').textContent = '';
  document.getElementById('upload-submit-btn').disabled = false;
}

document.getElementById('upload-submit-btn').addEventListener('click', async () => {
  if (!uploadedFile) return;

  const btn = document.getElementById('upload-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Importando...';

  try {
    const arrayBuffer = await uploadedFile.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const result = await api('/api/prospects/bulk', {
      method: 'POST',
      body: JSON.stringify({ fileBase64: base64 }),
    });

    document.getElementById('upload-modal').classList.add('hidden');
    showToast(`${result.created} prospectos importados`, 'success');
    loadProspects();
  } catch (err) {
    document.getElementById('upload-error').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importar prospectos';
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
        <button class="btn btn-small" onclick="editCampaign('${c.id}')">Editar</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('add-campaign-btn').addEventListener('click', () => {
  document.getElementById('campaign-id').value = '';
  document.getElementById('campaign-form').reset();
  document.getElementById('campaign-modal-title').textContent = 'Nueva campaña';
  document.getElementById('campaign-submit-btn').textContent = 'Crear campaña';
  document.getElementById('campaign-modal').classList.remove('hidden');
});

window.editCampaign = function(id) {
  const c = campaigns.find(x => x.id === id);
  if (!c) return;
  document.getElementById('campaign-id').value = c.id;
  document.getElementById('campaign-nombre').value = c.nombre;
  document.getElementById('campaign-objetivo').value = c.objetivo;
  document.getElementById('campaign-contexto').value = c.contexto_negocio;
  document.getElementById('campaign-prompt').value = c.system_prompt;
  document.getElementById('campaign-voz').value = c.voz_configurada || '';
  document.getElementById('campaign-modal-title').textContent = 'Editar campaña';
  document.getElementById('campaign-submit-btn').textContent = 'Guardar cambios';
  document.getElementById('campaign-modal').classList.remove('hidden');
};

document.getElementById('close-campaign-modal').addEventListener('click', () => {
  document.getElementById('campaign-modal').classList.add('hidden');
});

document.getElementById('campaign-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('campaign-id').value;
  const body = {
    nombre: document.getElementById('campaign-nombre').value,
    objetivo: document.getElementById('campaign-objetivo').value,
    contexto_negocio: document.getElementById('campaign-contexto').value,
    system_prompt: document.getElementById('campaign-prompt').value,
    voz_configurada: document.getElementById('campaign-voz').value || null,
  };

  try {
    if (id) {
      await api(`/api/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await api('/api/campaigns', { method: 'POST', body: JSON.stringify(body) });
    }
    document.getElementById('campaign-modal').classList.add('hidden');
    showToast(id ? 'Campaña actualizada' : 'Campaña creada', 'success');
    loadCampaigns();
  } catch (err) {
    showToast(err.message, 'error');
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

let currentCallDetailId = null;

window.viewCallDetail = async function(callId) {
  try {
    currentCallDetailId = callId;
    const detail = await api(`/api/calls/${callId}`);
    renderCallDetail(detail);
    document.getElementById('call-detail-modal').classList.remove('hidden');
  } catch (err) {
    showToast('Error cargando detalle: ' + err.message, 'error');
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
    const interestColor = report.nivel_interes >= 4 ? 'var(--success)' : report.nivel_interes >= 3 ? 'var(--warning)' : 'var(--danger)';

    html += `
      <div class="report-section">
        <h3>Reporte de la llamada</h3>
        <p>${esc(report.resumen)}</p>

        <h4 style="margin-top:1rem;font-size:0.9rem;color:var(--text-secondary)">Nivel de interés: ${report.nivel_interes}/5</h4>
        <div class="interest-bar">
          <div class="interest-fill" style="width:${interestPct}%;background:${interestColor}"></div>
        </div>

        ${report.puntos_clave?.length ? `
          <h4 style="margin-top:1rem;font-size:0.9rem;color:var(--text-secondary)">Puntos clave</h4>
          <ul>${report.puntos_clave.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        ` : ''}

        ${report.objeciones_detectadas?.length ? `
          <h4 style="margin-top:1rem;font-size:0.9rem;color:var(--text-secondary)">Objeciones detectadas</h4>
          <ul>${report.objeciones_detectadas.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
        ` : ''}

        ${report.recomendacion_siguiente_paso ? `
          <h4 style="margin-top:1rem;font-size:0.9rem;color:var(--text-secondary)">Siguiente paso recomendado</h4>
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

  html += `
    <div class="call-detail-actions">
      <button class="btn btn-danger-outline" onclick="deleteCall('${call.id}')">Eliminar registro</button>
    </div>
  `;

  document.getElementById('call-detail-content').innerHTML = html;
}

window.deleteCall = async function(callId) {
  const confirmed = await showConfirm({
    title: 'Eliminar registro',
    message: '¿Estás seguro de que deseas eliminar este registro de llamada? Esta acción no se puede deshacer.',
    icon: '',
    confirmText: 'Eliminar',
    danger: true,
  });

  if (!confirmed) return;

  try {
    await api(`/api/calls/${callId}`, { method: 'DELETE' });
    document.getElementById('call-detail-modal').classList.add('hidden');
    showToast('Registro de llamada eliminado', 'success');
    loadCalls();
  } catch (err) {
    showToast('Error eliminando: ' + err.message, 'error');
  }
};

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
    await api('/api/calls/initiate', {
      method: 'POST',
      body: JSON.stringify({ prospectId: callProspectId, campaignId: campaignId || undefined }),
    });
    document.getElementById('call-modal').classList.add('hidden');
    showToast('Llamada iniciada correctamente', 'success', 4000);
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
