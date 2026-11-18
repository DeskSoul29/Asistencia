// Lectura e interpretación de cédulas colombianas
//  - Cédula amarilla con hologramas: código PDF417 en el reverso
//  - Cédula digital (2020+): código QR y zona MRZ (líneas con <<<)

const limpiarTexto = (s) => (s || '').replace(/\0/g, ' ').replace(/[^A-ZÑÁÉÍÓÚÜ ]/gi, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

function fechaISO(aaaammdd) {
  if (!/^(19|20)\d{6}$/.test(aaaammdd || '')) return '';
  const a = aaaammdd.slice(0, 4), m = aaaammdd.slice(4, 6), d = aaaammdd.slice(6, 8);
  if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return '';
  return `${a}-${m}-${d}`;
}

const sinCeros = (n) => String(n).replace(/\D/g, '').replace(/^0+/, '');

// ───────── Cédula amarilla (PDF417) ─────────
export function parsearPDF417(raw) {
  if (!raw) return null;

  // 1) Formato estándar por posiciones fijas
  if (raw.length >= 160) {
    const ced = raw.slice(48, 58).replace(/[\s\0]/g, '');
    if (/^\d{6,10}$/.test(ced) && /[A-ZÑ]/i.test(raw.slice(58, 81))) {
      const ap1 = limpiarTexto(raw.slice(58, 81));
      const ap2 = limpiarTexto(raw.slice(81, 104));
      const n1 = limpiarTexto(raw.slice(104, 127));
      const n2 = limpiarTexto(raw.slice(127, 150));
      const sexo = raw[151];
      return {
        cedula: sinCeros(ced),
        apellidos: [ap1, ap2].filter(Boolean).join(' '),
        nombres: [n1, n2].filter(Boolean).join(' '),
        sexo: /[MF]/.test(sexo) ? sexo : '',
        fechaNacimiento: fechaISO(raw.slice(152, 160)),
        tipoCedula: 'amarilla',
      };
    }
  }

  // 2) Campos separados por caracteres nulos o espacios (algunos lectores alteran las posiciones)
  const t = raw.replace(/\0+/g, '|').replace(/ {2,}/g, '|');
  const m = t.match(/(\d{6,10})([A-ZÑ][A-ZÑ ]*)\|+([A-ZÑ ]*)\|+([A-ZÑ ]*)\|+([A-ZÑ ]*)\|*0?([MF])((?:19|20)\d{6})/i);
  if (m) {
    return {
      cedula: sinCeros(m[1]),
      apellidos: [m[2], m[3]].map(limpiarTexto).filter(Boolean).join(' '),
      nombres: [m[4], m[5]].map(limpiarTexto).filter(Boolean).join(' '),
      sexo: m[6].toUpperCase(),
      fechaNacimiento: fechaISO(m[7]),
      tipoCedula: 'amarilla',
    };
  }

  // 3) Datos separados por espacios simples (lectores que convierten los separadores)
  const plano = parsearTextoPlano(raw, 'amarilla');
  if (plano) return plano;

  // 4) Lector físico que eliminó los separadores: solo se pueden sacar número, sexo y fecha
  const m2 = raw.match(/0*(\d{6,10})([A-ZÑ]{3,})0?([MF])((?:19|20)\d{6})/i);
  if (m2) {
    return {
      cedula: sinCeros(m2[1]),
      apellidos: '',
      nombres: '',
      sexo: m2[3].toUpperCase(),
      fechaNacimiento: fechaISO(m2[4]),
      tipoCedula: 'amarilla',
      aviso: `Los nombres vinieron pegados ("${limpiarTexto(m2[2])}"). Escríbelos separados.`,
    };
  }
  return null;
}

// ───────── Cédula digital (MRZ, formato TD1 de 3 líneas x 30) ─────────
// Dígito de control ICAO 9303 (pesos 7-3-1)
function digitoControl(s) {
  const valor = (c) => (c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55);
  return String([...s].reduce((t, c, i) => t + valor(c) * [7, 3, 1][i % 3], 0) % 10);
}

// Busca las 3 líneas MRZ aunque vengan con ruido (OCR, texto pegado, lector físico)
function extraerMRZ(texto) {
  const crudas = (texto || '')
    .toUpperCase()
    .replace(/«/g, '<')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const lineas = crudas.map((l) => l.replace(/[^A-Z0-9<]/g, ''));
  const dig = (s) => s.replace(/O/g, '0');

  // Línea 2: AAMMDD d SEXO AAMMDD d COL datos(11) d
  let i2 = -1, l2 = '';
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/([0-9O]{6})([0-9O])([MF<])([0-9O]{6})([0-9O])C[O0]L([0-9A-Z<]{0,11})([0-9O])?/);
    if (m) {
      i2 = i;
      l2 = dig(m[1]) + dig(m[2]) + m[3] + dig(m[4]) + dig(m[5]) + 'COL' + dig(m[6]).padEnd(11, '<') + dig(m[7] || '<');
      break;
    }
  }
  if (i2 < 0) return null;

  // Línea 1: I?COL + número de documento + datos opcionales (antes de la línea 2)
  let l1 = '';
  for (const l of lineas.slice(0, i2 + 1).reverse()) {
    const m = l.match(/I[A-Z<]C[O0]L([0-9A-Z<]{9,25})/);
    if (m) { l1 = ('ICCOL' + m[1]).slice(0, 30).padEnd(30, '<'); break; }
  }

  // Línea 3: APELLIDOS<<NOMBRES (después de la línea 2)
  // Se mira cada "palabra" por separado: el OCR suele dejar basura separada por espacio ("Z DUARTE<…")
  let l3 = '';
  for (const l of crudas.slice(i2 + 1)) {
    const tokens = l.split(/\s+/).map((t) => t.replace(/[^A-Z0-9<]/g, ''));
    let mejor = '';
    for (const t of tokens) {
      // APELLIDO(<APELLIDO)<<NOMBRE(<NOMBRE): un solo "<" entre palabras; lo que sigue a "<<<" es relleno o ruido
      const m = t.match(/[A-Z]+(?:<[A-Z]+)*<<[A-Z]+(?:<[A-Z]+)*/);
      if (m && m[0].length > mejor.length) mejor = m[0];
    }
    if (mejor) {
      l3 = mejor;
      break;
    }
  }
  return { l1, l2, l3 };
}

