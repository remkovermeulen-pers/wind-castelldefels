/**
 * Scheduled poller — the primary execution host.
 *
 * Runs the same `tick()` as the Cloud Function and the GitHub Actions runner,
 * so there is one implementation of the polling and alert rules. Netlify was
 * chosen over GitHub Actions because Actions delays scheduled workflows under
 * load and drops them outright — in practice it did not fire this schedule at
 * all for over an hour, which is no good for a wind alert.
 *
 * Credentials come from the FIREBASE_SERVICE_ACCOUNT environment variable
 * (Netlify project settings), holding the service-account JSON.
 */
import type { Config } from "@netlify/functions";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { tick } from "../../functions/src/poller";

function ensureApp(): void {
  // Lambda reuses warm containers, so initialise at most once per container.
  if (getApps().length) return;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is not set — add the service-account JSON in the Netlify project's environment variables."
    );
  }

  initializeApp({ credential: cert(JSON.parse(raw)) });
}

export default async (): Promise<Response> => {
  ensureApp();

  const result = await tick(new Date());
  console.log(JSON.stringify({ severity: "INFO", message: "tick", data: result }));

  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
};

/**
 * Every 5 minutes across 06:00–22:59 UTC.
 *
 * Netlify crons are UTC and do not follow DST, so this spans wide enough to
 * cover both CET and CEST. The real windows live in functions/src/time.ts and
 * are evaluated against Europe/Madrid, so a tick outside them returns in
 * milliseconds without touching any source.
 */
export const config: Config = {
  schedule: "*/5 6-22 * * *",
};
