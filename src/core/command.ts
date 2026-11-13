import { handleError } from "./errors.js";

/** Wrap a command action so any error is reported in the current output mode and exits. */
export function action<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (error) {
      handleError(error);
    }
  };
}

export function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

export function parseNumber(label: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`${label} must be a number, got "${value}"`);
  return n;
}