export function parsearMRZ(texto) {
  const mrz = extraerMRZ(texto);
  if (!mrz) return null;
  const { l1, l2, l3 } = mrz;

  // NUIP: primero en datos opcionales de la línea 2, luego línea 1
  const candidatos = [l2.slice(18, 29), l1.slice(15, 30), l1.slice(5, 14)];
  let cedula = '';
  for (const c of candidatos) {
    const d = (c.match(/\d{6,10}/) || [])[0];
    if (d) { cedula = sinCeros(d); break; }
  }

  const yy = l2.slice(0, 6);
  const fechaNacimiento = fechaCorta(yy);
  const avisos = [];
  if (fechaNacimiento && digitoControl(yy) !== l2[6]) avisos.push('la fecha de nacimiento');
  if (!l3) avisos.push('los nombres');
  const [ap = '', nom = ''] = l3.split('<<');
  return {
    cedula,
    apellidos: ap.replace(/</g, ' ').trim(),
    nombres: nom.replace(/</g, ' ').trim(),
    sexo: /[MF]/.test(l2[7]) ? l2[7] : '',
    fechaNacimiento,
    tipoCedula: 'digital',
    ...(avisos.length ? { aviso: `Leído del reverso. Revisa ${avisos.join(' y ')} antes de guardar.` } : {}),
  };
}

// ───────── OCR de la zona MRZ desde una foto (tesseract.js + modelo MRZ) ─────────
let workerMRZ = null;
function obtenerWorkerMRZ() {
  if (!workerMRZ) {
    workerMRZ = (async () => {
      if (!window.Tesseract) throw new Error('No cargó el lector de texto (Tesseract).');
      const w = await window.Tesseract.createWorker('mrz', 1, {
        langPath: new URL('../tessdata', import.meta.url).href,
        gzip: false,
      });
      await w.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
        tessedit_pageseg_mode: '6',
      });
      return w;
    })().catch((e) => { workerMRZ = null; throw e; });
  }
  return workerMRZ;
}

