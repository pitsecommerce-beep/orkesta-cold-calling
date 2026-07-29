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
  toast.className = `toast toast-${type} show`;
  toast.textContent = message;
  document.body.appendChild(toast);
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
    loadCalendarStatus();
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
    loadCalendarStatus();
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
  document.getElementById('campaign-llm-model').value = c.llm_model || '';
  document.getElementById('campaign-nombre-agente').value = c.nombre_agente || '';
  document.getElementById('campaign-tono').value = c.tono_agente || '';
  document.getElementById('campaign-modal-title').textContent = 'Editar campaña';
  document.getElementById('campaign-submit-btn').textContent = 'Guardar cambios';
  document.getElementById('campaign-modal').classList.remove('hidden');
};

document.getElementById('close-campaign-modal').addEventListener('click', () => {
  document.getElementById('campaign-modal').classList.add('hidden');
});

document.getElementById('upload-md-btn').addEventListener('click', () => {
  document.getElementById('md-file-input').click();
});

document.getElementById('md-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const content = ev.target.result;
    const prompt = document.getElementById('campaign-prompt');
    if (prompt.value.trim()) {
      prompt.value += '\n\n--- Documento: ' + file.name + ' ---\n\n' + content;
    } else {
      prompt.value = content;
    }
    document.getElementById('md-file-name').textContent = file.name;
    showToast('Documento cargado al prompt', 'success');
  };
  reader.readAsText(file);
  e.target.value = '';
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
    llm_model: document.getElementById('campaign-llm-model').value || null,
    nombre_agente: document.getElementById('campaign-nombre-agente').value || null,
    tono_agente: document.getElementById('campaign-tono').value || null,
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

// ---- Calendar ----

async function loadCalendarStatus() {
  try {
    const status = await api('/api/calendar/status');
    if (status.connected) {
      document.getElementById('cal-status-disconnected').classList.add('hidden');
      document.getElementById('cal-status-connected').classList.remove('hidden');
      document.getElementById('cal-email').textContent = status.google_email || 'Conectado';
      document.getElementById('cal-active-badge').textContent = status.activo ? 'activo' : 'inactivo';
      document.getElementById('cal-active-badge').className = 'status-badge ' + (status.activo ? 'status-interesado' : 'status-no_interesado');

      document.getElementById('cal-timezone').value = status.timezone || 'America/Mexico_City';
      document.getElementById('cal-duracion').value = String(status.duracion_default_min || 20);
      document.getElementById('cal-inicio').value = status.horario_inicio || '09:00';
      document.getElementById('cal-fin').value = status.horario_fin || '18:00';
      document.getElementById('cal-buffer').value = String(status.buffer_min ?? 15);

      const dias = status.dias_habiles || [1,2,3,4,5];
      document.querySelectorAll('#cal-dias input[type="checkbox"]').forEach(cb => {
        cb.checked = dias.includes(parseInt(cb.value));
      });

      loadAppointments();
    } else {
      document.getElementById('cal-status-disconnected').classList.remove('hidden');
      document.getElementById('cal-status-connected').classList.add('hidden');
    }
  } catch (err) {
    console.error('Error loading calendar status:', err);
  }
}

