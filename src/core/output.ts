/**
 * Output mode for the whole process. Set once from the global flags, read by
 * every command and by the error handler.
 *
 * Tables when stdout is a terminal, JSON when it is a pipe or --json was
 * given. Errors always go to stderr, so a script capturing stdout never has
 * to tell a result from an error; the exit code says which it was.
 */

interface OutputState {
  json: boolean;
  compact: boolean;
  color: boolean;
  input: boolean;
  verbose: boolean;
}

const state: OutputState = {
  json: false,
  compact: false,
  color: true,
  input: true,
  verbose: false,
};

export interface GlobalOptions {
  json?: boolean;
  compact?: boolean;
  color?: boolean;
  input?: boolean;
  verbose?: boolean;
}

export function configureOutput(options: GlobalOptions): void {
  state.compact = options.compact === true;
  state.json = options.json === true || state.compact || !process.stdout.isTTY;
  state.color = options.color !== false && !process.env["NO_COLOR"] && Boolean(process.stdout.isTTY);
  state.input = options.input !== false && Boolean(process.stdin.isTTY);
  state.verbose = options.verbose === true;
}

export function isJsonMode(): boolean {
  return state.json;
}

export function isInteractive(): boolean {
  return state.input;
}

export function isVerbose(): boolean {
  return state.verbose;
}

export function jsonOutput(data: unknown): string {
  return state.compact ? JSON.stringify(data) : JSON.stringify(data, null, 2);
}

export function printJson(data: unknown): void {
  console.log(jsonOutput(data));
}

const isPlain = (value: unknown): boolean =>
  value === null ||
  typeof value !== "object" ||
  (Array.isArray(value) && value.every((item) => item === null || typeof item !== "object"));

/** No object inside it holds another one. */
const isShallow = (value: unknown): boolean =>
  isPlain(value) || (!Array.isArray(value) && Object.values(value as object).every(isPlain));

/**
 * JSON that keeps an object on one line until something inside it nests twice.
 * A schema then reads a field per line, `"amount": { "type": "string", … }`,
 * in a third of the lines JSON.stringify gives it.
 */
export function tidyJson(value: unknown, indent = ""): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const inside = `${indent}  `;
  if (Array.isArray(value)) {
    if (isPlain(value)) return `[${value.map((item) => tidyJson(item)).join(", ")}]`;
    return `[\n${value.map((item) => inside + tidyJson(item, inside)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  if (entries.length === 0) return "{}";
  if (entries.every(([, item]) => isShallow(item))) {
    return `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${tidyJson(item)}`).join(", ")} }`;
  }
  const lines = entries.map(([key, item]) => `${inside}${JSON.stringify(key)}: ${tidyJson(item, inside)}`);
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** printJson for a schema: tidy, and still one line with --compact. */
export function printTidyJson(data: unknown): void {
  console.log(state.compact ? JSON.stringify(data) : tidyJson(data));
}

export function print(text: string): void {
  console.log(text);
}

/** Progress and warnings: stderr, so stdout stays a clean result. */
export function note(text: string): void {
  console.error(text);
}

export function debug(text: string): void {
  if (state.verbose) console.error(`[debug] ${text}`);
}

function paint(code: number, text: string): string {
  return state.color ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const color = {
  bold: (t: string) => paint(1, t),
  dim: (t: string) => paint(2, t),
  green: (t: string) => paint(32, t),
  yellow: (t: string) => paint(33, t),
  red: (t: string) => paint(31, t),
  cyan: (t: string) => paint(36, t),
};
