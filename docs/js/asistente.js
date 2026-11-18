import {
  iniciarPagina, toast, escapar, formatearFecha, prepararTelefono, ponerTelefono, leerTelefono,
  llenarFormulario, leerFormulario, filtrar, exportarExcel, exportarCSV,
} from './app.js?v=6';
import { Escaner, interpretarLectura, leerMRZDeFoto } from './cedula.js?v=6';

const $ = (id) => document.getElementById(id);
let lista = [];
let sesion;
let idResaltado = null;

iniciarPagina({
  rol: 'asistente',
  alEntrar: (s) => {
    sesion = s;
    prepararTelefono($('formRegistro'));
    prepararTelefono($('formDato'));
    cargar();
  },
});

// ───────── Listado ─────────
async function cargar() {
  try {
    lista = await sesion.llamar('/api/registros');
    pintar();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function pintar() {
  const vista = filtrar(lista, $('buscar').value);
  $('contador').textContent = `${vista.length} de ${lista.length}`;
  $('tabla').innerHTML = vista.length
    ? vista.map((r) => `
      <tr data-id="${r._id}" class="${r._id === idResaltado ? 'nuevo' : ''}">
        <td><b>${escapar(r.cedula)}</b></td>
        <td>${escapar(`${r.nombres || ''} ${r.apellidos || ''}`)}</td>
        <td><span class="chip ${escapar(r.tipoCedula)}">${escapar(r.tipoCedula || '')}</span></td>
        <td>${escapar(r.telefono || '—')}</td>
        <td>${escapar(r.correo || '—')}</td>
        <td>${formatearFecha(r.fechaRegistro)}</td>
        <td><button class="btn-sec btn-mini" data-accion="dato">＋ Teléfono / correo</button></td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="vacio">Sin registros</td></tr>';
}

$('buscar').addEventListener('input', pintar);
$('btnRecargar').addEventListener('click', cargar);
$('btnExcel').addEventListener('click', () => exportarExcel(filtrar(lista, $('buscar').value)));
$('btnCSV').addEventListener('click', () => exportarCSV(filtrar(lista, $('buscar').value)));

// ───────── Lectura de cédula ─────────
const escaner = new Escaner('lector', 'lectorArchivo');

// ¿La lectura trae lo necesario para llenar el formulario?
const lecturaCompleta = (d, formato = '') => !!(d?.cedula && (d.nombres || /PDF/i.test(formato)));

function aplicarLectura(texto, formato) {
  console.log('Lectura cruda:', formato || '(sin formato)', JSON.stringify(texto));
  const datos = interpretarLectura(texto, formato);
  if (!datos || !datos.cedula) {
    toast('Se leyó el código pero no se reconocieron los datos. Escríbelos a mano.', 'error');
    return;
  }
  aplicarDatos(datos);
}

function aplicarDatos(datos) {
  const form = $('formRegistro');
  const tel = leerTelefono(form).telefono;
  const correo = form.correo.value;
  form.reset();
  llenarFormulario(form, datos);
  ponerTelefono(form, tel);
  form.correo.value = correo;
  toast(datos.aviso || `Cédula ${datos.cedula} leída ✔`, datos.aviso ? 'aviso' : 'ok');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (navigator.vibrate) navigator.vibrate(120);
}

// Intenta leer una imagen (foto o cuadro de la cámara): primero código, luego líneas <<<
async function leerImagen(fuente) {
  try {
    const { texto, formato } = await escaner.desdeArchivo(fuente);
    console.log('Lectura cruda:', formato, JSON.stringify(texto));
    const datos = interpretarLectura(texto, formato);
    if (lecturaCompleta(datos, formato)) return datos;
  } catch { /* sin código legible */ }
  return leerMRZDeFoto(fuente).catch((e) => { console.error(e); return null; });
}

// ── Cámara en vivo ──
let intervaloMRZ = null;
let ocupadoMRZ = false;
const estado = (t) => ($('estadoCamara').textContent = t);

async function detenerCamara() {
  clearInterval(intervaloMRZ);
  intervaloMRZ = null;
  await escaner.detener();
  $('zonaCamara').classList.add('oculto');
  $('btnCamara').classList.remove('oculto');
}

async function terminarConDatos(datos) {
  await detenerCamara();
  aplicarDatos(datos);
}

// Cada pocos segundos intenta leer las líneas <<< del cuadro actual (cédula digital)
async function intentoAutomaticoMRZ() {
  if (ocupadoMRZ || !escaner.activa) return;
  const c = escaner.cuadro();
  if (!c) return;
  ocupadoMRZ = true;
  try {
    const datos = await leerMRZDeFoto(c);
    if (datos?.cedula && datos.nombres && escaner.activa) await terminarConDatos(datos);
  } catch (e) {
    console.error(e);
  } finally {
    ocupadoMRZ = false;
  }
}

$('btnCamara').addEventListener('click', async () => {
  $('zonaLector').classList.add('oculto');
  $('zonaCamara').classList.remove('oculto');
  $('btnCamara').classList.add('oculto');
  estado('Buscando código… o pulsa «Capturar y leer».');
  try {
    await escaner.iniciar(async (texto, formato) => {
      console.log('Lectura cruda:', formato, JSON.stringify(texto));
      const datos = interpretarLectura(texto, formato);
      if (!lecturaCompleta(datos, formato)) return false; // p. ej. QR sin datos: sigue buscando
      await terminarConDatos(datos);
      return true;
    });
    intervaloMRZ = setInterval(intentoAutomaticoMRZ, 3000);
  } catch (e) {
    await detenerCamara();
    toast('No se pudo abrir la cámara. Revisa los permisos del navegador o usa «Desde una foto».', 'error');
    console.error(e);
  }
});
$('btnDetener').addEventListener('click', detenerCamara);

$('btnCapturar').addEventListener('click', async () => {
  const c = escaner.cuadro();
  if (!c) return;
  const btn = $('btnCapturar');
  btn.disabled = true;
  estado('Leyendo… mantén la cédula quieta.');
  while (ocupadoMRZ) await new Promise((r) => setTimeout(r, 150)); // espera el intento automático
  ocupadoMRZ = true;
  try {
    const datos = await leerImagen(c);
    if (datos?.cedula) return await terminarConDatos(datos);
    estado('No se pudo leer. Acerca la cédula, con buena luz y sin reflejos, y vuelve a intentar.');
    toast('No se pudo leer. Acércala más y evita reflejos.', 'error');
  } finally {
    ocupadoMRZ = false;
    btn.disabled = false;
  }
});

// ── Foto ──
$('inFoto').addEventListener('change', async (ev) => {
  const archivo = ev.target.files[0];
  ev.target.value = '';
  if (!archivo) return;
  await detenerCamara();
  toast('Leyendo la foto… (la primera vez tarda unos segundos)', 'aviso');
  const datos = await leerImagen(archivo);
  if (datos?.cedula) return aplicarDatos(datos);
  toast('No se pudo leer la foto. Tómala de frente, con buena luz y sin reflejos.', 'error');
});

// Lector físico (pistola USB/Bluetooth que "escribe" como teclado) o texto pegado
let espera;
$('btnLector').addEventListener('click', async () => {
  await detenerCamara();
  $('zonaLector').classList.toggle('oculto');
  $('txtLector').value = '';
  $('txtLector').focus();
});
$('txtLector').addEventListener('input', () => {
  clearTimeout(espera);
  espera = setTimeout(() => {
    const texto = $('txtLector').value;
    if (texto.trim().length < 6) return;
    aplicarLectura(texto, '');
    $('txtLector').value = '';
  }, 400);
});

// ───────── Guardar ─────────
$('formRegistro').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const btn = form.querySelector('[type=submit]');
  let datos;
  try {
    datos = leerFormulario(form);
  } catch (e) {
    return toast(e.message, 'error');
  }
  btn.disabled = true;
  try {
    const nuevo = await sesion.llamar('/api/registros', { method: 'POST', body: datos });
    lista.unshift(nuevo);
    idResaltado = nuevo._id;
    form.reset();
    $('buscar').value = '';
    pintar();
    toast(`Asistencia registrada: ${nuevo.nombres} ✔`);
    form.cedula.focus();
  } catch (e) {
    if (e.status === 409 && e.data?.existente) {
      const ex = e.data.existente;
      toast(`Ya estaba registrada: ${ex.nombres || ''} ${ex.apellidos || ''} (${formatearFecha(ex.fechaRegistro)})`, 'aviso');
      $('buscar').value = ex.cedula;
      pintar();
    } else {
      toast(e.message, 'error');
    }
  } finally {
    btn.disabled = false;
  }
});

// ───────── Agregar teléfono / correo ─────────
let editando = null;
$('tabla').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-accion=dato]');
  if (!btn) return;
  editando = lista.find((r) => r._id === btn.closest('tr').dataset.id);
  const form = $('formDato');
  $('datoPersona').textContent = `${editando.cedula} · ${editando.nombres} ${editando.apellidos || ''}`;
  ponerTelefono(form, editando.telefono);
  form.correo.value = editando.correo || '';
  $('dlgDato').showModal();
});
$('dlgDato').querySelector('[data-cerrar]').addEventListener('click', () => $('dlgDato').close());

$('formDato').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const tel = leerTelefono(form);
  if (tel.error) return toast(tel.error, 'error');
  try {
    const act = await sesion.llamar(`/api/registros/${editando._id}`, {
      method: 'PATCH',
      body: { telefono: tel.telefono, correo: form.correo.value.trim() },
    });
    Object.assign(editando, act);
    $('dlgDato').close();
    pintar();
    toast('Datos de contacto guardados ✔');
  } catch (e) {
    toast(e.message, 'error');
  }
});
