# Plan: LOADOUT → Play Store (gratis + donaciones)

Meta final: app publicada en Google Play, gratuita, con donaciones opcionales,
divulgada en redes. Sin servidor propio, sin suscripciones, sin costos fijos
(salvo los 25 USD únicos de la cuenta de Google Play).

## Fase 1 — Lista para usuarios reales ✅ COMPLETADA

El orden importaba: publicar antes de esto quemaba la única "primera impresión".

1. ✅ **Plantillas de rutina (día A/B/C)** — planes fijos independientes del
   historial. Sección propia en el selector de rutina, *Guardar plantilla* en la
   sesión, gestión en Ajustes; viajan en respaldos y se fusionan por id en Drive.
2. ✅ **Onboarding en frío** — la pantalla vacía enseña los tres pasos y ofrece
   una rutina de ejemplo cargable de un tap (solo hasta que hay algo guardado).
3. ✅ **Unidades kg/lb** en Ajustes. El historial se guarda **siempre en kilos**;
   la unidad solo afecta a lo que se muestra y se teclea, así que cambiarla no
   reescribe ni falsea nada de lo ya registrado.
4. ✅ **Client ID de Drive incluido** — ya estaba puesto en `src/js/config.js`.
5. ✅ **Tests de lo que destruye confianza** — `tests/index.html`, sin framework
   ni build: fusión de Drive por id, fusión de plantillas, detección de récords,
   conversión de unidades y ciclo exportar → importar.

Criterio de salida: una persona ajena instala la PWA, entrena una semana y no
necesita preguntarte nada.

**Pendiente antes de la Fase 2:** probar la app a mano en un móvil real (cargar
una plantilla, entrenar, cambiar a lb, sincronizar) — los tests cubren la lógica,
no la interfaz.

## Fase 2 — Empaquetar para Play Store (TWA)

La vía correcta para una PWA es **Trusted Web Activity** con
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap): la app de Play es
un contenedor que abre tu PWA de GitHub Pages a pantalla completa. Cero
reescritura, y cada `git push` actualiza también la app instalada.

1. Cuenta de desarrollador de Google Play (**25 USD, pago único**).
2. `bubblewrap init` sobre el manifest → genera el proyecto Android y el `.aab`.
3. **Digital Asset Links**: publicar `.well-known/assetlinks.json` en el sitio
   para que la app abra sin barra de navegador.
4. Requisitos de ficha: icono 512px, feature graphic 1024×500, 4-8 capturas de
   móvil, política de privacidad (una página estática: "todo se guarda en tu
   dispositivo; Drive es opcional y va a tu propia cuenta" — es tu mejor
   argumento de venta además de requisito).
5. Prueba cerrada (Google exige ~12 testers / 14 días para cuentas nuevas de
   desarrollador individual) → producción.

## Fase 3 — Donaciones

- **Ko-fi o GitHub Sponsors** + botón discreto en Ajustes ("¿Te sirve LOADOUT?
  Invítame un café").
- ⚠️ **Matiz de política de Play**: las donaciones dentro de la app para
  desarrolladores (no ONGs) están en zona gris con el sistema de facturación de
  Google. La práctica segura: el botón **abre el navegador externo** hacia
  Ko-fi, sin flujo de pago embebido en la app. Así lo hacen la mayoría de apps
  open source y pasa revisión.
- En la web/PWA (fuera de Play) no hay restricción alguna: link directo.

## Fase 4 — Divulgación

El ángulo que te diferencia: **"tracker de gym local-first: sin cuenta, sin
suscripción, tus datos son tuyos, funciona offline"**. Ese mensaje tiene
audiencia probada en:

1. **Reddit**: r/selfhosted, r/privacy, r/degoogle, r/fitness (leer reglas de
   autopromoción de cada sub; formato "hice esto porque odiaba X" funciona mejor
   que "mirad mi app").
2. **Hacker News**: Show HN una sola vez, con el README en inglés.
3. **Product Hunt**: un launch preparado (capturas, GIF del flujo de una sesión).
4. **TikTok/Instagram/X**: clips de 20-30 s del flujo real en el gimnasio
   ("cuánto levanté la última vez → lo supero → PR detectado"). Constancia >
   producción: 1-2 por semana.
5. **README bilingüe** (español/inglés) — la audiencia grande de los canales 2-3
   es anglófona y la app ya tiene i18n.

Métrica honesta de éxito el primer año: usuarios activos y estrellas en GitHub,
no dinero. Las donaciones siguen a la tracción, nunca al revés.

## Fase 5 — Después del launch

- Responder reseñas de Play y issues de GitHub (es marketing gratis).
- Heatmap de asistencia y volumen semanal (retención emocional).
- RPE/RIR opcional por serie.
- Partir `app.js` en módulos solo cuando duela de verdad.

## Qué NO hacer

- Suscripciones, backend propio, compras in-app: rompen la promesa "local-first"
  y añaden costos/soporte que hoy no puedes absorber.
- Anuncios: matan la propuesta de valor y pagan centavos a este volumen.
- Reescribir en un framework: el "cero build" es una ventaja, no una carencia.
