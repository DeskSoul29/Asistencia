// URL de tu API (la de Render). Cámbiala después de desplegar el backend.
const API_PRODUCCION = 'https://asistencia-8bdn.onrender.com';

// En tu computador o red local (localhost, 127.0.0.1, 192.168.x.x, 100.x.x.x…)
// se usa la API local en el puerto 3000 del mismo equipo.
const h = location.hostname;
const esLocal = h === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.endsWith('.local');

export const API_URL = esLocal ? `http://${h}:3000` : API_PRODUCCION;
