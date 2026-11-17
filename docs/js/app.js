import { API_URL } from './config.js?v=5';

// ───────── Sesión ─────────
export function crearSesion(rol) {
  const clave = `asistencia_token_${rol}`;
  return {
    rol,
    get token() {
      try { return sessionStorage.getItem(clave); } catch { return null; }
    },
    set token(v) {
      try { v ? sessionStorage.setItem(clave, v) : sessionStorage.removeItem(clave); } catch { /* sin storage */ }
    },
  };
}

// ───────── API ─────────
export async function api(ruta, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(API_URL + ruta, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor. Si llevaba rato sin usarse, espera 30–60 s y reintenta.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Error ${res.status}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

// ───────── Login / arranque de página ─────────
export function iniciarPagina({ rol, alEntrar }) {
  const sesion = crearSesion(rol);
  const login = document.getElementById('login');
  const appEl = document.getElementById('app');
  const btnSalir = document.getElementById('btnSalir');

  const mostrarApp = () => {
    login.classList.add('oculto');
    appEl.classList.remove('oculto');
    btnSalir.classList.remove('oculto');
    alEntrar(sesion);
  };
  const salir = () => {
    sesion.token = null;
    location.reload();
  };

  btnSalir.addEventListener('click', salir);
  document.getElementById('formLogin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter;
    btn.disabled = true;
    try {
      const { token } = await api('/api/login', { method: 'POST', body: { rol, password: ev.target.clave.value } });
      sesion.token = token;
      mostrarApp();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Llamada autenticada: si el token venció, vuelve al login
  sesion.llamar = async (ruta, opciones = {}) => {
    try {
      return await api(ruta, { ...opciones, token: sesion.token });
    } catch (e) {
      if (e.status === 401) {
        toast('Tu sesión venció. Ingresa de nuevo.', 'error');
        setTimeout(salir, 1200);
      }
      throw e;
    }
  };

  if (sesion.token) mostrarApp();
  return sesion;
}

// ───────── Avisos ─────────
let temporizador;
export function toast(mensaje, tipo = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = mensaje;
  el.className = `toast visible ${tipo}`;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => (el.className = 'toast'), tipo === 'error' ? 6000 : 3000);
}

export const escapar = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const formatearFecha = (f) =>
  f ? new Date(f).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }) : '';

// ───────── Teléfono (+57 por defecto) ─────────
export const PREFIJOS = [
  ['+57', '🇨🇴 +57'],
  ['+58', '🇻🇪 +58'],
  ['+593', '🇪🇨 +593'],
  ['+51', '🇵🇪 +51'],
  ['+507', '🇵🇦 +507'],
  ['+52', '🇲🇽 +52'],
  ['+1', '🇺🇸 +1'],
  ['+34', '🇪🇸 +34'],
  ['', 'Otro (+…)'],
];

export function prepararTelefono(form) {
  const sel = form.querySelector('[name=prefijo]');
  if (!sel.options.length) {
    sel.innerHTML = PREFIJOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  }
  sel.value = '+57';
}

export function ponerTelefono(form, tel) {
  const sel = form.querySelector('[name=prefijo]');
  const num = form.querySelector('[name=numero]');
  if (!tel) { sel.value = '+57'; num.value = ''; return; }
  const p = PREFIJOS.map((x) => x[0]).filter(Boolean).sort((a, b) => b.length - a.length).find((x) => tel.startsWith(x));
  if (p) { sel.value = p; num.value = tel.slice(p.length); }
  else { sel.value = ''; num.value = tel; }
}

export function leerTelefono(form) {
  const prefijo = form.querySelector('[name=prefijo]').value;
  let num = form.querySelector('[name=numero]').value.replace(/[^\d+]/g, '');
  if (!num) return { telefono: '' };
  if (!prefijo) {
    return num.startsWith('+') ? { telefono: num } : { error: 'Con "Otro" escribe el número completo con +indicativo.' };
  }
  num = num.replace(/^\+/, '');
  if (prefijo === '+57' && num.startsWith('57') && num.length === 12) num = num.slice(2);
  if (prefijo === '+57' && !/^\d{10}$/.test(num)) return { error: 'El celular de Colombia debe tener 10 dígitos (ej. 3001234567).' };
  return { telefono: prefijo + num };
}

// ───────── Formulario de datos de la persona ─────────
export const CAMPOS_PERSONA = ['cedula', 'tipoCedula', 'apellidos', 'nombres', 'fechaNacimiento', 'sexo', 'correo'];

export function llenarFormulario(form, datos = {}) {
  for (const c of CAMPOS_PERSONA) {
    if (form.elements[c] && datos[c] !== undefined) form.elements[c].value = datos[c] ?? '';
  }
  if ('telefono' in datos) ponerTelefono(form, datos.telefono);
}

export function leerFormulario(form) {
  const datos = {};
  for (const c of CAMPOS_PERSONA) if (form.elements[c]) datos[c] = form.elements[c].value.trim();
  const tel = leerTelefono(form);
  if (tel.error) throw new Error(tel.error);
  datos.telefono = tel.telefono;
  return datos;
}

// ───────── Filtro local ─────────
export function filtrar(lista, q) {
  q = (q || '').trim().toLowerCase();
  if (!q) return lista;
  return lista.filter((r) =>
    [r.cedula, r.nombres, r.apellidos, r.correo, r.telefono].some((v) => (v || '').toLowerCase().includes(q))
  );
}

// ───────── Exportar ─────────
const COLUMNAS = [
  ['cedula', 'Cédula'],
  ['apellidos', 'Apellidos'],
  ['nombres', 'Nombres'],
  ['fechaNacimiento', 'Fecha de nacimiento'],
  ['sexo', 'Sexo'],
  ['tipoCedula', 'Tipo de cédula'],
  ['telefono', 'Teléfono'],
  ['correo', 'Correo'],
  ['fechaRegistro', 'Fecha de registro'],
  ['registradoPor', 'Registrado por'],
];

const filas = (lista) =>
  lista.map((r) => Object.fromEntries(COLUMNAS.map(([k, t]) => [t, k === 'fechaRegistro' ? formatearFecha(r[k]) : r[k] ?? ''])));

const nombreArchivo = (ext) => `asistencia_${new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' })}.${ext}`;

export function exportarExcel(lista) {
  if (!lista.length) return toast('No hay registros para exportar.', 'error');
  if (!window.XLSX) return toast('No cargó la librería de Excel. Usa CSV.', 'error');
  const hoja = window.XLSX.utils.json_to_sheet(filas(lista));
  hoja['!cols'] = COLUMNAS.map(([, t]) => ({ wch: Math.max(t.length + 2, 14) }));
  const libro = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(libro, hoja, 'Asistencia');
  window.XLSX.writeFile(libro, nombreArchivo('xlsx'));
}

export function exportarCSV(lista) {
  if (!lista.length) return toast('No hay registros para exportar.', 'error');
  const celda = (v) => {
    let s = String(v ?? '');
    if (/^[=@\-]/.test(s) || (/^\+/.test(s) && !/^\+\d+$/.test(s))) s = "'" + s; // evita fórmulas
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const datos = filas(lista);
  const csv = [COLUMNAS.map(([, t]) => t), ...datos.map((f) => Object.values(f))]
    .map((fila) => fila.map(celda).join(';'))
    .join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nombreArchivo('csv') });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
