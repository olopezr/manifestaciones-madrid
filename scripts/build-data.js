// Build de Render: vuelca la variable MANIFESTACIONES_DATA en data/.
// La variable es JSON {manifestaciones:[...], estado:{...}} comprimido con gzip y en base64.
// Sin variable se publican los JSON del repo tal cual. Si la variable no se puede leer,
// el build falla y Render mantiene publicada la versión anterior.
const fs = require('fs');
const { mergeEvents } = require('./merge');
const path = require('path');
const zlib = require('zlib');

const dir = path.join(__dirname, '..', 'data');

// Tras volcar la variable (si existe), el recolector añade lo que publiquen EMT, el Ayuntamiento,
// la prensa, sindicatos y asociaciones. Si falla, el build sigue con los datos que haya.
async function recolectar() {
  try { await require('./collect').main(); }
  catch (e) { console.warn('El recolector falló; se publican los datos sin actualizar:', e.message); }
}

const raw = process.env.MANIFESTACIONES_DATA;
if (!raw) {
  console.log('MANIFESTACIONES_DATA vacía: se parte de los datos del repo.');
  recolectar();
  return;
}

const payload = JSON.parse(zlib.gunzipSync(Buffer.from(raw.trim(), 'base64')).toString('utf8'));
const events = payload.manifestaciones;
if (!Array.isArray(events) || !events.every(e => e && e.fecha && e.lugar)) {
  throw new Error('MANIFESTACIONES_DATA no tiene una lista de convocatorias válida.');
}

// La variable se fusiona con lo que ya hay en el repo (no lo sustituye), para no perder convocatorias
// que el recolector guardó mientras la variable seguía desactualizada.
let delRepo = [];
try { delRepo = JSON.parse(fs.readFileSync(path.join(dir, 'manifestaciones.json'), 'utf8')); } catch (_) {}
const todas = mergeEvents(delRepo.filter(e => e && e.fecha && e.lugar), events).events;
fs.writeFileSync(path.join(dir, 'manifestaciones.json'), JSON.stringify(todas, null, 2));
fs.writeFileSync(path.join(dir, 'estado.json'), JSON.stringify(payload.estado || null, null, 2));
console.log(`Volcadas ${events.length} convocatorias de la variable (${todas.length} en total; última comprobación: ${payload.estado && payload.estado.ultimaComprobacion}).`);
recolectar();
