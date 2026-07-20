# Roadmap

## Hecho

- ✅ **Nombres de rutina** — cada sesión se etiqueta (Pecho, Espalda y bíceps, Pierna…) con autocompletado.
- ✅ **Editar sesiones viejas** — historial agrupado por sesión con botón *Editar*.
- ✅ **Marcas a superar** — al cargar rutina anterior, los pesos/reps previos aparecen como placeholder en cada serie.
- ✅ **PRs automáticos** — al guardar se detectan récords de carga máxima por ejercicio, con el antes/después.
- ✅ **Temporizador de descanso** — activable desde la barra superior, presets 1:00–3:00, beep y vibración.
- ✅ **Valores sugeridos** — cada serie nueva hereda peso y reps de la anterior.
- ✅ **PWA** — manifest + service worker con caché offline, instalable y publicada en GitHub Pages.

## Siguiente

- **Plantillas de rutina** — definir rutinas fijas (día A/B/C) independientes de las sesiones.
- **Duplicar sesión** desde el historial con un tap.
- **Notas por ejercicio/sesión** (sensaciones, técnica, dolor).

## Más adelante

- **RPE / RIR** por serie para gestionar intensidad.
- **Gráficos de volumen semanal** por grupo muscular.
- **Calendario/heatmap** de asistencia estilo GitHub.
- **Unidades lb/kg** configurables.
- **Sincronización opcional** (ej. exportar a Google Drive) manteniendo el modo sin cuenta.

## Deuda técnica

- `src/js/app.js` es un único archivo denso. Si sigue creciendo, conviene partirlo en módulos ES
  (`store.js`, `session.js`, `history.js`, `progress.js`, `rest-timer.js`, `backup.js`).
  Requiere `<script type="module">` y un store con estado compartido, porque `sessions` y
  `activeSession` se reasignan.
