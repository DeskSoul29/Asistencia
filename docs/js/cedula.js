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
      const m = t.match(/[A-Z]+(?:<[A-Z]+)*<<[A-Z]+(?:<+[A-Z]+)*<*/);
      if (m && m[0].length > mejor.length) mejor = m[0];
    }
    if (mejor) {
      // La línea mide 30: si sobra, lo que sobra está al principio
      if (mejor.length > 30) mejor = mejor.slice(mejor.length - 30);
      l3 = mejor.replace(/<+$/, '');
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
async function prepararImagen(archivo, anchoMax = 1600) {
  const bmp = await createImageBitmap(archivo);
  const escala = Math.min(1, anchoMax / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * escala);
  c.height = Math.round(bmp.height * escala);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
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

// ───────── Cámara / foto (usa html5-qrcode cargado como script global) ─────────
function crearLector(id) {
  const F = window.Html5QrcodeSupportedFormats;
  return new window.Html5Qrcode(id, {
    formatsToSupport: [F.PDF_417, F.QR_CODE],
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    verbose: false,
  });
}

export class Escaner {
  // idVideo: donde se muestra la cámara · idArchivo: elemento oculto para leer fotos/cuadros
  constructor(idVideo, idArchivo) {
    this.idVideo = idVideo;
    this.idArchivo = idArchivo;
    this.h = null;
    this.hArchivo = null;
    this.ocupado = false;
  }

  // alLeer(texto, formato) debe devolver true si la lectura sirvió (y se apaga la cámara)
  async iniciar(alLeer) {
    if (!this.h) this.h = crearLector(this.idVideo);
    this.ocupado = false;
    await this.h.start(
      { facingMode: 'environment' },
      {
        fps: 12,
        qrbox: (w, alto) => ({ width: Math.floor(w * 0.95), height: Math.floor(alto * 0.75) }),
        videoConstraints: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          focusMode: 'continuous',
        },
      },
      async (texto, resultado) => {
        if (this.ocupado) return;
        this.ocupado = true;
        try {
          const sirvio = await alLeer(texto, resultado?.result?.format?.formatName || '');
          if (sirvio) await this.detener();
        } finally {
          this.ocupado = false;
        }
      },
      () => {}
    );
  }

  get activa() {
    return !!this.h?.isScanning;
  }

  async detener() {
    if (this.h?.isScanning) await this.h.stop().catch(() => {});
  }

  // Cuadro actual del video en resolución completa
  cuadro() {
    const video = document.querySelector(`#${this.idVideo} video`);
    if (!video || !video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return c;
  }

  // Lee código de barras / QR de una foto o de un canvas (no apaga la cámara)
  async desdeArchivo(fuente) {
    let archivo = fuente;
    if (fuente instanceof HTMLCanvasElement) {
      const blob = await new Promise((ok) => fuente.toBlob(ok, 'image/jpeg', 0.95));
      archivo = new File([blob], 'cuadro.jpg', { type: 'image/jpeg' });
    }
    if (!this.hArchivo) this.hArchivo = crearLector(this.idArchivo);
    const r = await this.hArchivo.scanFileV2(archivo, false);
    return { texto: r.decodedText, formato: r.result?.format?.formatName || '' };
  }
}
