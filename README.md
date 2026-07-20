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
│   └── ROADMAP.md      ← estado y próximos pasos
└── src/
    ├── css/styles.css  ← estilos, tema claro/oscuro, responsive
    ├── js/app.js       ← lógica: sesiones, historial, métricas, timer, backup
    └── img/icon.svg    ← icono de la app
```

**Por qué estos tres archivos viven en la raíz y no en `src/`:**

| Archivo | Motivo |
|---|---|
| `index.html` | GitHub Pages sirve el sitio desde la raíz del repo. |
| `sw.js` | El *scope* de un service worker no puede subir por encima de su carpeta. Desde `src/js/` solo podría cachear `src/js/**`, y la PWA perdería el modo offline. Pages no permite enviar la cabecera `Service-Worker-Allowed` que lo cambiaría. |
| `manifest.json` | `start_url` y `scope` se resuelven **relativos al manifest**. En la raíz apuntan a la app; moverlo obligaría a rutas `../` frágiles. |

## Despliegue (GitHub Pages)

La app está publicada en **https://mensetian.github.io/GymLog/** desde el repo `mensetian/GymLog` (branch `master`, carpeta raíz).

### Publicar cambios

```bash
git add -A
git commit -m "mensaje"
git push origin master
```

En ~1 minuto GitHub Pages actualiza el sitio automáticamente. En el celular, cierra y reabre la app para recibir la actualización (el service worker usa red-primero, así que baja la versión nueva cuando hay conexión).

### Renombrar el proyecto a LOADOUT — pendiente: el repo

- ✅ **Carpeta local:** ya es `c:\pipe_pc\www\LOADOUT`.
- ✅ **Código y documentación:** ya usan LOADOUT.
- ⬜ **Repo en GitHub:** sigue siendo `GymLog`. Para unificarlo:

1. En GitHub: **Settings → Repository name** → cambiar `GymLog` por `LOADOUT` → *Rename*.
   GitHub redirige la URL vieja automáticamente. La nueva URL de Pages pasa a ser
   `https://mensetian.github.io/LOADOUT/` (y habrá que reinstalar la PWA desde la nueva dirección).
2. Actualizar el remote local:
   ```bash
   git remote set-url origin https://github.com/mensetian/LOADOUT.git
   ```

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

## Roadmap

Estado del proyecto y próximos pasos: **[docs/ROADMAP.md](docs/ROADMAP.md)**.
