import { getApiKey, getApiUrl, maskKey } from "./config.js";
import { ExitCode, REQUEST_TIMEOUT_MS, VERSION } from "./constants.js";
import { CliError, mapHttpError, mapNetworkError } from "./errors.js";
import { debug } from "./output.js";

export type ParamValue = string | number | boolean | null | undefined;
export type Params = Record<string, ParamValue>;

export interface RequestOptions {
  params?: Params;
  body?: unknown;
  /** Attach the API key (default true). */
  auth?: boolean;
  timeoutMs?: number;
}

function buildUrl(path: string, params: Params | undefined, auth: boolean): URL {
  const base = getApiUrl();
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [name, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(name, String(value));
  }
  if (auth) {
    const key = getApiKey();
    if (!key) {
      throw new CliError(
        "No API key. Set RANGO_API_KEY, pass --api-key, or run: rango auth set <key>",
        ExitCode.AuthError,
        "Keys are issued by the Rango team: https://discord.gg/q3EngGyTrZ",
      );
    }
    url.searchParams.set("apiKey", key);
  }
  return url;
}

function redact(url: URL): string {
  const copy = new URL(url.toString());
  const key = copy.searchParams.get("apiKey");
  if (key) copy.searchParams.set("apiKey", maskKey(key));
  return copy.toString();
}

export async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const auth = options.auth !== false;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const url = buildUrl(path, options.params, auth);

  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": `rango-cli/${VERSION}`,
  };
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  debug(`${method} ${redact(url)}`);
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw mapNetworkError(error, timeoutMs);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!response.ok) {
    throw mapHttpError(response.status, contentType, text);
  }
  if (text.trim() === "") return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    if (contentType.includes("json")) {
      throw new CliError("The API returned malformed JSON", ExitCode.ApiError);
    }
    return text as unknown as T;
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, options),
  post: <T>(path: string, options?: RequestOptions) => request<T>("POST", path, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>("DELETE", path, options),
};
