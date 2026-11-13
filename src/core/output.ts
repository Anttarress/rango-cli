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
