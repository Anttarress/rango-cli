import { Command } from "commander";
import { registerAgentCommand } from "../commands/agent.js";
import { registerApiCommand } from "../commands/api.js";
import { registerAuthCommand } from "../commands/auth.js";
import { registerBalanceCommand } from "../commands/balance.js";
import { registerChainsCommand } from "../commands/chains.js";
import { registerGeneratedCommands } from "../commands/generated.js";
import { registerHealthCommand } from "../commands/health.js";
import { registerMcpCommand } from "../commands/mcp.js";
import { registerQuoteCommand } from "../commands/quote.js";
import { registerReportCommand } from "../commands/report.js";
import { registerRouteCommand } from "../commands/route.js";
import { registerStatusCommand } from "../commands/status.js";
import { registerSwapCommand } from "../commands/swap.js";
import { registerSwappersCommand } from "../commands/swappers.js";
import { registerTokensCommand } from "../commands/tokens.js";
import { setOverrides } from "../core/config.js";
import { CLI_NAME, DISCORD_URL, DOCS_URL, REPO_URL, VERSION } from "../core/constants.js";
import { handleError } from "../core/errors.js";
import { configureOutput, type GlobalOptions } from "../core/output.js";

const AGENT_GUIDANCE = `
Agent guidance:
  Output is JSON whenever stdout is not a terminal; --json forces it, --compact puts it on one line.
  Errors go to stderr as JSON in that mode. Exit codes: 2 bad arguments, 3 key rejected or missing,
  4 API error (no route, limits, server), 5 network error, 1 anything else.
  Set RANGO_API_KEY, pass --api-key, or run "rango auth set <key>"; "rango auth test" checks it.
  Assets are BLOCKCHAIN.SYMBOL or BLOCKCHAIN.SYMBOL--ADDRESS; "rango chains" and "rango tokens" list them.
  --amount takes the smallest unit as an integer, or a decimal that is converted using the token's decimals.
  Nothing here signs or sends a transaction: "rango swap" returns calldata for a wallet.
  Every API operation is also "rango basic <op>" or "rango main <op>"; "rango map" lists them,
  "rango schema <surface> <op>" prints the input schema. "rango api <path>" reaches anything else.
  "rango mcp" serves the same operations as MCP tools; "rango agent setup" wires them into
  Claude Code, Cursor or Codex.

Docs: ${DOCS_URL}   Keys: ${DISCORD_URL}   Source: ${REPO_URL}`;

export function createProgram(): Command {
  const program = new Command();

  program
    .name(CLI_NAME)
    .description(
      "Rango Exchange from the terminal: cross-chain quotes, swaps, status, metadata, and an MCP server",
    )
    .version(VERSION, "-v, --version")
    .option("--json", "Print JSON even on a terminal")
    .option("--compact", "Single-line JSON (implies --json)")
    .option("--api-key <key>", "Rango API key for this run (overrides RANGO_API_KEY and the config file)")
    .option("--api-url <url>", "API base URL (default https://api.rango.exchange)")
    .option("--no-color", "Disable colored output")
    .option("--no-input", "Never prompt; fail when a required flag is missing")
    .option("--verbose", "Log requests (key masked) and stack traces to stderr")
    .addHelpText("after", AGENT_GUIDANCE)
    .showHelpAfterError("(add --help for usage)")
    .configureHelp({ sortSubcommands: true });

  program.hook("preAction", (thisCommand) => {
    const opts = thisCommand.optsWithGlobals() as GlobalOptions & { apiKey?: string; apiUrl?: string };
    configureOutput(opts);
    setOverrides({ apiKey: opts.apiKey, apiUrl: opts.apiUrl });
  });

  registerAuthCommand(program);
  registerChainsCommand(program);
  registerTokensCommand(program);
  registerSwappersCommand(program);
  registerQuoteCommand(program);
  registerRouteCommand(program);
  registerSwapCommand(program);
  registerStatusCommand(program);
  registerBalanceCommand(program);
  registerReportCommand(program);
  registerHealthCommand(program);
  registerApiCommand(program);
  registerMcpCommand(program);
  registerAgentCommand(program);
  registerGeneratedCommands(program);

  return program;
}

if (process.env["VITEST"] === undefined) {
  createProgram().parseAsync(process.argv).catch(handleError);
}
