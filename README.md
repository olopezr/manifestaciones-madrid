# ¿Hay manifa hoy en Madrid?

Panel de una sola página que responde si hoy hay alguna manifestación en Madrid. Muestra:

- las convocatorias de hoy, con su hora y su estado (por empezar, en curso o terminada),
- contadores: total registradas, este mes, días desde la última y días hasta la próxima,
- las próximas convocatorias anunciadas,
- el patrón habitual (día, franja horaria y lugar más repetidos),
- el histórico por meses, con filtro.

Fuentes (se consultan automáticamente, ver «Recolector»): avisos de desvíos de EMT (Consorcio de Transportes),
notas del Ayuntamiento de Madrid, buscadores de noticias (Google y Bing), medios locales (eldiario.es, El Mundo, ABC,
Europa Press, 20minutos, El Diario de Madrid, Infobae), sindicatos (UGT) y asociaciones (FRAVM). La Delegación del Gobierno
no publica listado de convocatorias (solo un formulario de comunicación), así que se recoge a través de la prensa.

## Estructura

```
index.html                  la página (HTML, CSS y JS sin dependencias de build)
data/manifestaciones.json   convocatorias registradas
data/estado.json            fecha de la última comprobación
```

## Recolector

`node scripts/collect.js` consulta las fuentes, las fusiona con `data/manifestaciones.json` y anota en `data/estado.json`
cuáles respondieron (`fuentesConsultadas`) y cuáles no (`fuentesSinAcceso`, que la web muestra como aviso). `--dry-run` solo imprime lo que añadiría.

- **Confirmada**: la publica una fuente oficial (aviso EMT/CRTM, Ayuntamiento).
- **Por confirmar**: solo la cita la prensa, un sindicato o una asociación; la fecha y el lugar se deducen del titular.
- Las noticias sin lugar reconocible aparecen como «Madrid (lugar por concretar)». Nunca se borra una convocatoria ya registrada.
- Los horarios de los avisos EMT son los de los desvíos de bus, no necesariamente los de la protesta.
- Ayuntamiento: se lee la página [Incidencias de tráfico debidas a manifestaciones](https://www.madrid.es/portales/munimadrid/es/Inicio/Movilidad-y-transportes/Incidencias-de-Trafico/Principales-incidencias-en-la-ciudad/Incidencias-de-trafico-debidas-a-manifestaciones/?vgnextfmt=default&vgnextoid=6f59adfed8678810VgnVCM1000001d4a900aRCRD&vgnextchannel=cbe0aa2dedcb1610VgnVCM2000001f4a900aRCRD)
  (cada tramo con horario) y el XML de incidencias de [Informo](https://informo.madrid.es/). Si el Ayuntamiento confirma una
  convocatoria ya registrada, sus tramos cortados se añaden al recorrido («Cortes según el Ayuntamiento: …»).
  `madrid.es` devuelve 403 desde Render y otros servidores; la tarea programada de Claude sí la lee (con WebFetch) y su estado llega
  en `MANIFESTACIONES_DATA`. Una fuente que falla aquí pero se consultó en las últimas 24 h (aquí o en esa tarea) no se marca como
  «sin acceso»; el último acceso de cada fuente queda en `ultimoAccesoFuentes`.
- `madrid.es` y varios medios bloquean peticiones automáticas según desde dónde se hagan. Si una fuente devuelve 403 queda
  en `fuentesSinAcceso` en lugar de darse por vacía. Para añadir una fuente, agrega una entrada a `FEEDS` (RSS) o una función en `FUENTES`.
- `.github/workflows/actualizar-datos.yml` lo ejecuta cada 3 horas y commitea `data/` si hay novedades (Render redespliega con el push).
  El build de Render también lo ejecuta, tras volcar `MANIFESTACIONES_DATA`, que ahora se fusiona con los datos del repo en vez de sustituirlos.

## Datos

Cada convocatoria en `data/manifestaciones.json` tiene estos campos:

| Campo | Ejemplo |
|---|---|
| `id` | `2026-10-04-prado` |
| `fecha` | `2026-10-04` (AAAA-MM-DD, hora de Madrid) |
| `hora` / `horaFin` | `11:30` / `15:00`, o `null` si no se ha publicado |
| `lugar`, `recorrido`, `mapa` | `Paseo del Prado`, `Paseo del Prado → Cibeles → Gran Vía` |
| `titulo`, `motivo`, `tipo`, `convocantes`, `asistentes` | texto libre |
| `estado` | `confirmada`, `por-confirmar` o `probable` |
| `fuente`, `fuenteUrl` | origen de la información |

## Uso

La página nació como Artefacto de Claude y, cuando se abre allí, lee la base de datos del artefacto.
Fuera de Claude carga los JSON de `data/`. Para verla en local, sírvela por HTTP (`fetch` no funciona con `file://`):

```sh
python3 -m http.server 8000
# abre http://localhost:8000
```

También funciona tal cual con GitHub Pages (Settings → Pages → rama `main`, carpeta raíz).

## Despliegue en Render y actualización de datos

La web está en Render como sitio estático (https://manifestaciones-madrid.onrender.com):

- Build command: `node scripts/build-data.js`
- Publish directory: `./`

Los datos no se actualizan con commits. Una tarea programada de Claude actualiza cada día la base de datos del artefacto y,
a continuación, copia el contenido en la variable de entorno `MANIFESTACIONES_DATA` del servicio y lanza un deploy.
En el build, `scripts/build-data.js` vuelca la variable en `data/manifestaciones.json` y `data/estado.json`.

`MANIFESTACIONES_DATA` es el JSON `{"manifestaciones": [...], "estado": {...}}` comprimido con gzip y codificado en base64.
Si falta, se publican los JSON del repo. Si no se puede leer, el build falla y Render mantiene la versión anterior.
