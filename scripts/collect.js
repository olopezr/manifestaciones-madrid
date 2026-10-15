// Recolector de convocatorias: consulta varias fuentes, las fusiona con data/manifestaciones.json
// y anota en data/estado.json qué fuentes se consultaron y cuáles no respondieron.
//
//   node scripts/collect.js            escribe los JSON de data/
//   node scripts/collect.js --dry-run  solo muestra lo que añadiría
//
// Sin dependencias (Node 18+). Una fuente caída nunca tumba el proceso: se anota en `fuentesSinAcceso`.
const fs = require('fs');
const path = require('path');
const { mergeEvents, zonasDe, norm, slug } = require('./merge');

const DIR = path.join(__dirname, '..', 'data');
const TZ = 'Europe/Madrid';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DIAS_VISTA = 45;          // hasta cuántos días por delante se registran convocatorias
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

// ---------- utilidades ----------
const ymd = d => d.toLocaleDateString('en-CA', { timeZone: TZ });
const sumaDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaSemana = f => new Date(f + 'T12:00:00Z').getUTCDay();
const hh = (h, m) => `${String(h).padStart(2, '0')}:${m}`;
const decode = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const plano = s => decode(decode(s)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function get(url, ms = 25000) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'es-ES,es;q=0.9' }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const LUGARES = {
  sol: 'Puerta del Sol', cibeles: 'Cibeles', atocha: 'Atocha', prado: 'Paseo del Prado', colon: 'Colón', recoletos: 'Recoletos',
  alcala: 'Calle Alcalá', granvia: 'Gran Vía', castellana: 'Castellana', callao: 'Callao', neptuno: 'Neptuno', congreso: 'Congreso',
  espana: 'Plaza de España', nuevosmin: 'Nuevos Ministerios', ferraz: 'Ferraz', ocana: 'Calle Ocaña', moncloa: 'Moncloa',
  vallecas: 'Vallecas', ruben: 'Castellana con Rubén Darío', agricultura: 'Ministerio de Agricultura',
};

// ---------- fuente 1: avisos EMT del Consorcio de Transportes ----------
const PROTESTA = /manifestaci|concentraci|marcha|protesta|huelga|cortejo|movilizaci/;

