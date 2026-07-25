# Roadmap

> Meta de publicación (Play Store, donaciones, divulgación): **[PLAN.md](PLAN.md)**.

## Hecho

- ✅ **Nombres de rutina** — cada sesión se etiqueta (Pecho, Espalda y bíceps, Pierna…) con autocompletado.
- ✅ **Editar sesiones viejas** — historial agrupado por sesión con botón *Editar*.
- ✅ **Marcas a superar** — al cargar rutina anterior, los pesos/reps previos aparecen como placeholder en cada serie.
- ✅ **PRs automáticos** — al guardar se detectan récords de carga máxima por ejercicio, con el antes/después.
- ✅ **Temporizador de descanso** — activable desde la barra superior, presets 1:00–3:00, beep y vibración.
- ✅ **Valores sugeridos** — cada serie nueva hereda peso y reps de la anterior.
- ✅ **PWA** — manifest + service worker con caché offline, instalable y publicada en GitHub Pages.
- ✅ **Respaldo en capas** — almacenamiento persistente, copias locales (Deshacer) y aviso de antigüedad.
- ✅ **Sincronización con Google Drive** — opcional, sin cuenta propia, con fusión por id de sesión.

- ✅ **Plantillas de rutina** — planes fijos (día A/B/C) independientes del historial, con sección propia
  en el selector de rutina y gestión en Ajustes. Viajan en respaldos y se fusionan por id en Drive.
- ✅ **Unidades kg/lb** — el historial se guarda siempre en kilos; la unidad solo afecta a lo que se ve.
- ✅ **Onboarding del primer uso** — los tres pasos y una rutina de ejemplo cargable de un tap.
- ✅ **Tests** — `tests/index.html`, sin framework ni build.

## Siguiente

- **Duplicar sesión** desde el historial con un tap.
- **Notas por ejercicio/sesión** (sensaciones, técnica, dolor).
- **Calendario/heatmap** de asistencia estilo GitHub.

## Más adelante

- **RPE / RIR** por serie para gestionar intensidad.
- **Gráficos de volumen semanal** por grupo muscular.

## Deuda técnica

- `src/js/app.js` es un único archivo denso. Si sigue creciendo, conviene partirlo en módulos ES
  (`store.js`, `session.js`, `history.js`, `progress.js`, `rest-timer.js`, `backup.js`).
  Requiere `<script type="module">` y un store con estado compartido, porque `sessions` y
  `activeSession` se reasignan.
