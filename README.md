# Asistencia con cédulas colombianas

- `docs/` → páginas web (GitHub Pages): `asistente.html` y `admin.html`
- `backend/` → API Node/Express que habla con MongoDB Atlas (se despliega en Render)

```
GitHub Pages (docs/)  ──►  API en Render (backend/)  ──►  MongoDB Atlas (cluster "asistencia")
```

La cadena de conexión a MongoDB **solo vive en Render**. Nunca va en `docs/`.

---

## 1. MongoDB Atlas

1. **Database Access → Add New Database User**
   - Usuario: `app_asistencia`, contraseña generada (guárdala)
   - Rol: *Built-in Role → Read and write to any database*
   (Usa este usuario en la app, no el `jcesargomez_db_user` que es Atlas Admin.)
2. **Network Access → Add IP Address → Allow access from anywhere (`0.0.0.0/0`)**
   (Render no tiene IP fija. Deja también tu IP para pruebas locales.)
3. Tu cadena queda así:
   ```
   mongodb+srv://app_asistencia:CONTRASEÑA@asistencia.sfbizfu.mongodb.net/?retryWrites=true&w=majority&appName=asistencia
   ```
   La base `asistencia` y la colección `registros` (con índice único por cédula) se crean solas al arrancar la API.

## 2. Probar en tu computador (opcional)

```bash
cd backend
cp .env.example .env      # y llena los valores
npm install
npm run dev               # API en http://localhost:3000
```
En otra terminal: `cd docs && npx serve -l 5500` y abre http://localhost:5500/asistente.html
(La cámara solo funciona en `localhost` o `https`.)

## 3. Subir a GitHub

```bash
git init && git add . && git commit -m "App de asistencia"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/asistencia.git
git push -u origin main
```
Verifica que **no** se subió ningún `.env` (el `.gitignore` lo evita).

## 4. Backend en Render (gratis)

1. https://render.com → *New → Web Service* → conecta el repo.
2. **Root Directory:** `backend` · **Build:** `npm install` · **Start:** `npm start` · Plan *Free*.
3. *Environment* → agrega: `MONGODB_URI`, `DB_NAME=asistencia`, `JWT_SECRET`, `ADMIN_PASSWORD`,
   `ASISTENTE_PASSWORD`, `ALLOWED_ORIGINS=https://TU-USUARIO.github.io`
4. Cuando termine, copia la URL (ej. `https://asistencia-api.onrender.com`) y ábrela: debe responder `{"ok":true,...}`.

> En el plan gratis, Render "duerme" la API tras ~15 min sin uso; la primera petición tarda ~1 min en despertar.

## 5. Frontend en GitHub Pages

1. Edita `docs/js/config.js` y pon tu URL de Render en `API_PRODUCCION`. Haz commit y push.
2. En GitHub: *Settings → Pages → Source: Deploy from a branch → Branch `main` / carpeta `/docs`*.
3. Quedan:
   - `https://TU-USUARIO.github.io/asistencia/asistente.html`
   - `https://TU-USUARIO.github.io/asistencia/admin.html`

## Qué puede hacer cada rol

| | Asistente | Admin |
|---|---|---|
| Escanear / escribir cédula y registrar | ✅ | — |
| Ver listado y buscar | ✅ | ✅ |
| Exportar Excel / CSV | ✅ | ✅ |
| Agregar teléfono (+57 por defecto) y correo | ✅ | ✅ |
| Editar cualquier dato | — | ✅ |
| Eliminar | — | ✅ |

Los permisos se validan en la API, no solo en la página.

## Lectura de cédulas

- **Amarilla (hologramas):** código PDF417 del reverso → número, apellidos, nombres, sexo, fecha de nacimiento y RH.
- **Digital (2020+):** QR, o las 3 líneas MRZ (`<<<`) pegadas / leídas con lector → número, nombres, sexo y fecha.
- Tres formas de leer: cámara del celular, foto, o lector físico de códigos (pistola USB/Bluetooth).
- Si un código no se reconoce, la página lo deja escribir a mano; la lectura cruda queda en la consola del navegador (F12) para ajustar el lector.
