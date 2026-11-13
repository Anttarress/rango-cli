export const CLI_NAME = "rango";
export const VERSION = "0.1.0";

export const DEFAULT_API_URL = "https://api.rango.exchange";

export const ENV_API_KEY = "RANGO_API_KEY";
export const ENV_API_URL = "RANGO_API_URL";

export const REQUEST_TIMEOUT_MS = 30_000;

export const DOCS_URL = "https://docs.rango.exchange";
export const DISCORD_URL = "https://discord.gg/q3EngGyTrZ";
export const REPO_URL = "https://github.com/Anttarress/rango-cli";

export enum ExitCode {
  Success = 0,
  General = 1,
  InvalidArgs = 2,
  AuthError = 3,
  ApiError = 4,
  NetworkError = 5,
}

/** Statuses after which /basic/status stops changing. The API lower-cases them. */
export const TERMINAL_STATUSES = new Set(["success", "failed"]);

export const REPORT_EVENT_TYPES = [
  "FETCH_TX_FAILED",
  "USER_REJECT",
  "USER_CANCEL",
  "CALL_WALLET_FAILED",
  "SEND_TX_FAILED",
  "CLIENT_UNEXPECTED_BEHAVIOUR",
  "TX_EXPIRED",
  "INSUFFICIENT_APPROVE",
] as const;
