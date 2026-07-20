# LOADOUT

Registro de entrenamiento de fuerza, simple y sin cuentas. Aplicación web estática (HTML + CSS + JS puro) que guarda todo en el navegador (`localStorage`).

> **Nombre:** el proyecto se unifica bajo **LOADOUT**. La clave interna de almacenamiento sigue siendo `gymlog-sessions-v1` a propósito, para no perder los datos ya guardados en tu navegador.

## Objetivo

Que cada vez que entrenes tengas **a mano tu última referencia** (peso × reps de la sesión anterior) para aplicar sobrecarga progresiva de forma precisa, sin depender de la memoria ni de una libreta.

## Función principal

1. Abres una sesión y le das un **nombre de rutina** (ej. *Pecho*, *Espalda y bíceps*, *Pierna*).
2. Añades movimientos — con autocompletado de ejercicios que ya registraste — y anotas peso y repeticiones por set.
3. Bajo cada ejercicio aparece tu **última referencia**: fecha y sets de la vez anterior que lo hiciste.
4. Al finalizar, la sesión queda en el registro histórico.

## Funcionamiento por sección

### 01 · CAPTURAR
- Campo **RUTINA** con autocompletado de nombres ya usados.
- **Cargar rutina anterior**: precarga los ejercicios de la última sesión con ese nombre, con los pesos/reps previos como referencia (placeholder).
- Cards de ejercicio con sets (kg × reps), añadir/quitar sets y movimientos.
- **Valores sugeridos:** cada nueva serie hereda el peso y las reps de la serie anterior (edítalos si cambian). Se empieza con una serie y añades las que necesites.
- **Finalizar sesión** guarda (o actualiza, si estabas editando una sesión vieja).

### Temporizador de descanso
- Botón **⏱** en la barra superior: activa/desactiva el descanso automático (se recuerda entre sesiones). Tocarlo también arranca un descanso manual.
- Con auto activado, al anotar las reps de una serie arranca el conteo (90s por defecto; presets 1:00–3:00). Avisa con beep y vibración.
- Aparece anclado abajo a la izquierda y reserva espacio para no tapar el contenido.

### 02 · LOG
- Historial agrupado por sesión: nombre de rutina, fecha y movimientos.
- Botón **Editar** en cada sesión para corregir datos viejos.
- Filtro por texto (rutina o ejercicio) y por período (7/30 días/todo).
- **Exportar / Importar**: respaldo en archivo JSON.

### 03 · MÉTRICAS
- Selector de ejercicio con: última carga, mejor marca, cambio total.
- Gráfico de barras de carga máxima en las últimas 8 sesiones.

## Datos

- Todo se guarda en `localStorage` bajo la clave `gymlog-sessions-v1`.
- Estructura: `{ id, date, name, exercises: [{ name, sets: [{ weight, reps }] }] }`.
- Sin servidor, sin cuentas: el respaldo/portabilidad es vía exportar/importar JSON.

## Estructura

```
LOADOUT/
├── index.html          ← única página: shell, templates y datalists
├── manifest.json       ← identidad PWA (nombre, icono, colores)
├── sw.js               ← service worker: caché offline
├── README.md
├── .gitignore
├── docs/
│   ├── ROADMAP.md      ← estado y próximos pasos
│   └── DRIVE.md        ← cómo activar la sincronización con Drive
└── src/
    ├── css/styles.css  ← estilos, tema claro/oscuro, responsive
    ├── js/
    │   ├── config.js   ← Client ID de Google (vacío = Drive desactivado)
    │   ├── app.js      ← lógica: sesiones, historial, métricas, timer
    │   ├── backup.js   ← durabilidad local: persistencia, copias, avisos
    │   └── drive.js    ← sincronización opcional con Google Drive
    └── img/icon.svg    ← icono de la app
```

**Por qué estos tres archivos viven en la raíz y no en `src/`:**

| Archivo | Motivo |
|---|---|
| `index.html` | GitHub Pages sirve el sitio desde la raíz del repo. |
| `sw.js` | El *scope* de un service worker no puede subir por encima de su carpeta. Desde `src/js/` solo podría cachear `src/js/**`, y la PWA perdería el modo offline. Pages no permite enviar la cabecera `Service-Worker-Allowed` que lo cambiaría. |
| `manifest.json` | `start_url` y `scope` se resuelven **relativos al manifest**. En la raíz apuntan a la app; moverlo obligaría a rutas `../` frágiles. |

## Despliegue (GitHub Pages)

La app está publicada en **https://mensetian.github.io/LOADOUT/** desde el repo `mensetian/LOADOUT` (branch `master`, carpeta raíz).

### Publicar cambios

```bash
git add -A
git commit -m "mensaje"
git push origin master
```

En ~1 minuto GitHub Pages actualiza el sitio automáticamente. En el celular, cierra y reabre la app para recibir la actualización (el service worker usa red-primero, así que baja la versión nueva cuando hay conexión).

### Nombre unificado

Carpeta local, repo de GitHub, código y documentación usan **LOADOUT**. La URL vieja
(`.../GymLog/`) queda redirigida por GitHub, pero la dirección buena es la de arriba:
si tenías la PWA instalada desde la URL vieja, reinstálala desde la nueva.

### Configuración inicial (ya hecha, referencia)

1. Repo en GitHub con el código en `master`.
2. **Settings → Pages → Source:** "Deploy from a branch", branch `master`, carpeta `/ (root)` → Save.

## Instalación como app (PWA)

1. Abrir https://mensetian.github.io/LOADOUT/ en Chrome (Android) o Safari (iPhone).
2. **Android:** menú ⋮ → *Instalar aplicación* (o el aviso "Añadir a pantalla de inicio").
   **iPhone:** botón compartir □↑ → *Añadir a pantalla de inicio*.
3. Se abre como app independiente y funciona **offline** (los archivos quedan cacheados por `sw.js`).

> **Nota:** el service worker requiere HTTP(S); abrir `index.html` con doble clic (`file://`) funciona pero sin modo offline ni instalación. Para probar en local: `npx serve .` y abrir `http://localhost:3000`.

### Datos y respaldos

Los datos viven en el `localStorage` de **cada dispositivo/navegador**. Hay tres capas de protección:

| Capa | Qué protege | Qué **no** protege |
|---|---|---|
| **Almacenamiento persistente** (automático) | Que el navegador borre los datos al liberar espacio | Borrado manual, perder el dispositivo |
| **Copias locales** (automáticas, botón *Copia local*) | Borrados accidentales dentro de la app: eliminar una sesión, importar mal | "Borrar datos de navegación", perder el dispositivo |
| **Exportar JSON** / **Google Drive** | Todo lo anterior, incluido perder el teléfono | — |

- La pestaña **LOG** avisa cuánto hace del último respaldo real y marca en rojo si pasan 7 días.
- **Instalar la PWA importa:** Safari borra el almacenamiento de sitios que no abres en ~7 días; las apps añadidas a la pantalla de inicio quedan fuera de esa regla.
- Para activar Drive: **[docs/DRIVE.md](docs/DRIVE.md)**.

## Roadmap

Estado del proyecto y próximos pasos: **[docs/ROADMAP.md](docs/ROADMAP.md)**.
