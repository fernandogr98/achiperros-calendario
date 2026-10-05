// Cloudflare Worker con Cron Trigger: lanza el GitHub Action "Actualizar calendario" de forma puntual.
// El cron de GitHub Actions se retrasa o se salta ejecuciones; el de Cloudflare es fiable.
//
// Configuración en Cloudflare (Workers & Pages > Create > Worker):
//   - Pegar este código.
//   - Settings > Variables and Secrets > añadir secreto GH_TOKEN (token fine-grained de GitHub,
//     solo para el repo achiperros-calendario, permiso "Actions: Read and write").
//   - Settings > Triggers > Cron Triggers > "15 9,15,20,22 * * *" (UTC: 11:15, 17:15, 22:15 y 00:15 en Madrid).
//     Pocas peticiones al día: Competize activó su anti-bots cuando lanzábamos cada 15 min.

const WORKFLOW = "https://api.github.com/repos/fernandogr98/achiperros-calendario/actions/workflows/update.yml/dispatches";

async function dispatch(env) {
  const r = await fetch(WORKFLOW, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "achiperros-cron",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (r.status !== 204) throw new Error(`GitHub respondió ${r.status}: ${await r.text()}`);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },
  // Visitar la URL del Worker no hace nada (evita que cualquiera lance ejecuciones).
  async fetch() {
    return new Response("Achiperros cron OK", { status: 200 });
  },
};