async function fuenteCRTM(hoy) {
  const base = 'https://www.crtm.es';
  const lista = await get(base + '/avisos');
  const links = new Map();
  for (const m of lista.matchAll(/href="(\/comunicacion\/actualidad-del-servicio\/avisos\/avisos-emt\/(\d{2})_(\d{2})_(\d{4})-[^"]+)"/g)) {
    const href = decode(m[1]);
    if (PROTESTA.test(norm(href))) links.set(href, `${m[4]}-${m[3]}-${m[2]}`);
  }
  const out = [];
  for (const [href, fechaUrl] of links) {
    const url = base + encodeURI(href).replace(/%25/g, '%');
    let html;
    try { html = await get(url); } catch { html = ''; }
    const lineas = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n'))
      .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const iTit = lineas.map(l => /^Desv[ií]o l[ií]neas/i.test(l)).lastIndexOf(true);
    const titulo = iTit >= 0 ? lineas[iTit] : '';
    const fin = lineas.findIndex((l, i) => i > iTit && /^Vo?ver a/i.test(l));
    const texto = iTit >= 0 ? lineas.slice(iTit + 1, fin > 0 ? fin : iTit + 6).filter(l => !/^-->/.test(l)).join(' ') : '';
    const t = titulo.match(/^Desv[ií]o l[ií]neas\s+(?:EMT\s+)?(Manifestaci[oó]n|Concentraci[oó]n|Marcha|Protesta|Huelga|Movilizaci[oó]n)\s*(.*)$/i);
    if (!t) continue;
    const tipo = t[1][0].toUpperCase() + t[1].slice(1).toLowerCase();
    const sitio = t[2].replace(/\bp\.º/gi, 'Paseo').replace(/\bc\//gi, 'Calle ').replace(/\bpza\./gi, 'Plaza').replace(/\bavda\./gi, 'Avenida').replace(/\s+/g, ' ').trim();
    const tramos = sitio.split(/\s+-\s+/).map(s => s.trim()).filter(Boolean);
    const lugar = tramos[0] || 'Madrid';
    const recorrido = tramos.length > 1 ? tramos.join(' → ') : null;

    // Fechas: las que cite el texto («jueves 15 de octubre»); si no, la del aviso.
    const anio = +fechaUrl.slice(0, 4);
    const fechas = new Set();
    for (const m of norm(texto).matchAll(/(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/g)) {
      let f = `${anio}-${String(MESES.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      if (f < sumaDias(fechaUrl, -2)) f = `${anio + 1}${f.slice(4)}`;
      fechas.add(f);
    }
    if (!fechas.size) fechas.add(fechaUrl);
    const h = horas(texto);
    const lineasBus = ((texto.match(/las l[ií]neas\s+(.*?)\s+(?:sufrir|tendr)/i) || [])[1] || '').replace(/[,\s]+$/, '');
    const motivo = `Desvíos de EMT${h.hora ? ` (${h.hora}${h.horaFin ? '–' + h.horaFin : ''})` : ''}${lineasBus ? ': líneas ' + lineasBus : ''}`;
    for (const fecha of fechas) {
      if (fecha < hoy || fecha > sumaDias(hoy, DIAS_VISTA)) continue;
      out.push({
        fecha, hora: h.hora, horaFin: h.horaFin, lugar, recorrido, tipo,
        titulo: `${tipo} ${sitio}`.trim(), motivo, convocantes: null, estado: 'confirmada',
        fuente: 'Aviso EMT (CRTM)', fuenteUrl: url,
      });
    }
  }
  return out;
}

function horas(txt) {
  const t = norm(txt);
  let m = t.match(/de (\d{1,2})[:.](\d{2}) a (\d{1,2})[:.](\d{2})/);
  if (m) return { hora: hh(m[1], m[2]), horaFin: hh(m[3], m[4]) };
  m = t.match(/de (\d{1,2}) a (\d{1,2}) horas/);
  if (m) return { hora: hh(m[1], '00'), horaFin: hh(m[2], '00') };
  m = t.match(/(?:a las|desde las|hacia las|sobre las) (\d{1,2})(?:[:.](\d{2}))?\s*(?:h\b|horas)?/);
  if (m) return { hora: hh(m[1], m[2] || '00'), horaFin: null };
  return { hora: null, horaFin: null };
}

// ---------- fuente 2: Ayuntamiento de Madrid (notas de prensa sobre afecciones al tráfico) ----------
// madrid.es y diario.madrid.es filtran el tráfico automático desde algunos servidores: si
// responden 403 la fuente se marca como no consultada, no se da por vacía.
async function fuenteAyuntamiento(hoy) {
  const xml = await get('https://diario.madrid.es/blog/notas-de-prensa/feed/');
  return items(xml).filter(i => /afecciones? al tr[aá]fico|cortes? de tr[aá]fico|manifestaci|concentraci|marcha/i.test(i.titulo + ' ' + i.desc))
    .flatMap(i => aEventos(i, hoy, { fuente: 'Ayuntamiento de Madrid', estado: 'confirmada', exigirPalabra: false }));
}

// ---------- fuente 3: medios, sindicatos y asociaciones (RSS) ----------
function items(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const g = t => { const r = m[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return r ? plano(r[1]) : ''; };
    const origen = m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/);
    return { titulo: g('title'), desc: g('description'), link: g('link') || g('guid'), fecha: g('pubDate'), origen: origen ? plano(origen[1]) : '' };
  });
}

const gn = q => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=es&gl=ES&ceid=ES:es`;
const bing = q => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=es`;
const CONSULTAS = [
  'manifestación Madrid when:7d', 'concentración Madrid convocatoria when:7d', 'cortes de tráfico manifestación Madrid when:7d',
  'Delegación del Gobierno Madrid manifestación comunicada when:7d', 'CCOO UGT Madrid convocan concentración when:7d',
  'sindicato convoca manifestación Madrid when:7d', 'huelga Madrid manifestación centro when:7d', 'marcha Madrid Cibeles Sol Atocha when:7d',
];
const FEEDS = [
  { nombre: 'Europa Press Madrid', url: 'https://www.europapress.es/rss/rss.aspx?ch=69', madrid: true },
  { nombre: 'El Diario de Madrid', url: 'https://www.eldiariodemadrid.es/rss', madrid: true },
  { nombre: '20minutos Madrid', url: 'https://www.20minutos.es/rss/madrid/', madrid: true },
  { nombre: 'eldiario.es Madrid', url: 'https://www.eldiario.es/rss/madrid/', madrid: true },
  { nombre: 'ABC Madrid', url: 'https://www.abc.es/rss/2.0/espana/madrid/', madrid: true },
  { nombre: 'El Mundo Madrid', url: 'https://e00-elmundo.uecdn.es/elmundo/rss/madrid.xml', madrid: true },
  { nombre: 'Infobae España', url: 'https://www.infobae.com/arc/outboundfeeds/rss/category/espana/', madrid: false },
  { nombre: 'UGT', url: 'https://www.ugt.es/rss.xml', madrid: false, sindicato: true },
  { nombre: 'FRAVM (asociaciones vecinales)', url: 'https://fravm.org/feed/', madrid: true, sindicato: true },
];
const RUIDO = /real madrid|atl[eé]tico de madrid|champions|baloncesto|concierto|marat[oó]n|f[uú]tbol|partido|orgullo|cabalgata|madrid fusi[oó]n/;
const OTRAS_CIUDADES = /barcelona|valencia|sevilla|bilbao|zaragoza|m[aá]laga|galicia|ceuta|canarias|murcia|valladolid/;

// El titular debe hablar de una protesta (en el cuerpo, «convoca» o «cortes de tráfico» dan demasiados falsos positivos)
const PALABRA = /manifestaci|concentraci|(?<!en )(?<!puesta en )\bmarcha\b|protesta|huelga|tractorada|movilizaci/;

function fechaDe(txt, pub) {
  const t = norm(txt), p = pub;
  let m = t.match(/(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?: de (\d{4}))?/);
  if (m) {
    let y = m[3] ? +m[3] : +p.slice(0, 4);
    let f = `${y}-${String(MESES.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!m[3] && f < sumaDias(p, -30)) f = `${y + 1}${f.slice(4)}`;
    return f;
  }
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] <= 31) return `${m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : p.slice(0, 4)}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/\bpasado manana\b/.test(t)) return sumaDias(p, 2);
  if (/\bmanana\b/.test(t)) return sumaDias(p, 1);
  m = t.match(/\b(?:este |el |proximo |el proximo )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (m) { let d = (SEMANA.indexOf(m[1]) - diaSemana(p) + 7) % 7; return sumaDias(p, d); }
  if (/\bhoy\b/.test(t)) return p;
  return null;
}

function aEventos(it, hoy, { fuente, estado = 'por-confirmar', exigirPalabra = true, soloMadrid = false, madridFeed = true }) {
  const txt = `${it.titulo}. ${it.desc}`;
  const n = norm(txt);
  if (exigirPalabra && !PALABRA.test(norm(it.titulo))) return [];
  if (RUIDO.test(n)) return [];
  if ((soloMadrid || !madridFeed) && !/madrid/.test(n)) return [];
  if (OTRAS_CIUDADES.test(n) && !/madrid/.test(n.replace(/en madrid|de madrid/, '')) && !/madrid/.test(norm(it.titulo))) return [];
  const pubD = it.fecha ? new Date(it.fecha) : new Date();
  const pub = isNaN(pubD) ? hoy : ymd(pubD);
  const fecha = fechaDe(it.titulo, pub) || fechaDe(it.desc, pub);
  if (!fecha || fecha < hoy || fecha > sumaDias(hoy, DIAS_VISTA)) return [];
  const zonas = zonasDe(txt);
  // Sin lugar reconocible solo se acepta si el titular habla claramente de una convocatoria
  if (!zonas.length && !/manifestaci|concentraci|marcha\b|tractorada/.test(norm(it.titulo))) return [];
  const lugar = zonas.length ? LUGARES[zonas[0]] : 'Madrid (lugar por concretar)';
  const recorrido = zonas.length > 1 ? zonas.slice(0, 4).map(z => LUGARES[z]).join(' → ') : null;
  const h = horas(txt);
  const titulo = it.titulo.replace(/\s+[-–|]\s+[^-–|]{2,40}$/, '').slice(0, 140);
  const tipo = /manifestaci/.test(n) ? 'Manifestación' : /concentraci/.test(n) ? 'Concentración' : /huelga/.test(n) ? 'Huelga / movilización' : 'Convocatoria';
  return [{
    fecha, hora: h.hora, horaFin: h.horaFin, lugar, recorrido, tipo, titulo, motivo: null, convocantes: null, estado,
    fuente: it.origen || fuente, fuenteUrl: it.link || null,
  }];
}

async function fuenteBuscador(hoy, construir, etiqueta) {
  const out = []; let ok = 0, ult;
  for (const q of CONSULTAS) {
    try { out.push(...items(await get(construir(q))).flatMap(i => aEventos(i, hoy, { fuente: etiqueta, soloMadrid: true }))); ok++; }
    catch (e) { ult = e; }
  }
  if (!ok) throw ult || new Error('sin respuesta');
  return out;
}

const fuenteFeed = f => async hoy => items(await get(f.url))
  .flatMap(i => aEventos(i, hoy, { fuente: f.nombre, madridFeed: f.madrid, soloMadrid: !f.madrid }))
  .map(e => ({ ...e, fuente: f.sindicato ? f.nombre : e.fuente }));

const FUENTES = [
  { nombre: 'Avisos EMT (CRTM)', run: fuenteCRTM },
  { nombre: 'Ayuntamiento de Madrid', run: fuenteAyuntamiento },
  { nombre: 'Google Noticias', run: h => fuenteBuscador(h, gn, 'Google Noticias') },
  { nombre: 'Bing Noticias', run: h => fuenteBuscador(h, bing, 'Bing Noticias') },
  ...FEEDS.map(f => ({ nombre: f.nombre, run: fuenteFeed(f) })),
];
// La Delegación del Gobierno solo publica un formulario de comunicación, sin listado de convocatorias:
// se recoge a través de la prensa («Delegación del Gobierno ha comunicado…») y de las consultas de arriba.

// ---------- ejecución ----------
async function main() {
  const dry = process.argv.includes('--dry-run');
  const hoy = ymd(new Date());
  const leer = f => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
  const existentes = (leer('manifestaciones.json') || []).filter(e => e && e.fecha && e.lugar);

  const resultados = await Promise.all(FUENTES.map(async f => {
    try { const ev = await f.run(hoy); return { nombre: f.nombre, ok: true, ev }; }
    catch (e) { return { nombre: f.nombre, ok: false, error: String(e.message || e) }; }
  }));

  // Las fuentes oficiales se fusionan primero: así la prensa se adjunta como «otra fuente» y no al revés.
  const orden = r => /CRTM|Ayuntamiento/.test(r.nombre) ? 0 : 1;
  let events = existentes, añadidas = 0, fusionadas = 0;
  for (const r of resultados.filter(r => r.ok).sort((a, b) => orden(a) - orden(b))) {
    const m = mergeEvents(events, r.ev);
    events = m.events; añadidas += m.added; fusionadas += m.merged; r.añadidas = m.added;
  }

  for (const r of resultados) console.log(`${r.ok ? 'OK ' : 'ERR'} ${r.nombre.padEnd(34)} ${r.ok ? r.ev.length + ' candidatas, ' + r.añadidas + ' nuevas' : r.error}`);
  console.log(`Total: ${existentes.length} → ${events.length} (+${añadidas} nuevas, ${fusionadas} ya conocidas)`);
  if (dry) {
    events.filter(e => !existentes.some(x => x.id === e.id)).forEach(e => console.log(' +', e.fecha, e.hora || '--:--', e.lugar, '|', e.estado, '|', e.fuente, '|', e.titulo.slice(0, 90)));
    return;
  }

  // Si ninguna fuente respondió no se toca nada: mejor datos viejos y con aviso que un panel vacío.
  const consultadas = resultados.filter(r => r.ok).map(r => r.nombre);
  if (!consultadas.length) { console.error('Ninguna fuente respondió; se mantienen los datos actuales.'); process.exitCode = 1; return; }
  const previo = leer('estado.json') || {};
  const estado = {
    ...previo,
    ultimaComprobacion: new Date().toISOString(),
    fuentesConsultadas: consultadas,
    fuentesSinAcceso: resultados.filter(r => !r.ok).map(r => r.nombre),
    nota: `${consultadas.length} de ${resultados.length} fuentes consultadas`,
  };
  fs.writeFileSync(path.join(DIR, 'manifestaciones.json'), JSON.stringify(events, null, 2) + '\n');
  fs.writeFileSync(path.join(DIR, 'estado.json'), JSON.stringify(estado, null, 2) + '\n');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { aEventos, fechaDe, horas, main };
