# LOADOUT

Registro de entrenamiento de fuerza, simple y sin cuentas. Una web estática
(HTML + CSS + JavaScript, sin frameworks) que guarda todo en el navegador y
funciona offline como app instalable.

**En vivo:** https://mensetian.github.io/LOADOUT/

## Por qué existe

Progresar en fuerza depende de una pregunta que siempre olvidas entre semana:
*"¿cuánto levanté la última vez?"*. LOADOUT la responde sola. Cada vez que
registras un ejercicio, te muestra tu referencia anterior para que apliques
sobrecarga progresiva sin adivinar ni cargar una libreta.

Decisiones de diseño que marcan el carácter del proyecto:

- **Sin cuentas ni servidor.** Tus datos son tuyos y viven en tu dispositivo.
- **Pensado para el móvil**, que es donde se usa: en el gimnasio, entre series.
- **Cero build.** Se edita, se hace `git push` y está publicado. Sin `npm`.

## Cómo se usa

1. Abres una sesión y eliges un **nombre de rutina** (*Pecho*, *Espalda y bíceps*,
   *Pierna*…). El selector recuerda las que ya usaste, con cuándo fue la última vez.
2. Añades movimientos y anotas peso × reps por serie. Cada serie nueva **hereda**
   los valores de la anterior, así solo cambias lo que cambia.
3. Bajo cada ejercicio ves tu **última referencia**. Si cargas una rutina previa,
   los pesos aparecen como marca a superar.
4. Al finalizar, la sesión entra al historial y se detectan **récords personales**.

## Funcionamiento por sección

### 01 · CAPTURAR
- **Selector de rutina** propio: filtra al escribir y muestra, por cada rutina, hace
  cuánto la hiciste, cuántos movimientos tenía y cuántas veces la repetiste. Sigue
  admitiendo nombres nuevos escritos a mano.
- **Cargar rutina anterior** — precarga los ejercicios de tu última sesión con ese
  nombre, con los pesos/reps previos como referencia.
- **Limpiar** — vacía los movimientos de la sesión en curso.
- **Valores heredados** — cada serie parte de la anterior; empiezas con una y añades.
- **Finalizar sesión** — guarda, o actualiza si estabas editando una sesión vieja.

### Temporizador de descanso
- Botón **⏱** en la barra superior: inicia o detiene un descanso manual.
- Además arranca **solo** al anotar las reps de una serie (90 s; presets 1:00–3:00).
- Al terminar, suena un beep y vibra. Se ancla abajo y reserva espacio para no tapar
  nada.

### 02 · LOG
- Historial **agrupado por sesión**: rutina, fecha y movimientos, con botón **Editar**
  para corregir sesiones viejas, **incluida su fecha**.
- Filtro por texto (rutina o ejercicio) y por período.
- Herramientas de respaldo: **Exportar / Importar** JSON, **Deshacer** y **Google Drive**
  (ver más abajo).

### 03 · MÉTRICAS
- Por ejercicio: última carga, mejor marca y cambio total.
- Gráfico de carga máxima en las últimas 8 sesiones.

## Datos y respaldos

Todo vive en el `localStorage` del navegador. Hay varias capas de protección, de la
más automática a la más segura:

| Capa | Te protege de | No te protege de |
|---|---|---|
| **Almacenamiento persistente** (automático) | Que el navegador borre datos al liberar espacio | Borrado manual · perder el dispositivo |
| **Deshacer** (copias automáticas locales) | Equivocarte al borrar, importar o restaurar | "Borrar datos de navegación" · perder el dispositivo |
| **Exportar JSON** | Todo lo anterior | Que olvides hacerlo |
| **Google Drive** | Todo, incluido perder el teléfono | Propagar un borrado entre dispositivos |

- **Deshacer** revierte la última acción destructiva (borrar sesión, importar,
  restaurar). Guarda las últimas 5; se desactiva cuando no hay nada que revertir.
- La pestaña LOG avisa hace cuánto fue tu último respaldo y lo marca en rojo a los 7 días.
- **Instala la PWA:** Safari borra el almacenamiento de sitios que no abres en ~7 días;
  las apps de la pantalla de inicio quedan fuera de esa regla.

Estructura de una sesión guardada:

```json
{ "id": "…", "date": "2026-07-20", "name": "Pecho",
  "exercises": [ { "name": "Press banca", "sets": [ { "weight": 80, "reps": 8 } ] } ] }
```

> La clave interna sigue siendo `gymlog-sessions-v1` a propósito: renombrarla borraría
> los datos que ya tengas guardados.

### Sincronización con Google Drive (opcional)

Respaldo automático en tu propia cuenta, sin servidor de por medio. Está **desactivado**
hasta que pegues un *Client ID* de Google en `src/js/config.js`. Guía completa, con sus
límites: **[docs/DRIVE.md](docs/DRIVE.md)**.

Al sincronizar, los dos historiales se **fusionan por id de sesión**: nunca se pierde una
sesión, aunque entrenes en el móvil y en el PC. Se sincroniza solo al terminar cada
entrenamiento, o a mano con **Sincronizar**.

Un **chip en el header** muestra el estado (punto verde = sincronizado, rojo = requiere
atención, parpadeo = en curso) y, al tocarlo, fuerza una sincronización. Tras autorizar una
vez, la app **se reconecta sola al abrir**, sin volver a pedir permiso.

## Estructura del proyecto

```
LOADOUT/
├── index.html          ← única página: shell, plantillas y diálogos
├── manifest.json       ← identidad PWA (nombre, icono, colores)
├── sw.js               ← service worker: caché offline
├── .gitignore
├── docs/
│   ├── ROADMAP.md      ← estado y próximos pasos
│   └── DRIVE.md        ← activar la sincronización con Drive
└── src/
    ├── css/styles.css  ← estilos, tema claro/oscuro, responsive
    ├── js/
    │   ├── config.js   ← Client ID de Google (vacío = Drive desactivado)
    │   ├── app.js      ← sesiones, historial, métricas, timer, rutina
    │   ├── backup.js   ← durabilidad local: persistencia, copias, avisos
    │   └── drive.js    ← sincronización opcional con Drive
    └── img/icon.svg    ← icono de la app
```

**Por qué tres archivos viven en la raíz y no en `src/`:**

| Archivo | Motivo |
|---|---|
| `index.html` | GitHub Pages sirve el sitio desde la raíz del repo. |
| `sw.js` | El *scope* de un service worker no puede subir por encima de su carpeta; desde `src/js/` solo cachearía `src/js/**` y se perdería el modo offline. |
| `manifest.json` | `start_url` y `scope` se resuelven relativos al manifest; en la raíz apuntan a la app sin rutas `../` frágiles. |

## Desarrollo

No hay dependencias ni compilación. Para probar en local hace falta servir por HTTP
(el service worker no arranca desde `file://`):

```bash
python -m http.server 8000    # o: npx serve .
```

Y abrir http://localhost:8000.

### Publicar

```bash
git add -A
git commit -m "mensaje"
git push origin master
```

GitHub Pages actualiza el sitio en ~1 minuto. Al cambiar archivos de `src/`, sube el
número de `CACHE` en [sw.js](sw.js) para que los dispositivos descarten la versión
cacheada; en el móvil, cierra y reabre la app para recibirla.

## Roadmap

Estado y próximos pasos: **[docs/ROADMAP.md](docs/ROADMAP.md)**.
