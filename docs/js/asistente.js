import {
  iniciarPagina, toast, escapar, formatearFecha, prepararTelefono, ponerTelefono, leerTelefono,
  llenarFormulario, leerFormulario, filtrar, exportarExcel, exportarCSV,
} from './app.js?v=9';
import { interpretarLectura, leerCodigo, leerMRZDeFoto, leerReversoAmarilla, prepararImagen, precargarLectorTexto } from './cedula.js?v=9';

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
    setTimeout(precargarLectorTexto, 1500);
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

const estado = (texto) => {
  $('textoEstado').textContent = texto;
  $('estadoLectura').classList.toggle('oculto', !texto);
};

const conLimite = (promesa, ms) =>
  Promise.race([promesa, new Promise((_, no) => setTimeout(() => no(new Error('tiempo')), ms))]);

// Lee una foto: 1) código de barras / QR · 2) líneas <<< (digital) · 3) texto del reverso (amarilla)
async function leerImagen(archivo) {
  estado('Buscando código de barras…');
  try {
    const r = await conLimite(leerCodigo(archivo), 15000);
    if (r) {
      console.log('Lectura cruda:', r.formato, JSON.stringify(r.texto));
      const datos = interpretarLectura(r.texto, r.formato);
      if (lecturaCompleta(datos, r.formato)) return datos;
    }
  } catch (e) {
    console.warn('Código de barras:', e);
  }

  estado('Leyendo las líneas <<< (cédula digital)…');
  const img = await prepararImagen(archivo, 2000);
  try {
    const datos = await conLimite(leerMRZDeFoto(img), 30000);
    if (datos?.cedula && datos.nombres) return datos;
  } catch (e) {
    console.warn('MRZ:', e);
  }

  estado('Leyendo el texto del reverso (cédula amarilla)…');
  return conLimite(leerReversoAmarilla(archivo), 45000);
}

async function procesarFoto(ev) {
  const archivo = ev.target.files[0];
  ev.target.value = '';
  if (!archivo) return;
  $('zonaLector').classList.add('oculto');
  for (const el of document.querySelectorAll('#inFoto, #inGaleria')) el.disabled = true;
  try {
    const datos = await leerImagen(archivo);
    if (datos?.cedula) aplicarDatos(datos);
    else toast('No se pudo leer. Toma la foto de cerca, de frente, con buena luz y sin reflejos.', 'error');
  } catch (e) {
    console.error(e);
    toast(
      e.message === 'tiempo'
        ? 'Tardó demasiado. Revisa la conexión e inténtalo con otra foto más cercana.'
        : 'No se pudo leer la foto. Inténtalo de nuevo.',
      'error'
    );
  } finally {
    estado('');
    for (const el of document.querySelectorAll('#inFoto, #inGaleria')) el.disabled = false;
  }
}

$('inFoto').addEventListener('change', procesarFoto);
$('inGaleria').addEventListener('change', procesarFoto);

// Lector físico (pistola USB/Bluetooth que "escribe" como teclado) o texto pegado
let espera;
$('btnLector').addEventListener('click', () => {
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
