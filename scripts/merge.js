// Fusión de convocatorias: evita duplicados entre fuentes y nunca borra lo ya registrado.
const OFICIAL = /CRTM|EMT|Ayuntamiento|Delegaci[oó]n/i;

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const mins = h => (h && /^\d{1,2}:\d{2}$/.test(h)) ? +h.split(':')[0] * 60 + +h.split(':')[1] : null;

// Lugares reconocibles del centro (clave canónica → expresión). Sirven para detectar
// que dos fuentes hablan de la misma convocatoria aunque la escriban distinto.
const ZONAS = {
  sol: /puerta del sol|\bsol\b/, cibeles: /cibeles/, atocha: /atocha/, prado: /prado/, colon: /\bcolon\b/,
  recoletos: /recoletos/, alcala: /alcala/, granvia: /gran via/, castellana: /castellana/, callao: /callao/,
  neptuno: /neptuno/, congreso: /congreso|carrera de san jeronimo/, espana: /plaza de espana|pza\.? de espana/,
  nuevosmin: /nuevos ministerios/, ferraz: /ferraz/, ocana: /ocana/, moncloa: /moncloa/, vallecas: /vallecas/,
  ruben: /ruben dario/, agricultura: /ministerio de agricultura|infanta isabel/,
};
// Zonas que aparecen en el texto, en el orden en que se citan
const zonasDe = txt => {
  const t = norm(txt);
  return Object.keys(ZONAS).map(k => [k, t.search(ZONAS[k])]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([k]) => k);
};

function mismaConvocatoria(a, b) {
  if (a.fecha !== b.fecha) return false;
  const ma = mins(a.hora), mb = mins(b.hora);
  if (ma != null && mb != null && Math.abs(ma - mb) > 90) return false;
  const za = zonasDe(a.lugar + ' ' + (a.recorrido || '')), zb = zonasDe(b.lugar + ' ' + (b.recorrido || ''));
  if (za.length && zb.length) return za.some(z => zb.includes(z));
  // Dos convocatorias sin lugar reconocible el mismo día son, casi seguro, la misma noticia repetida por varios medios
  if (!za.length && !zb.length) return true;
  // Si solo una tiene lugar, solo se funden con la misma hora exacta
  return ma != null && ma === mb;
}

const mismaHora = (a, b) => { const x = mins(a.hora), y = mins(b.hora); return x == null || y == null || Math.abs(x - y) <= 90; };

function esOficial(ev) { return OFICIAL.test(ev.fuente || ''); }

function adjuntar(base, nuevo) {
  if (nuevo.fuenteUrl && nuevo.fuenteUrl !== base.fuenteUrl) {
    const otras = Array.isArray(base.otrasFuentes) ? base.otrasFuentes : [];
    // Un enlace por medio: dos noticias del mismo periódico no aportan una fuente más
    if (nuevo.fuente !== base.fuente && !otras.some(f => f.url === nuevo.fuenteUrl || f.fuente === nuevo.fuente)) otras.push({ fuente: nuevo.fuente, url: nuevo.fuenteUrl });
    base.otrasFuentes = otras;
  }
  if (!base.hora && nuevo.hora) { base.hora = nuevo.hora; if (nuevo.horaFin) base.horaFin = nuevo.horaFin; }
  else if (base.hora && !base.horaFin && nuevo.hora === base.hora && nuevo.horaFin) base.horaFin = nuevo.horaFin;
  // Una fuente oficial confirma; una convocatoria de prensa por sí sola queda «por confirmar»
  if (base.estado !== 'confirmada' && (esOficial(nuevo) || base.estado === 'por-confirmar' && nuevo.estado === 'confirmada')) base.estado = 'confirmada';
  if ((!base.recorrido || base.recorrido.length < 4) && nuevo.recorrido) base.recorrido = nuevo.recorrido;
  else if (/Ayuntamiento/.test(nuevo.fuente || '') && nuevo.recorrido && !(base.recorrido || '').includes(nuevo.recorrido)) {
    // Los tramos cortados que publica el Ayuntamiento se muestran aunque ya hubiera recorrido de otra fuente
    const yaCubiertas = zonasDe(base.lugar + ' ' + (base.recorrido || ''));
    if (zonasDe(nuevo.recorrido).some(z => !yaCubiertas.includes(z))) base.recorrido = `${base.recorrido} · Cortes según el Ayuntamiento: ${nuevo.recorrido}`;
  }
  if (!base.convocantes && nuevo.convocantes) base.convocantes = nuevo.convocantes;
  return base;
}

function mergeEvents(existing, incoming) {
  const out = existing.map(e => ({ ...e }));
  let added = 0, merged = 0;
  for (const n of incoming) {
    const byId = out.find(e => e.id && e.id === n.id);
    let match = byId || out.find(e => mismaConvocatoria(e, n));
    if (!match && !zonasDe(n.lugar + ' ' + (n.recorrido || '')).length) {
      // Noticia sin lugar: se une a la convocatoria del día si no hay duda de a cuál se refiere
      const dia = out.filter(e => e.fecha === n.fecha && mismaHora(e, n));
      if (dia.length === 1) match = dia[0];
    }
    if (match) { adjuntar(match, n); merged++; continue; }
    let id = n.id || `${n.fecha}-${slug(n.lugar)}`, k = 2;
    while (out.some(e => e.id === id)) id = `${n.id || n.fecha + '-' + slug(n.lugar)}-${k++}`;
    out.push({ ...n, id }); added++;
  }
  out.sort((a, b) => a.fecha.localeCompare(b.fecha) || (mins(a.hora) ?? 9999) - (mins(b.hora) ?? 9999));
  return { events: out, added, merged };
}

module.exports = { mergeEvents, zonasDe, norm, slug, mins };
