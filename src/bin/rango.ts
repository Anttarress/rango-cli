import { Command } from "commander";
import { registerAgentCommand } from "../commands/agent.js";
import { registerApiCommand } from "../commands/api.js";
import { registerAuthCommand } from "../commands/auth.js";
import { registerGeneratedCommands } from "../commands/generated.js";
import { registerMcpCommand } from "../commands/mcp.js";
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
  Every API operation is a subcommand of "rango basic <op>" or "rango main <op>"; "rango map" lists them,
  "rango schema <surface> <op>" prints the input schema. "rango api <path>" reaches anything else.
  Assets are BLOCKCHAIN.SYMBOL or BLOCKCHAIN.SYMBOL--ADDRESS; chain names come from "rango basic chains",
  token details from "rango token <chain> <symbol>". Basic takes smallest-unit integer amounts;
  Main takes human-readable decimal amounts. Mixing them is the most common mistake.
  Nothing here signs or sends a transaction: "rango basic swap" and "rango main create-tx" return
  calldata for a wallet. "rango mcp" serves the same operations as MCP tools; "rango agent setup"
  wires them into Claude Code, Cursor or Codex.

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
  registerApiCommand(program);
  registerMcpCommand(program);
  registerAgentCommand(program);
  registerGeneratedCommands(program);

  return program;
}

/**
 * Let `rango <cmd> help` work like `rango <cmd> --help` even on leaf commands.
 * Walk the argv alongside the command tree; once we hit a bare `help` after a
 * known command path (and not as a value for an option), rewrite it to --help.
 */
export function normalizeHelpArg(argv: string[], program: Command): string[] {
  const out = [...argv];
  let cmd: Command = program;
  for (let i = 2; i < out.length; i++) {
    const arg = out[i];
    if (arg === undefined) break;
    if (arg === "help") {
      out[i] = "--help";
      break;
    }
    if (arg.startsWith("-")) {
      const opt = cmd.options.find((o) => o.short === arg || o.long === arg);
      if (opt?.required || opt?.optional) i++; // skip its value
      continue;
    }
    const sub = cmd.commands.find((c) => c.name() === arg || c.aliases().includes(arg));
    if (!sub) break; // a positional arg of the current command; stop walking
    cmd = sub;
  }
  return out;
}

if (process.env["VITEST"] === undefined) {
  const program = createProgram();
  program.parseAsync(normalizeHelpArg(process.argv, program)).catch(handleError);
}
