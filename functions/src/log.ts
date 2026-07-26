/**
 * Portable logger for the shared polling code.
 *
 * `tick()` runs on three hosts now — Netlify Scheduled Functions, GitHub
 * Actions, and Cloud Functions — so the shared path cannot depend on
 * firebase-functions/logger. All three collect stdout/stderr, and Google Cloud
 * Logging parses a JSON line into structured fields, so this stays useful
 * there too.
 */
type Fields = Record<string, unknown>;

function emit(severity: "INFO" | "ERROR", message: string, data?: unknown): void {
  const entry: Fields = { severity, message };

  if (data instanceof Error) {
    entry.error = data.message;
    entry.stack = data.stack;
  } else if (data !== undefined) {
    entry.data = data;
  }

  const line = JSON.stringify(entry);
  if (severity === "ERROR") console.error(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, data?: unknown) => emit("INFO", message, data),
  error: (message: string, data?: unknown) => emit("ERROR", message, data),
};
