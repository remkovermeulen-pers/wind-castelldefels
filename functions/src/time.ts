/**
 * All scheduling windows are expressed in local Castelldefels time.
 * Europe/Madrid is CET in winter and CEST in summer; using the IANA zone
 * rather than a fixed UTC offset keeps the windows correct across DST.
 */
export const ZONE = "Europe/Madrid";

export interface LocalTime {
  /** YYYY-MM-DD in Europe/Madrid */
  day: string;
  hour: number;
  minute: number;
  /** Minutes since local midnight */
  minutesOfDay: number;
}

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function localTime(at: Date = new Date()): LocalTime {
  const f: Record<string, string> = {};
  for (const p of parts.formatToParts(at)) f[p.type] = p.value;

  const hour = Number(f.hour);
  const minute = Number(f.minute);

  return {
    day: `${f.year}-${f.month}-${f.day}`,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

/** Inclusive on both ends, e.g. withinWindow(t, 8, 20) includes exactly 20:00. */
export function withinWindow(t: LocalTime, startHour: number, endHour: number): boolean {
  return t.minutesOfDay >= startHour * 60 && t.minutesOfDay <= endHour * 60;
}

/** Wind is sampled every 5 minutes between 08:00 and 20:00 local. */
export function shouldPollWind(t: LocalTime): boolean {
  return withinWindow(t, 8, 20);
}

/**
 * Twintip status is sampled every 10 minutes between 12:00 and 21:00 local.
 * The scheduler ticks every 5 minutes, so only even 10-minute slots run.
 */
export function shouldPollTwintip(t: LocalTime): boolean {
  return withinWindow(t, 12, 21) && t.minute % 10 === 0;
}

/**
 * Latest hour any source is still being polled — the tick schedule and the
 * daily retention sweep both key off this.
 */
export const LAST_ACTIVE_HOUR = 21;
