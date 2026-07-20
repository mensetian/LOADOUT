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

## Archivos

| Archivo | Rol |
|---|---|
| `index.html` | Estructura, templates de ejercicio/set, datalists |
| `app.js` | Toda la lógica (sesiones, historial, métricas, backup) |
| `styles.css` | Estilos, tema claro/oscuro |
| `manifest.json` | Metadatos de la PWA (nombre, icono, colores) |
| `sw.js` | Service worker: caché offline (red-primero, caché de respaldo) |
| `icon.svg` | Icono de la app |

## Despliegue (GitHub Pages)

La app está publicada en **https://mensetian.github.io/GymLog/** desde el repo `mensetian/GymLog` (branch `master`, carpeta raíz).

### Publicar cambios

```bash
git add -A
git commit -m "mensaje"
git push origin master
```

En ~1 minuto GitHub Pages actualiza el sitio automáticamente. En el celular, cierra y reabre la app para recibir la actualización (el service worker usa red-primero, así que baja la versión nueva cuando hay conexión).

### Renombrar el proyecto a LOADOUT (carpeta + repo)

El código ya usa el nombre LOADOUT. Para que la carpeta local y el repo de GitHub coincidan:

1. **Repo en GitHub:** Settings → *Repository name* → cambiar `GymLog` por `LOADOUT` → Rename. GitHub redirige la URL vieja automáticamente. La nueva URL de Pages será `https://mensetian.github.io/LOADOUT/`.
2. **Remote local** (en una terminal, con el repo cerrado en el editor):
   ```bash
   git remote set-url origin https://github.com/mensetian/LOADOUT.git
   ```
3. **Carpeta local:** cerrar el editor y renombrar `c:\pipe_pc\www\GymLog` → `c:\pipe_pc\www\LOADOUT` desde el Explorador de Windows (no se puede renombrar mientras esté abierta en el editor).

### Configuración inicial (ya hecha, referencia)

1. Repo en GitHub con el código en `master`.
2. **Settings → Pages → Source:** "Deploy from a branch", branch `master`, carpeta `/ (root)` → Save.

## Instalación como app (PWA)

1. Abrir https://mensetian.github.io/GymLog/ en Chrome (Android) o Safari (iPhone).
2. **Android:** menú ⋮ → *Instalar aplicación* (o el aviso "Añadir a pantalla de inicio").
   **iPhone:** botón compartir □↑ → *Añadir a pantalla de inicio*.
3. Se abre como app independiente y funciona **offline** (los archivos quedan cacheados por `sw.js`).

> **Nota:** el service worker requiere HTTP(S); abrir `index.html` con doble clic (`file://`) funciona pero sin modo offline ni instalación. Para probar en local: `npx serve .` y abrir `http://localhost:3000`.

### Datos y respaldos

- Los datos viven en el `localStorage` de **cada dispositivo/navegador** — el celular y el PC no se sincronizan entre sí.
- Usa **Exportar datos** (pestaña LOG) periódicamente como respaldo, e **Importar datos** para restaurar o migrar a otro dispositivo.

## Ideas futuras (roadmap)

- ✅ ~~**Precargar marcas a superar**~~: al cargar rutina anterior, los pesos/reps previos aparecen como placeholder en cada set.
- ✅ ~~**PRs automáticos**~~: al guardar, se detectan récords de carga máxima por ejercicio y se celebran con el antes/después.
- ✅ ~~**Temporizador de descanso**~~: barra flotante que auto-inicia al anotar reps (90s), presets 1:00–3:00, beep y vibración.
- ✅ ~~**PWA**~~: manifest + service worker con caché offline, instalable y publicada en GitHub Pages.
- **Plantillas de rutina**: definir rutinas fijas (día A/B/C) independientes de las sesiones.
- **Notas por ejercicio/sesión** (sensaciones, técnica, dolor).
- **RPE / RIR** por set para gestionar intensidad.
- **Gráficos de volumen semanal** por grupo muscular.
- **Calendario/heatmap** de asistencia estilo GitHub.
- **Duplicar sesión** desde el historial con un tap.
- **Unidades lb/kg** configurables.
- **Sincronización opcional** (ej. exportar a Google Drive) manteniendo el modo sin cuenta.
