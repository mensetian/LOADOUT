// ---------------------------------------------------------------------------
// Worker de Cloudflare para la conexión permanente con Google Drive
//
// Su único trabajo es custodiar el client secret (que no puede ir en el código
// público de la app) y hablar con Google en nombre de la app:
//
//   POST /exchange { code }           → primera autorización: cambia el código
//                                       por access_token + refresh_token.
//   POST /refresh  { refresh_token }  → renueva el access_token sin popup.
//
// No guarda nada de nadie: el refresh token de cada usuario vive en su propio
// dispositivo. Por eso soporta cualquier cantidad de usuarios sin base de datos.
//
// Variables requeridas (Settings → Variables and Secrets del worker):
//   GOOGLE_CLIENT_ID      (texto)   — el mismo de src/js/config.js
//   GOOGLE_CLIENT_SECRET  (secreto) — de Google Cloud Console → Credenciales
// ---------------------------------------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const path = new URL(request.url).pathname;
    const body = await request.json().catch(() => ({}));

    const params = {
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    };
    if (path === '/exchange') {
      if (!body.code) return json({ error: 'missing_code' }, 400);
      // 'postmessage' es el redirect_uri especial del flujo popup de Google.
      Object.assign(params, { code: body.code, grant_type: 'authorization_code', redirect_uri: 'postmessage' });
    } else if (path === '/refresh') {
      if (!body.refresh_token) return json({ error: 'missing_refresh_token' }, 400);
      Object.assign(params, { refresh_token: body.refresh_token, grant_type: 'refresh_token' });
    } else {
      return json({ error: 'not_found' }, 404);
    }

    const google = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    // Se reenvía tal cual la respuesta de Google (tokens o error, p. ej.
    // 'invalid_grant' cuando el usuario revocó el acceso).
    return json(await google.json(), google.status);
  },
};