document.getElementById('connect-calendar-btn').addEventListener('click', async () => {
  try {
    const data = await api('/api/calendar/auth');
    window.location.href = data.url;
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('disconnect-calendar-btn').addEventListener('click', async () => {
  const confirmed = await showConfirm({
    title: 'Desconectar calendario',
    message: 'Se revocará el acceso a Google Calendar. Las citas ya creadas no se eliminan.',
    icon: '',
    confirmText: 'Desconectar',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await api('/api/calendar/connection', { method: 'DELETE' });
    showToast('Calendario desconectado', 'success');
    loadCalendarStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('calendar-settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dias = [];
  document.querySelectorAll('#cal-dias input[type="checkbox"]:checked').forEach(cb => {
    dias.push(parseInt(cb.value));
  });

  try {
    await api('/api/calendar/settings', {
      method: 'PUT',
      body: JSON.stringify({
        timezone: document.getElementById('cal-timezone').value,
        horario_inicio: document.getElementById('cal-inicio').value,
        horario_fin: document.getElementById('cal-fin').value,
        dias_habiles: dias,
        duracion_default_min: parseInt(document.getElementById('cal-duracion').value),
        buffer_min: parseInt(document.getElementById('cal-buffer').value),
      }),
    });
    showToast('Configuración guardada', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

async function loadAppointments() {
  try {
    const appointments = await api('/api/calendar/appointments');
    renderAppointments(appointments);
  } catch (err) {
    console.error('Error loading appointments:', err);
  }
}

function renderAppointments(appointments) {
  const list = document.getElementById('appointments-list');
  if (appointments.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No hay citas próximas</p><p style="font-size:0.9rem">Las citas agendadas por el agente aparecerán aquí</p></div>';
    return;
  }
  list.innerHTML = appointments.map(a => {
    const date = new Date(a.inicio).toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const prospect = a.prospects;
    const estadoClass = a.estado === 'confirmada' ? 'status-interesado' : a.estado === 'tentativa' ? 'status-contactado' : 'status-no_interesado';
    return `
      <div class="card">
        <div class="card-info">
          <h3>${prospect ? esc(prospect.nombre) : 'Sin nombre'} ${prospect?.empresa ? '· ' + esc(prospect.empresa) : ''}</h3>
          <p>${date}</p>
        </div>
        <div class="card-actions">
          <span class="status-badge ${estadoClass}">${a.estado}</span>
          ${a.meet_url ? `<a href="${esc(a.meet_url)}" target="_blank" class="btn btn-small" style="text-decoration:none">Meet</a>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Handle OAuth redirect
if (window.location.search.includes('calendar=connected')) {
  setTimeout(() => showToast('Google Calendar conectado correctamente', 'success'), 500);
  window.history.replaceState({}, '', '/');
} else if (window.location.search.includes('calendar=error')) {
  setTimeout(() => showToast('Error conectando Google Calendar', 'error'), 500);
  window.history.replaceState({}, '', '/');
}

// ---- Test Call ----
let testCallWs = null;
let testCallAudioCtx = null;
let testCallMediaStream = null;
let testCallProcessor = null;
let testCallSourceNode = null;
let testCallAudioQueue = [];
let testCallActiveSources = [];
let testCallPlaybackTime = 0;
let testCallIsPlayingBack = false;
let testCallPendingMarks = new Set();
let testCallEchoTimeout = null;
let testCallTimerInterval = null;
let testCallStartTime = null;
let testCallActive = false;

function linearToMulaw(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = 0;
  if (sample < 0) { sign = 0x80; sample = -sample; }
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  let mask = 0x4000;
  while ((sample & mask) === 0 && exponent > 0) { exponent--; mask >>= 1; }
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

function mulawToLinear(mulaw) {
  const BIAS = 0x84;
  mulaw = ~mulaw & 0xFF;
  const sign = mulaw & 0x80;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0F;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

async function startTestCall() {
  const campaignId = document.getElementById('test-campaign-select').value;
  const prospectName = document.getElementById('test-prospect-name').value || 'Prospecto de prueba';
  const btn = document.getElementById('test-call-start-btn');
  btn.disabled = true;
  btn.textContent = 'Conectando...';

  try {
    testCallAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (testCallAudioCtx.state === 'suspended') await testCallAudioCtx.resume();

    testCallMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({ token, campaignId, prospectName });
    testCallWs = new WebSocket(`${wsProtocol}//${location.host}/test-call?${params}`);

    testCallWs.onopen = () => {
      testCallActive = true;
      document.getElementById('test-call-setup').classList.add('hidden');
      document.getElementById('test-call-active').classList.remove('hidden');
      document.getElementById('test-call-transcript').innerHTML =
        '<p class="test-transcript-empty">Conectando con el agente...</p>';

      testCallStartTime = Date.now();
      testCallTimerInterval = setInterval(updateTestCallTimer, 1000);
      startTestCallAudioCapture();
    };

    testCallWs.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        handleTestCallMessage(msg);
      } catch (err) {
        console.error('[TestCall] Parse error:', err);
      }
    };

    testCallWs.onclose = () => {
      if (testCallActive) stopTestCall(true);
    };

    testCallWs.onerror = () => {
      showToast('Error de conexión en la prueba', 'error');
      stopTestCall(true);
    };
  } catch (err) {
    showToast('Error: ' + (err.message || 'No se pudo iniciar la prueba'), 'error');
    cleanupTestCallAudio();
    btn.disabled = false;
    btn.textContent = 'Iniciar prueba';
  }
}

function startTestCallAudioCapture() {
  if (!testCallAudioCtx || !testCallMediaStream) return;

  testCallSourceNode = testCallAudioCtx.createMediaStreamSource(testCallMediaStream);
  testCallProcessor = testCallAudioCtx.createScriptProcessor(4096, 1, 1);

  testCallSourceNode.connect(testCallProcessor);
  testCallProcessor.connect(testCallAudioCtx.destination);

  const sampleRate = testCallAudioCtx.sampleRate;
  const ratio = sampleRate / 8000;

  testCallProcessor.onaudioprocess = (e) => {
    if (!testCallActive || !testCallWs || testCallWs.readyState !== WebSocket.OPEN) return;
    if (testCallIsPlayingBack) {
      e.outputBuffer.getChannelData(0).fill(0);
      return;
    }

    const input = e.inputBuffer.getChannelData(0);
    e.outputBuffer.getChannelData(0).fill(0);

    const outLen = Math.floor(input.length / ratio);
    const mulaw = new Uint8Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const sample = input[Math.round(i * ratio)];
      const int16 = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)));
      mulaw[i] = linearToMulaw(int16);
    }

    for (let i = 0; i < mulaw.length; i += 160) {
      const end = Math.min(i + 160, mulaw.length);
      const frame = mulaw.subarray(i, end);
      let binary = '';
      for (let j = 0; j < frame.length; j++) binary += String.fromCharCode(frame[j]);
      testCallWs.send(JSON.stringify({
        event: 'media',
        media: { payload: btoa(binary) },
      }));
    }
  };
}

function handleTestCallMessage(msg) {
  switch (msg.event) {
    case 'media': {
      const binary = atob(msg.media.payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      testCallAudioQueue.push(bytes);
      break;
    }
    case 'mark':
      scheduleTestCallPlayback(msg.mark.name);
      break;
    case 'clear':
      clearTestCallPlayback();
      break;
    case 'stop':
      stopTestCall(true);
      break;
    case 'transcript':
      addTestCallTranscript(msg.speaker, msg.text);
      break;
  }
}

function scheduleTestCallPlayback(markName) {
  if (!testCallAudioCtx) return;

  if (testCallAudioQueue.length === 0) {
    if (testCallWs && testCallWs.readyState === WebSocket.OPEN) {
      testCallWs.send(JSON.stringify({ event: 'mark', mark: { name: markName } }));
    }
    return;
  }

  testCallIsPlayingBack = true;
  testCallPendingMarks.add(markName);
  if (testCallEchoTimeout) { clearTimeout(testCallEchoTimeout); testCallEchoTimeout = null; }

  let totalLen = 0;
  for (const chunk of testCallAudioQueue) totalLen += chunk.length;
  const allMulaw = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of testCallAudioQueue) {
    allMulaw.set(chunk, offset);
    offset += chunk.length;
  }
  testCallAudioQueue = [];

  const samples = new Float32Array(allMulaw.length);
  for (let i = 0; i < allMulaw.length; i++) {
    samples[i] = mulawToLinear(allMulaw[i]) / 32768;
  }

  const buffer = testCallAudioCtx.createBuffer(1, samples.length, 8000);
  buffer.getChannelData(0).set(samples);

  const source = testCallAudioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(testCallAudioCtx.destination);

  const now = testCallAudioCtx.currentTime;
  const startAt = Math.max(now, testCallPlaybackTime);
  source.start(startAt);
  testCallPlaybackTime = startAt + buffer.duration;

  source.onended = () => {
    const idx = testCallActiveSources.indexOf(source);
    if (idx >= 0) testCallActiveSources.splice(idx, 1);
    if (testCallWs && testCallWs.readyState === WebSocket.OPEN) {
      testCallWs.send(JSON.stringify({ event: 'mark', mark: { name: markName } }));
    }
    testCallPendingMarks.delete(markName);
    if (testCallPendingMarks.size === 0) {
      if (testCallEchoTimeout) clearTimeout(testCallEchoTimeout);
      testCallEchoTimeout = setTimeout(() => {
        testCallIsPlayingBack = false;
        testCallEchoTimeout = null;
      }, 300);
    }
  };

  testCallActiveSources.push(source);
}

function clearTestCallPlayback() {
  for (const src of testCallActiveSources) {
    src.onended = null;
    try { src.stop(); } catch {}
  }
  testCallActiveSources = [];
  testCallAudioQueue = [];
  testCallPlaybackTime = 0;
  testCallPendingMarks.clear();
  testCallIsPlayingBack = false;
  if (testCallEchoTimeout) { clearTimeout(testCallEchoTimeout); testCallEchoTimeout = null; }
}

function addTestCallTranscript(speaker, text) {
  const container = document.getElementById('test-call-transcript');
  const empty = container.querySelector('.test-transcript-empty');
  if (empty) empty.remove();

  const turn = document.createElement('div');
  turn.className = 'test-transcript-turn';
  turn.innerHTML =
    '<span class="speaker ' + esc(speaker) + '">' +
    (speaker === 'agente' ? 'Agente' : 'Tú') +
    '</span>' +
    '<p class="text">' + esc(text) + '</p>';
  container.appendChild(turn);
  container.scrollTop = container.scrollHeight;
}

function updateTestCallTimer() {
  if (!testCallStartTime) return;
  const elapsed = Math.floor((Date.now() - testCallStartTime) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  document.getElementById('test-call-timer').textContent =
    m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
}

function stopTestCall(fromServer) {
  testCallActive = false;

  if (!fromServer && testCallWs && testCallWs.readyState === WebSocket.OPEN) {
    testCallWs.send(JSON.stringify({ event: 'stop' }));
  }

  if (testCallWs) {
    testCallWs.onclose = null;
    if (testCallWs.readyState === WebSocket.OPEN || testCallWs.readyState === WebSocket.CONNECTING) {
      testCallWs.close();
    }
    testCallWs = null;
  }

  cleanupTestCallAudio();

  if (testCallTimerInterval) {
    clearInterval(testCallTimerInterval);
    testCallTimerInterval = null;
  }

  document.getElementById('test-call-setup').classList.remove('hidden');
  document.getElementById('test-call-active').classList.add('hidden');

  const btn = document.getElementById('test-call-start-btn');
  btn.disabled = false;
  btn.textContent = 'Iniciar prueba';

  if (fromServer) {
    showToast('Prueba de agente finalizada', 'info');
  }
}

function cleanupTestCallAudio() {
  clearTestCallPlayback();

  if (testCallProcessor) {
    testCallProcessor.disconnect();
    testCallProcessor = null;
  }
  if (testCallSourceNode) {
    testCallSourceNode.disconnect();
    testCallSourceNode = null;
  }
  if (testCallMediaStream) {
    testCallMediaStream.getTracks().forEach(function(t) { t.stop(); });
    testCallMediaStream = null;
  }
  if (testCallAudioCtx) {
    testCallAudioCtx.close().catch(function() {});
    testCallAudioCtx = null;
  }
}

document.getElementById('test-call-btn').addEventListener('click', function() {
  var select = document.getElementById('test-campaign-select');
  select.innerHTML = '<option value="">Sin campaña (predeterminada)</option>' +
    campaigns.filter(function(c) { return c.activa; })
      .map(function(c) { return '<option value="' + c.id + '">' + esc(c.nombre) + '</option>'; })
      .join('');

  document.getElementById('test-call-setup').classList.remove('hidden');
  document.getElementById('test-call-active').classList.add('hidden');
  document.getElementById('test-call-modal').classList.remove('hidden');
});

document.getElementById('close-test-call-modal').addEventListener('click', function() {
  if (testCallActive) stopTestCall();
  document.getElementById('test-call-modal').classList.add('hidden');
});

document.getElementById('test-call-start-btn').addEventListener('click', startTestCall);
document.getElementById('test-call-stop-btn').addEventListener('click', function() { stopTestCall(); });

// ---- Init ----
checkAuth();
