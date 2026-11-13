import { ExitCode } from "./constants.js";
import { isJsonMode, isVerbose, jsonOutput } from "./output.js";

export class CliError extends Error {
  public readonly exitCode: ExitCode;
  public readonly hint: string | undefined;
  /** The API body that caused this, when there is one; printed in JSON mode. */
  public readonly payload: unknown;

  constructor(message: string, exitCode: ExitCode = ExitCode.General, hint?: string, payload?: unknown) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.hint = hint;
    this.payload = payload;
  }
}

export function invalidArgs(message: string, hint?: string): CliError {
  return new CliError(message, ExitCode.InvalidArgs, hint);
}

interface RangoErrorBody {
  error?: string | null;
  errorCode?: number | string | null;
  traceId?: string | null;
  message?: string;
}

function looksLikeHtml(contentType: string, body: string): boolean {
  if (contentType.includes("html")) return true;
  const head = body.trimStart().slice(0, 20).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

/** Turn a non-2xx response into a CliError with the right exit code and a useful message. */
export function mapHttpError(status: number, contentType: string, body: string): CliError {
  if (status === 401) {
    const empty = body.trim() === "";
    return new CliError(
      empty
        ? "HTTP 401: the API rejected the request. Usually a missing or invalid API key; a few endpoints also answer 401 for an id they do not recognise."
        : `HTTP 401: ${body.trim().slice(0, 300)}`,
      ExitCode.AuthError,
      "Check your key with: rango auth test",
    );
  }

  if (looksLikeHtml(contentType, body)) {
    const rateLimited = status === 403 || status === 429;
    return new CliError(
      `HTTP ${status}: blocked by the edge layer in front of the API (Cloudflare), not by Rango itself.`,
      ExitCode.ApiError,
      rateLimited
        ? "Usually rate limiting. Wait a moment and retry."
        : "An HTML page came back where JSON was expected.",
    );
  }

  let parsed: RangoErrorBody | undefined;
  try {
    parsed = JSON.parse(body) as RangoErrorBody;
  } catch {
    parsed = undefined;
  }
  if (parsed && (parsed.error || parsed.message)) {
    const code = parsed.errorCode ? ` (code ${parsed.errorCode})` : "";
    const trace = parsed.traceId ? ` traceId=${parsed.traceId}` : "";
    return new CliError(
      `HTTP ${status}: ${parsed.error ?? parsed.message}${code}${trace}`,
      ExitCode.ApiError,
      undefined,
      parsed,
    );
  }

  const text = body.trim();
  const suffix = text ? `: ${text.length > 300 ? `${text.slice(0, 300)}…` : text}` : " with an empty body";
  return new CliError(`HTTP ${status}${suffix}`, ExitCode.ApiError);
}

/** fetch() failures: refused, unreachable, DNS, TLS, abort on timeout. */
export function mapNetworkError(error: unknown, timeoutMs: number): CliError {
  const err = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return new CliError(
      `Request timed out after ${Math.round(timeoutMs / 1000)}s`,
      ExitCode.NetworkError,
      "Routing calls can be slow; retry, or raise the timeout with --timeout.",
    );
  }
  const detail = err?.cause?.code ?? err?.cause?.message ?? err?.message ?? "network error";
  return new CliError(
    `Network error: ${detail}`,
    ExitCode.NetworkError,
    "Check your connection and the API URL.",
  );
}

export function formatError(error: unknown): string {
  if (error instanceof CliError) {
    const lines = [`Error: ${error.message}`];
    if (error.hint) lines.push(`  ${error.hint}`);
    return lines.join("\n");
  }
  if (error instanceof Error) return `Error: ${error.message}`;
  return "Error: an unexpected error occurred";
}

export function errorToJson(error: unknown): Record<string, unknown> {
  if (error instanceof CliError) {
    return {
      error: true,
      exitCode: error.exitCode,
      message: error.message,
      ...(error.hint ? { hint: error.hint } : {}),
      ...(error.payload !== undefined ? { response: error.payload } : {}),
    };
  }
  return {
    error: true,
    exitCode: ExitCode.General,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Print an error on stderr (text or JSON, matching the output mode) and exit. */
export function handleError(error: unknown): never {
  if (isJsonMode()) {
    console.error(jsonOutput(errorToJson(error)));
  } else {
    console.error(formatError(error));
  }
  if (isVerbose() && error instanceof Error && error.stack) {
    console.error(`\n${error.stack}`);
  }
  const code = error instanceof CliError ? error.exitCode : ExitCode.General;
  process.exit(code);
}
