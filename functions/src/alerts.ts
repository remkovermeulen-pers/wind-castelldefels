import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import * as logger from "firebase-functions/logger";
import type { LocalTime } from "./time";

/** Average wind at or above this many knots triggers a push. */
export const WIND_ALERT_KNOTS = 13;

export type AlertKind = "twintip" | "wind";

interface AlertState {
  day: string;
  twintipArmed: boolean;
  windArmed: boolean;
}

const STATE_PATH = "state/alerts";

/**
 * Rising-edge gate.
 *
 * An alert fires only on the transition from "condition false" to "condition
 * true". It stays silent while the condition holds, and re-arms once the
 * condition drops away again — or when a new local day starts, so a session
 * that was still active at midnight does not suppress the next morning.
 *
 * Returns the kinds that should actually be sent this tick.
 */
export async function gateAlerts(
  t: LocalTime,
  conditions: Partial<Record<AlertKind, boolean>>
): Promise<AlertKind[]> {
  const db = getFirestore();
  const ref = db.doc(STATE_PATH);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.data() as AlertState | undefined;

    // A new local day re-arms everything.
    const state: AlertState =
      prev && prev.day === t.day
        ? { ...prev }
        : { day: t.day, twintipArmed: true, windArmed: true };

    const fire: AlertKind[] = [];

    for (const kind of ["twintip", "wind"] as const) {
      const active = conditions[kind];
      if (active === undefined) continue; // source not polled this tick

      const armedKey = kind === "twintip" ? "twintipArmed" : "windArmed";

      if (active) {
        if (state[armedKey]) {
          fire.push(kind);
          state[armedKey] = false;
        }
      } else {
        state[armedKey] = true;
      }
    }

    tx.set(ref, { ...state, updatedAt: FieldValue.serverTimestamp() });
    return fire;
  });
}

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
}

/**
 * Fan a notification out to every registered web-push token, pruning tokens
 * the FCM backend reports as permanently dead.
 */
export async function sendPush(payload: PushPayload): Promise<number> {
  const db = getFirestore();
  const snap = await db.collection("tokens").get();
  const tokens = snap.docs.map((d) => d.id);

  if (tokens.length === 0) {
    logger.info("No registered tokens; skipping push", { payload });
    return 0;
  }

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: payload.title, body: payload.body },
    webpush: {
      notification: {
        title: payload.title,
        body: payload.body,
        tag: payload.tag,
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-72.png",
        renotify: true,
      },
      fcmOptions: { link: "/" },
    },
  });

  const dead: string[] = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token" ||
      code === "messaging/invalid-argument"
    ) {
      dead.push(tokens[i]);
    }
  });

  if (dead.length) {
    const batch = db.batch();
    for (const token of dead) batch.delete(db.collection("tokens").doc(token));
    await batch.commit();
    logger.info(`Pruned ${dead.length} dead token(s)`);
  }

  logger.info("Push sent", {
    title: payload.title,
    success: res.successCount,
    failure: res.failureCount,
  });

  return res.successCount;
}
