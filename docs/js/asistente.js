import {
  iniciarPagina, toast, escapar, formatearFecha, prepararTelefono, ponerTelefono, leerTelefono,
  llenarFormulario, leerFormulario, filtrar, exportarExcel, exportarCSV,
} from './app.js?v=5';
import { Escaner, interpretarLectura, leerMRZDeFoto } from './cedula.js?v=5';

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
const escaner = new Escaner('lector');

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
  (form.numero.value ? form.querySelector('[type=submit]') : form.numero).focus();
  if (navigator.vibrate) navigator.vibrate(120);
}

async function detenerCamara() {
  await escaner.detener();
  $('lector').classList.add('oculto');
  $('btnDetener').classList.add('oculto');
  $('btnCamara').classList.remove('oculto');
}

$('btnCamara').addEventListener('click', async () => {
  $('zonaLector').classList.add('oculto');
  $('lector').classList.remove('oculto');
  $('btnDetener').classList.remove('oculto');
  $('btnCamara').classList.add('oculto');
  try {
    await escaner.iniciar(async (texto, formato) => {
      await detenerCamara();
      aplicarLectura(texto, formato);
    });
  } catch (e) {
    await detenerCamara();
    toast('No se pudo abrir la cámara. Revisa los permisos del navegador.', 'error');
    console.error(e);
  }
});
$('btnDetener').addEventListener('click', detenerCamara);

$('inFoto').addEventListener('change', async (ev) => {
  const archivo = ev.target.files[0];
  ev.target.value = '';
  if (!archivo) return;
  await detenerCamara();

  // 1) Código de barras / QR
  try {
    const { texto, formato } = await escaner.desdeArchivo(archivo);
    const datos = interpretarLectura(texto, formato);
    if (datos?.cedula && datos.nombres) return aplicarLectura(texto, formato);
  } catch { /* sin código legible: se intenta la MRZ */ }

  // 2) Texto de la zona MRZ (reverso de la cédula digital)
  toast('Leyendo el texto del reverso… (la primera vez tarda unos segundos)', 'aviso');
  try {
    const datos = await leerMRZDeFoto(archivo);
    if (datos?.cedula) return aplicarDatos(datos);
    toast('No se pudo leer la foto. Toma la foto de frente, con buena luz y sin reflejos sobre las líneas <<<.', 'error');
  } catch (e) {
    console.error(e);
    toast('No se pudo leer la foto. Toma la foto de frente, con buena luz y sin reflejos.', 'error');
  }
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
