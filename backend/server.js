import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';

// ───────────────────────── Configuración ─────────────────────────
const {
  MONGODB_URI,
  DB_NAME = 'asistencia',
  JWT_SECRET,
  ADMIN_PASSWORD,
  ASISTENTE_PASSWORD,
  ALLOWED_ORIGINS = '',
  PORT = 3000,
} = process.env;

for (const [k, v] of Object.entries({ MONGODB_URI, JWT_SECRET, ADMIN_PASSWORD, ASISTENTE_PASSWORD })) {
  if (!v) {
    console.error(`❌ Falta la variable de entorno ${k}`);
    process.exit(1);
  }
}

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db(DB_NAME);
const registros = db.collection('registros');
await registros.createIndex({ cedula: 1 }, { unique: true });
await registros.createIndex({ fechaRegistro: -1 });
console.log(`✅ Conectado a MongoDB (base de datos "${DB_NAME}")`);

const app = express();
app.set('trust proxy', 1); // Render / Vercel están detrás de un proxy
app.use(express.json({ limit: '50kb' }));

const origenes = ALLOWED_ORIGINS.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || origenes.length === 0 || origenes.includes(origin)),
  })
);

// ───────────────────────── Utilidades ─────────────────────────
const CAMPOS = ['cedula', 'nombres', 'apellidos', 'fechaNacimiento', 'sexo', 'tipoCedula', 'telefono', 'correo'];
const CAMPOS_ASISTENTE_EDITAR = ['telefono', 'correo'];

function iguales(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function limpiar(body, permitidos) {
  const out = {};
  for (const k of permitidos) {
    if (body[k] === undefined) continue;
    let v = body[k] === null ? '' : String(body[k]).trim().slice(0, 120);
    if (['nombres', 'apellidos'].includes(k)) v = v.toUpperCase().replace(/\s+/g, ' ');
    if (k === 'cedula') v = v.replace(/\D/g, '').replace(/^0+/, '');
    if (k === 'correo') v = v.toLowerCase();
    if (k === 'telefono') v = v.replace(/[^\d+]/g, '');
    if (k === 'sexo') v = v.toUpperCase();
    out[k] = v;
  }
  return out;
}

function validar(d, esNuevo) {
  const errores = [];
  if (esNuevo || d.cedula !== undefined) {
    if (!/^\d{3,10}$/.test(d.cedula || '')) errores.push('Cédula inválida (solo números, máximo 10 dígitos).');
  }
  if (esNuevo && !d.nombres) errores.push('El nombre es obligatorio.');
  if (d.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.correo)) errores.push('Correo inválido.');
  if (d.telefono) {
    if (!/^\+\d{7,15}$/.test(d.telefono)) errores.push('Teléfono inválido.');
    else if (d.telefono.startsWith('+57') && !/^\+57\d{10}$/.test(d.telefono))
      errores.push('Teléfono de Colombia: deben ser 10 dígitos después de +57.');
  }
  if (d.sexo && !['M', 'F'].includes(d.sexo)) errores.push('Sexo inválido.');
  if (d.tipoCedula && !['amarilla', 'digital', 'manual'].includes(d.tipoCedula)) errores.push('Tipo de cédula inválido.');
  if (d.fechaNacimiento && !/^\d{4}-\d{2}-\d{2}$/.test(d.fechaNacimiento)) errores.push('Fecha de nacimiento inválida.');
  return errores;
}

function auth(...roles) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    try {
      const datos = jwt.verify(token, JWT_SECRET);
      if (!roles.includes(datos.rol)) return res.status(403).json({ error: 'No tienes permiso para esta acción.' });
      req.rol = datos.rol;
      next();
    } catch {
      res.status(401).json({ error: 'Sesión vencida. Vuelve a ingresar.' });
    }
  };
}

const idValido = (req, res, next) =>
  ObjectId.isValid(req.params.id) ? next() : res.status(400).json({ error: 'Id inválido.' });

// Límite simple de intentos de login por IP (10 cada 15 min)
const intentos = new Map();
function limiteLogin(req, res, next) {
  const ahora = Date.now();
  const r = intentos.get(req.ip) || { n: 0, desde: ahora };
  if (ahora - r.desde > 15 * 60 * 1000) Object.assign(r, { n: 0, desde: ahora });
  r.n++;
  intentos.set(req.ip, r);
  if (r.n > 10) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  next();
}

// ───────────────────────── Rutas ─────────────────────────
app.get('/', (_req, res) => res.json({ ok: true, servicio: 'asistencia-api' }));
app.get('/api/salud', (_req, res) => res.json({ ok: true }));

app.post('/api/login', limiteLogin, (req, res) => {
  const { rol, password } = req.body || {};
  const claves = { admin: ADMIN_PASSWORD, asistente: ASISTENTE_PASSWORD };
  if (!claves[rol] || !password || !iguales(password, claves[rol])) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }
  intentos.delete(req.ip);
  const token = jwt.sign({ rol }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, rol });
});

app.get('/api/registros', auth('asistente', 'admin'), async (req, res, next) => {
  try {
    const filtro = {};
    const q = String(req.query.q || '').trim();
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filtro.$or = [{ cedula: rx }, { nombres: rx }, { apellidos: rx }, { correo: rx }, { telefono: rx }];
    }
    const lista = await registros.find(filtro).sort({ fechaRegistro: -1 }).limit(10000).toArray();
    res.json(lista);
  } catch (e) {
    next(e);
  }
});

app.post('/api/registros', auth('asistente', 'admin'), async (req, res, next) => {
  try {
    const d = limpiar(req.body || {}, CAMPOS);
    const errores = validar(d, true);
    if (errores.length) return res.status(400).json({ error: errores.join(' ') });
    const doc = { tipoCedula: 'manual', ...d, fechaRegistro: new Date(), registradoPor: req.rol };
    const r = await registros.insertOne(doc);
    res.status(201).json({ ...doc, _id: r.insertedId });
  } catch (e) {
    if (e.code === 11000) {
      const existente = await registros.findOne({ cedula: limpiar(req.body, ['cedula']).cedula });
      return res.status(409).json({ error: 'Esta cédula ya está registrada.', existente });
    }
    next(e);
  }
});

app.patch('/api/registros/:id', auth('asistente', 'admin'), idValido, async (req, res, next) => {
  try {
    const permitidos = req.rol === 'admin' ? CAMPOS : CAMPOS_ASISTENTE_EDITAR;
    const d = limpiar(req.body || {}, permitidos);
    if (!Object.keys(d).length) return res.status(400).json({ error: 'No hay cambios para guardar.' });
    const errores = validar(d, false);
    if (errores.length) return res.status(400).json({ error: errores.join(' ') });
    const r = await registros.findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...d, actualizado: new Date(), actualizadoPor: req.rol } },
      { returnDocument: 'after' }
    );
    if (!r) return res.status(404).json({ error: 'Registro no encontrado.' });
    res.json(r);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Ya existe otro registro con esa cédula.' });
    next(e);
  }
});

app.delete('/api/registros/:id', auth('admin'), idValido, async (req, res, next) => {
  try {
    const r = await registros.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!r.deletedCount) return res.status(404).json({ error: 'Registro no encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(PORT, () => console.log(`🚀 API escuchando en el puerto ${PORT}`));
