import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_API_URL, ENV_API_KEY, ENV_API_URL, ExitCode } from "./constants.js";
import { CliError } from "./errors.js";

/**
 * Where the key comes from, in order: the --api-key flag, the RANGO_API_KEY
 * variable, then the config file written by `rango auth set`. Same for the
 * API URL with --api-url, RANGO_API_URL and the file.
 */

export interface StoredConfig {
  apiKey?: string;
  apiUrl?: string;
}

export type KeySource = "flag" | "env" | "config";

const overrides: StoredConfig = {};

export function setOverrides(values: StoredConfig): void {
  overrides.apiKey = values.apiKey;
  overrides.apiUrl = values.apiUrl;
}

export function configDir(): string {
  const base = process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config");
  return join(base, "rango");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function readConfig(): StoredConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as StoredConfig;
    return {
      ...(typeof parsed.apiKey === "string" ? { apiKey: parsed.apiKey } : {}),
      ...(typeof parsed.apiUrl === "string" ? { apiUrl: parsed.apiUrl } : {}),
    };
  } catch {
    return {};
  }
}

export function writeConfig(values: StoredConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const merged = { ...readConfig(), ...values };
  for (const key of Object.keys(merged) as (keyof StoredConfig)[]) {
    if (merged[key] === undefined) delete merged[key];
  }
  const path = configPath();
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600); // the mode above does not apply to an existing file
}

export function deleteConfig(): void {
  const path = configPath();
  if (existsSync(path)) unlinkSync(path);
}

export function resolveApiKey(): { key: string; source: KeySource } | undefined {
  if (overrides.apiKey) return { key: overrides.apiKey, source: "flag" };
  const env = process.env[ENV_API_KEY];
  if (env) return { key: env, source: "env" };
  const stored = readConfig().apiKey;
  if (stored) return { key: stored, source: "config" };
  return undefined;
}

export function getApiKey(): string | undefined {
  return resolveApiKey()?.key;
}

function isLoopback(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

export function getApiUrl(): string {
  const raw = overrides.apiUrl || process.env[ENV_API_URL] || readConfig().apiUrl || DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError(`Invalid API URL: ${raw}`, ExitCode.InvalidArgs);
  }
  // The key travels in the query string, so it must never go out in clear text.
  if (url.protocol !== "https:" && !isLoopback(url)) {
    throw new CliError(
      `API URL must use https (got ${url.protocol}//${url.host})`,
      ExitCode.InvalidArgs,
      "The API key is sent as a query parameter and would be exposed over plain http.",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
