// Build de Render: vuelca la variable MANIFESTACIONES_DATA en data/.
// La variable es JSON {manifestaciones:[...], estado:{...}} comprimido con gzip y en base64.
// Sin variable se publican los JSON del repo tal cual. Si la variable no se puede leer,
// el build falla y Render mantiene publicada la versión anterior.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const raw = process.env.MANIFESTACIONES_DATA;
if (!raw) {
  console.log('MANIFESTACIONES_DATA vacía: se publican los datos del repo.');
  process.exit(0);
}

const payload = JSON.parse(zlib.gunzipSync(Buffer.from(raw.trim(), 'base64')).toString('utf8'));
const events = payload.manifestaciones;
if (!Array.isArray(events) || !events.every(e => e && e.fecha && e.lugar)) {
  throw new Error('MANIFESTACIONES_DATA no tiene una lista de convocatorias válida.');
}

const dir = path.join(__dirname, '..', 'data');
fs.writeFileSync(path.join(dir, 'manifestaciones.json'), JSON.stringify(events, null, 2));
fs.writeFileSync(path.join(dir, 'estado.json'), JSON.stringify(payload.estado || null, null, 2));
console.log(`Publicadas ${events.length} convocatorias (última comprobación: ${payload.estado && payload.estado.ultimaComprobacion}).`);
