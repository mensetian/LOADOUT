// ---------------------------------------------------------------------------
// Configuración de LOADOUT
// ---------------------------------------------------------------------------
// Para activar la sincronización con Google Drive, pega aquí el "Client ID"
// que generes en Google Cloud Console. Los pasos están en docs/DRIVE.md
//
// Si lo dejas vacío, la app funciona exactamente igual y la tarjeta de Drive
// simplemente no aparece. No es un dato secreto: los Client ID de aplicaciones
// web son públicos por diseño.
// ---------------------------------------------------------------------------

const GOOGLE_CLIENT_ID = '990150930418-n8tider3m12ui6f1v605brab4glifoei.apps.googleusercontent.com';

// URL del worker de Cloudflare que hace la conexión con Drive permanente
// (renueva el token sin popup; ver worker/drive-auth.js y docs/DRIVE.md).
// Vacío = flujo antiguo sin worker: el permiso dura ~1 hora por sesión.
const DRIVE_AUTH_URL = 'https://loadout-auth.mensetian.workers.dev';