// Reduce fotos grandes del celular para que el OCR sea rápido
export async function prepararImagen(archivo, anchoMax = 1600) {
  const bmp = await createImageBitmap(archivo);
  const escala = Math.min(1, anchoMax / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * escala);
  c.height = Math.round(bmp.height * escala);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

// Descarga el lector de texto en segundo plano para que la primera foto sea rápida
export function precargarLectorTexto() {
  obtenerWorkerMRZ().catch((e) => console.warn('No se pudo precargar el OCR', e));
}

export async function leerMRZDeFoto(archivo) {
  const [worker, imagen] = await Promise.all([obtenerWorkerMRZ(), prepararImagen(archivo)]);
  let { data } = await worker.recognize(imagen);
  let datos = parsearMRZ(data.text);
  if (!datos) {
    // Segundo intento: solo la mitad inferior (donde suele estar la MRZ)
    const c = document.createElement('canvas');
    c.width = imagen.width;
    c.height = Math.round(imagen.height / 2);
    c.getContext('2d').drawImage(imagen, 0, imagen.height - c.height, c.width, c.height, 0, 0, c.width, c.height);
    ({ data } = await worker.recognize(c));
    datos = parsearMRZ(data.text);
  }
  console.log('Texto OCR:', JSON.stringify(data.text));
  return datos;
}

// ───────── Cédula digital (QR) ─────────
export function parsearQRDigital(texto) {
  const mrz = parsearMRZ(texto);
  if (mrz) return mrz;

  try {
    const j = JSON.parse(texto);
    const buscar = (...claves) => {
      for (const [k, v] of Object.entries(j)) if (claves.some((c) => k.toLowerCase().includes(c))) return String(v);
      return '';
    };
    const cedula = sinCeros(buscar('nuip', 'cedula', 'documento', 'numero'));
    if (cedula) {
      return {
        cedula,
        nombres: buscar('nombre').toUpperCase(),
        apellidos: buscar('apellido').toUpperCase(),
        fechaNacimiento: buscar('nacimiento').slice(0, 10),
        sexo: buscar('sexo').slice(0, 1).toUpperCase(),
        tipoCedula: 'digital',
      };
    }
  } catch { /* no es JSON */ }

  const plano = parsearTextoPlano(texto, 'digital');
  if (plano) return plano;

  const numero = (texto.match(/(?:NUIP|C[ÉE]DULA|DOCUMENTO)\D{0,5}(\d{6,10})/i) || texto.match(/(?<!\d)(\d{8,10})(?!\d)/) || [])[1];
  if (numero) {
    return {
      cedula: sinCeros(numero),
      tipoCedula: 'digital',
      aviso: 'Del código solo se pudo leer el número. Completa los nombres.',
    };
  }
  return null;
}

// Fecha AAMMDD → AAAA-MM-DD (siglo según el año actual)
function fechaCorta(aammdd) {
  if (!/^\d{6}$/.test(aammdd || '')) return '';
  const siglo = +aammdd.slice(0, 2) > new Date().getFullYear() % 100 ? '19' : '20';
  return fechaISO(siglo + aammdd);
}

// Datos en texto. Formatos conocidos:
//  amarilla: "CEDULA APELLIDOS NOMBRES [0]SEXO AAAAMMDD"
//  digital (QR leído por lector): "CEDULA APELLIDOS NOMBRES;;; ,AAMMDD SEXO"
function parsearTextoPlano(texto, tipoCedula) {
  const t = (texto || '').replace(/\0/g, ' ').toUpperCase();
  const SEP = '[\\s|,;]';
  const inicio = `(?<!\\d)(\\d{6,10})${SEP}+([A-ZÑÁÉÍÓÚÜ][A-ZÑÁÉÍÓÚÜ\\s|,;'.-]*?)${SEP}+`;
  let m = t.match(new RegExp(`${inicio}0?([MF])${SEP}*((?:19|20)\\d{6})(?!\\d)`));
  let sexo, fecha;
  if (m) {
    sexo = m[3];
    fecha = fechaISO(m[4]);
  } else {
    m = t.match(new RegExp(`${inicio}((?:19|20)\\d{6}|\\d{6})${SEP}*([MF])(?![A-Z])`));
    if (!m) return null;
    fecha = m[3].length === 8 ? fechaISO(m[3]) : fechaCorta(m[3]);
    sexo = m[4];
    if (m[3].length === 6) tipoCedula = 'digital'; // la fecha corta solo aparece en la cédula digital
  }

  let apellidos = '', nombres = '', aviso = '';
  const nombresCrudos = m[2].trim();
  // Si el QR separa los campos (varios espacios, tabulador, |, ;, salto de línea) se respetan
  const campos = nombresCrudos.split(/\s{2,}|[|;,\t\n]+/).map(limpiarTexto).filter(Boolean);
  if (campos.length === 4) {
    apellidos = `${campos[0]} ${campos[1]}`;
    nombres = `${campos[2]} ${campos[3]}`;
  } else if (campos.length === 2) {
    [apellidos, nombres] = campos;
  } else {
    // Separados por un solo espacio: 2 primeras palabras = apellidos, resto = nombres
    const p = limpiarTexto(nombresCrudos).split(' ');
    if (p.length === 1) nombres = p[0];
    else if (p.length === 2) [apellidos, nombres] = p;
    else {
      apellidos = p.slice(0, 2).join(' ');
      nombres = p.slice(2).join(' ');
    }
    if (p.length === 3 || p.length > 4) aviso = 'Revisa que apellidos y nombres hayan quedado bien separados.';
  }

  return {
    cedula: sinCeros(m[1]),
    apellidos,
    nombres,
    sexo,
    fechaNacimiento: fecha,
    tipoCedula,
    ...(aviso ? { aviso } : {}),
  };
}

// ───────── Punto de entrada ─────────
export function interpretarLectura(texto, formato = '') {
  if (!texto) return null;
  if (/PDF.?417/i.test(formato)) return parsearPDF417(texto);
  if (/QR/i.test(formato)) return parsearQRDigital(texto);
  // Sin formato (lector físico o texto pegado): probar todo
  return parsearMRZ(texto) || parsearPDF417(texto) || parsearQRDigital(texto);
}

// ───────── Código de barras / QR desde una foto (zxing-wasm, global ZXingWASM) ─────────
const OPCIONES_CODIGO = {
  formats: ['PDF417', 'QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};

function resultadoCodigo(lista) {
  const r = (lista || []).find((x) => x.isValid);
  if (!r) return null;
  // PDF417 de la cédula amarilla trae caracteres nulos: se usan los bytes crudos para no perder posiciones
  const esPDF = /PDF/i.test(r.format);
  const texto = esPDF ? new TextDecoder('windows-1252').decode(r.bytes) : r.text;
  return { texto, formato: esPDF ? 'PDF_417' : 'QR_CODE' };
}

// El fondo amarillo con hologramas confunde al binarizador por defecto:
// se prueban varios (FixedThreshold es el que lee la cédula amarilla en fotos reales)
const BINARIZADORES = ['LocalAverage', 'FixedThreshold', 'GlobalHistogram'];

async function probarBinarizadores(Z, entrada) {
  for (const binarizer of BINARIZADORES) {
    const r = resultadoCodigo(await Z.readBarcodes(entrada, { ...OPCIONES_CODIGO, binarizer }));
    if (r) return r;
  }
  return null;
}

export async function leerCodigo(archivo) {
  const Z = window.ZXingWASM;
  if (!Z) throw new Error('No cargó el lector de códigos.');
  let r = await probarBinarizadores(Z, archivo);
  if (r) return r;
  // Imagen pequeña: se amplía y se intenta otra vez
  const img = await prepararImagen(archivo, 4000);
  if (img.width < 1500) {
    const c = ampliar(img, 2);
    r = await probarBinarizadores(Z, c.getContext('2d').getImageData(0, 0, c.width, c.height));
  }
  return r;
}

function ampliar(canvas, factor) {
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * factor);
  c.height = Math.round(canvas.height * factor);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

// ───────── Respaldo: texto impreso en el reverso de la cédula amarilla ─────────
//  "P-2500100-01096450-M-1004802359-20190903"  → sexo y cédula
//  "FECHA DE NACIMIENTO 29-MAR-2001"           → fecha de nacimiento
const MESES = { ENE: '01', FEB: '02', MAR: '03', ABR: '04', MAY: '05', JUN: '06', JUL: '07', AGO: '08', SEP: '09', OCT: '10', NOV: '11', DIC: '12' };

export function parsearReversoAmarilla(texto) {
  const t = (texto || '').toUpperCase().replace(/[—–_~=]/g, '-');
  const compacto = t.replace(/\s+/g, '');
  const m = compacto.match(/P-?[0-9O]{5,9}-?[0-9O]{5,9}-?([MF])-?([0-9O]{6,10})(?![0-9])/);
  if (!m) return null;
  const datos = {
    cedula: sinCeros(m[2].replace(/O/g, '0')),
    sexo: m[1],
    apellidos: '',
    nombres: '',
    tipoCedula: 'amarilla',
    aviso: 'No se leyó el código de barras. VERIFICA el número de cédula con la tarjeta y escribe los nombres (o toma una foto más nítida).',
  };
  const f = t.match(/(\d{1,2})\s*-\s*(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)\s*-\s*((?:19|20)\d{2})/);
  if (f) datos.fechaNacimiento = fechaISO(f[3] + MESES[f[2]] + f[1].padStart(2, '0'));
  return datos;
}

let workerTexto = null;
function obtenerWorkerTexto() {
  if (!workerTexto) {
    if (!window.Tesseract) return Promise.reject(new Error('No cargó el lector de texto (Tesseract).'));
    workerTexto = window.Tesseract.createWorker('eng').catch((e) => {
      workerTexto = null;
      throw e;
    });
  }
  return workerTexto;
}

export async function leerReversoAmarilla(archivo) {
  let img = await prepararImagen(archivo, 2400);
  if (img.width < 1600) img = ampliar(img, Math.min(4, 1800 / img.width));
  const worker = await obtenerWorkerTexto();
  const { data } = await worker.recognize(img);
  console.log('Texto OCR (amarilla):', JSON.stringify(data.text));
  return parsearReversoAmarilla(data.text);
}

// ───────── Cámara en vivo: sigue buscando hasta tener una lectura válida ─────────
const PROPORCION_CEDULA = 85.6 / 54;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export class EscanerVivo {
  constructor(video, { alLeer, alEstado = () => {} }) {
    this.video = video;
    this.alLeer = alLeer;
    this.alEstado = alEstado;
    this.activo = false;
    this.stream = null;
  }

  async iniciar() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    if (!this.video.videoWidth) await new Promise((r) => this.video.addEventListener('loadedmetadata', r, { once: true }));
    // Enfoque continuo donde el navegador lo permita
    try {
      const pista = this.stream.getVideoTracks()[0];
      const cap = pista.getCapabilities?.() || {};
      if (cap.focusMode?.includes('continuous')) await pista.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch { /* no soportado */ }
    this.activo = true;
    this.mrzPrevio = null;
    this.bucleCodigo();
    this.bucleMRZ();
  }

  detener() {
    this.activo = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  // Recuadro guía en coordenadas del video: centrado y con la forma de la cédula
  guia() {
    const W = this.video.videoWidth, H = this.video.videoHeight;
    let w = W * 0.9, h = w / PROPORCION_CEDULA;
    if (h > H * 0.9) { h = H * 0.9; w = h * PROPORCION_CEDULA; }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h, W, H };
  }

  // Recorta el recuadro (desdeY: 0 = toda la cédula, 0.45 = mitad inferior)
  recorte(desdeY = 0, anchoMax = 1600) {
    const g = this.guia();
    const sy = g.y + g.h * desdeY, sh = g.h * (1 - desdeY);
    const esc = Math.min(1, anchoMax / g.w);
    const c = document.createElement('canvas');
    c.width = Math.round(g.w * esc);
    c.height = Math.round(sh * esc);
    c.getContext('2d', { willReadFrequently: true }).drawImage(this.video, g.x, sy, g.w, sh, 0, 0, c.width, c.height);
    return c;
  }

  terminar(datos) {
    if (!this.activo) return;
    this.detener();
    this.alLeer(datos);
  }

  // Lector nativo del celular (Chrome Android: BarcodeDetector), si existe y soporta PDF417
  async detectorNativo() {
    if (this._nativo !== undefined) return this._nativo;
    this._nativo = null;
    try {
      if ('BarcodeDetector' in window) {
        const formatos = await window.BarcodeDetector.getSupportedFormats();
        if (formatos.includes('pdf417')) {
          this._nativo = new window.BarcodeDetector({ formats: ['pdf417', 'qr_code'].filter((f) => formatos.includes(f)) });
        }
      }
    } catch { /* no disponible */ }
    return this._nativo;
  }

  // Código de barras (amarilla) o QR: varias veces por segundo.
  // Primero el lector nativo (rápido); luego zxing alternando binarizadores.
  async bucleCodigo() {
    let i = 0;
    const nativo = await this.detectorNativo();
    while (this.activo) {
      const Z = window.ZXingWASM;
      if (nativo && this.video.readyState >= 2) {
        try {
          for (const b of await nativo.detect(this.video)) {
            const formato = b.format === 'pdf417' ? 'PDF_417' : 'QR_CODE';
            console.log('Lectura cruda (nativo):', formato, JSON.stringify(b.rawValue));
            const d = interpretarLectura(b.rawValue, formato);
            if (d?.cedula && d.nombres && this.activo) return this.terminar(d);
          }
        } catch (e) {
          console.warn('Lector nativo:', e);
        }
      }
      if (Z && this.video.readyState >= 2 && this.activo) {
        try {
          const c = this.recorte(0, 1600);
          const imagen = c.getContext('2d').getImageData(0, 0, c.width, c.height);
          const binarizer = BINARIZADORES[i++ % BINARIZADORES.length];
          const r = resultadoCodigo(await Z.readBarcodes(imagen, { ...OPCIONES_CODIGO, tryRotate: false, binarizer }));
          if (r && this.activo) {
            console.log('Lectura cruda (cámara):', r.formato, JSON.stringify(r.texto));
            const d = interpretarLectura(r.texto, r.formato);
            if (d?.cedula && d.nombres) return this.terminar(d);
          }
        } catch (e) {
          console.warn('Código (cámara):', e);
        }
      }
      await esperar(60);
    }
  }
  return null;
}

  // Líneas <<< (digital): se acepta solo si el control de la fecha cuadra y dos lecturas seguidas coinciden
  async bucleMRZ() {
    let worker;
    try {
      worker = await obtenerWorkerMRZ();
    } catch (e) {
      console.warn('OCR no disponible:', e);
      return;
    }
    while (this.activo) {
      if (this.video.readyState >= 2) {
        try {
          const { data } = await worker.recognize(this.recorte(0.45, 1400));
          if (!this.activo) return;
          const d = parsearMRZ(data.text);
          if (d?.cedula?.length >= 6 && d.nombres && d.apellidos && d.fechaNacimiento && !d.aviso) {
            const clave = [d.cedula, d.apellidos, d.nombres, d.fechaNacimiento, d.sexo].join('|');
            if (clave === this.mrzPrevio) return this.terminar(d);
            this.mrzPrevio = clave;
            this.alEstado('Casi listo… mantén la cédula quieta');
          }
        } catch (e) {
          console.warn('MRZ (cámara):', e);
        }
      }
      await esperar(100);
    }
  }
}
