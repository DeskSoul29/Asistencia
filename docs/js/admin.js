import {
  iniciarPagina, toast, escapar, formatearFecha, prepararTelefono,
  llenarFormulario, leerFormulario, filtrar, exportarExcel, exportarCSV,
} from './app.js?v=5';

const $ = (id) => document.getElementById(id);
let lista = [];
let sesion;
let editando = null;

iniciarPagina({
  rol: 'admin',
  alEntrar: (s) => {
    sesion = s;
    prepararTelefono($('formEditar'));
    cargar();
  },
});

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
      <tr data-id="${r._id}">
        <td><b>${escapar(r.cedula)}</b></td>
        <td>${escapar(r.apellidos)}</td>
        <td>${escapar(r.nombres)}</td>
        <td>${escapar(r.fechaNacimiento)}</td>
        <td>${escapar(r.sexo)}</td>
        <td><span class="chip ${escapar(r.tipoCedula)}">${escapar(r.tipoCedula || '')}</span></td>
        <td>${escapar(r.telefono || '—')}</td>
        <td>${escapar(r.correo || '—')}</td>
        <td>${formatearFecha(r.fechaRegistro)}</td>
        <td>
          <button class="btn-sec btn-mini" data-accion="editar">✏️ Editar</button>
          <button class="btn-peligro btn-mini" data-accion="eliminar">🗑 Eliminar</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="10" class="vacio">Sin registros</td></tr>';
}

$('buscar').addEventListener('input', pintar);
$('btnRecargar').addEventListener('click', cargar);
$('btnExcel').addEventListener('click', () => exportarExcel(filtrar(lista, $('buscar').value)));
$('btnCSV').addEventListener('click', () => exportarCSV(filtrar(lista, $('buscar').value)));

$('tabla').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-accion]');
  if (!btn) return;
  const reg = lista.find((r) => r._id === btn.closest('tr').dataset.id);

  if (btn.dataset.accion === 'editar') {
    editando = reg;
    const form = $('formEditar');
    form.reset();
    prepararTelefono(form);
    llenarFormulario(form, { ...reg, telefono: reg.telefono || '' });
    $('infoRegistro').textContent =
      `Registrado ${formatearFecha(reg.fechaRegistro)} por ${reg.registradoPor || '—'}` +
      (reg.actualizado ? ` · Última edición ${formatearFecha(reg.actualizado)} (${reg.actualizadoPor})` : '');
    $('dlgEditar').showModal();
  }

  if (btn.dataset.accion === 'eliminar') {
    if (!confirm(`¿Eliminar a ${reg.nombres} ${reg.apellidos || ''} (cédula ${reg.cedula})?\nEsta acción no se puede deshacer.`)) return;
    try {
      await sesion.llamar(`/api/registros/${reg._id}`, { method: 'DELETE' });
      lista = lista.filter((r) => r._id !== reg._id);
      pintar();
      toast('Registro eliminado.');
    } catch (e) {
      toast(e.message, 'error');
    }
  }
});

$('dlgEditar').querySelector('[data-cerrar]').addEventListener('click', () => $('dlgEditar').close());

$('formEditar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  let datos;
  try {
    datos = leerFormulario(ev.target);
  } catch (e) {
    return toast(e.message, 'error');
  }
  try {
    const act = await sesion.llamar(`/api/registros/${editando._id}`, { method: 'PATCH', body: datos });
    Object.assign(editando, act);
    $('dlgEditar').close();
    pintar();
    toast('Cambios guardados ✔');
  } catch (e) {
    toast(e.message, 'error');
  }
});
