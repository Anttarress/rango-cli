export const CLI_NAME = "rango";
export const VERSION = "0.1.0";

export const DEFAULT_API_URL = "https://api.rango.exchange";

export const ENV_API_KEY = "RANGO_API_KEY";
export const ENV_API_URL = "RANGO_API_URL";

export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Rango's hosted MCP server. Empty until it is live: while it is empty,
 * `rango agent setup` registers the server this CLI runs on the user's machine
 * (`rango mcp`). Put the URL here at launch and hosted becomes the default.
 */
export const HOSTED_MCP_URL: string = "";

/**
 * The GitHub repository the Rango skills live in, and the index of them in it.
 * It is the only copy: `rango agent setup` downloads the skills from here each
 * time it runs, and `npx skills add <SKILLS_REPO>` installs the same files. A
 * move of that repository means changing this line and releasing.
 */
export const SKILLS_REPO = "Anttarress/rango-skills";
export const SKILLS_INDEX_URL = `https://raw.githubusercontent.com/${SKILLS_REPO}/main/skills/index.json`;

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
