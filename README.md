# LOADOUT — GymLog

Registro de entrenamiento de fuerza, simple y sin cuentas. Aplicación web estática (HTML + CSS + JS puro) que guarda todo en el navegador (`localStorage`).

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
- **Cargar rutina anterior**: precarga los ejercicios de la última sesión con ese nombre.
- Cards de ejercicio con sets (kg × reps), añadir/quitar sets y movimientos.
- **Finalizar sesión** guarda (o actualiza, si estabas editando una sesión vieja).

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

## Ideas futuras (roadmap)

- **Precargar marcas a superar**: al cargar rutina anterior, rellenar pesos/reps previos como objetivo.
- **PRs automáticos**: detectar y celebrar récords personales (mejor peso, mejor volumen, 1RM estimado con Epley/Brzycki).
- **Temporizador de descanso** entre sets, con aviso.
- **Plantillas de rutina**: definir rutinas fijas (día A/B/C) independientes de las sesiones.
- **Notas por ejercicio/sesión** (sensaciones, técnica, dolor).
- **RPE / RIR** por set para gestionar intensidad.
- **PWA**: instalable en el teléfono y usable offline con service worker.
- **Gráficos de volumen semanal** por grupo muscular.
- **Calendario/heatmap** de asistencia estilo GitHub.
- **Duplicar sesión** desde el historial con un tap.
- **Unidades lb/kg** configurables.
- **Sincronización opcional** (ej. exportar a Google Drive) manteniendo el modo sin cuenta.
