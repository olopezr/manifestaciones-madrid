# ¿Hay manifa hoy en Madrid?

Panel de una sola página que responde si hoy hay alguna manifestación en Madrid. Muestra:

- las convocatorias de hoy, con su hora y su estado (por empezar, en curso o terminada),
- contadores: total registradas, este mes, días desde la última y días hasta la próxima,
- las próximas convocatorias anunciadas,
- el patrón habitual (día, franja horaria y lugar más repetidos),
- el histórico por meses, con filtro.

Fuentes: avisos de desvíos de EMT (Consorcio de Transportes), Delegación del Gobierno y prensa.

## Estructura

```
index.html                  la página (HTML, CSS y JS sin dependencias de build)
data/manifestaciones.json   convocatorias registradas
data/estado.json            fecha de la última comprobación
```

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
