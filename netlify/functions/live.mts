/**
 * Live wind proxy.
 *
 * 17nudos refreshes its reading every ~5 seconds, but sends no CORS headers, so
 * the browser cannot read it directly. This endpoint fetches it server-side —
 * reusing the exact parser the scheduled poller uses — and returns JSON with
 * CORS headers, so the PWA can show a near-live current wind while it is open.
 *
 * It writes nothing: history and alerts remain the scheduled poller's job. A
 * short cache shields 17nudos when several clients poll at once.
 */
import type { Config } from "@netlify/functions";
import { fetchWind } from "../../functions/src/sources/nudos";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  // Cache briefly so many viewers collapse onto one upstream fetch every ~5s.
  "cache-control": "public, max-age=5",
};

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const w = await fetchWind();
    return new Response(JSON.stringify({ ...w, at: Date.now() }), {
      headers: { ...CORS, "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
};

/** On-demand HTTP endpoint at /.netlify/functions/live — no schedule. */
export const config: Config = {
  path: "/live",
};
