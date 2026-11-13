import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Command, Option } from "commander";
import { action } from "../core/command.js";
import { ExitCode } from "../core/constants.js";
import { CliError, invalidArgs } from "../core/errors.js";
import { confirm } from "../core/interactive.js";
import { isInteractive, isJsonMode, note, print, printJson } from "../core/output.js";

/**
 * `rango agent setup`: detect the coding agents on this machine and give each
 * one the Rango MCP server and the Rango skill. Modelled on `stripe agent setup`.
 *
 *   Claude Code  MCP via `claude mcp add` (user scope); skill in ~/.claude/skills
 *   Cursor       MCP merged into ~/.cursor/mcp.json;  skill in ~/.cursor/skills
 *   Codex        MCP appended to ~/.codex/config.toml; skill in ~/.codex/skills
 *
 * Nothing here stores the API key in an agent's config: `rango mcp` reads it
 * from RANGO_API_KEY or the file written by `rango auth set`, like every command.
 */

export type ClientId = "claude-code" | "cursor" | "codex";
export type Scope = "global" | "local";

interface ClientDef {
  id: ClientId;
  label: string;
  homeDir: string;
  localDir: string;
  skillsSubdir: string;
}

const CLIENTS: ClientDef[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    homeDir: ".claude",
    localDir: ".claude",
    skillsSubdir: "skills",
  },
  { id: "cursor", label: "Cursor", homeDir: ".cursor", localDir: ".cursor", skillsSubdir: "skills" },
  { id: "codex", label: "Codex", homeDir: ".codex", localDir: ".codex", skillsSubdir: "skills" },
];

function which(binary: string): string | undefined {
  const dirs = (process.env["PATH"] ?? "").split(":").filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, binary);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** How an agent should launch the server: the installed binary, else npx. */
export function mcpLaunch(): { command: string; args: string[] } {
  return which("rango")
    ? { command: "rango", args: ["mcp"] }
    : { command: "npx", args: ["-y", "@rango-dev/cli", "mcp"] };
}

export function skillSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, "../skills/rango/SKILL.md"),
    join(here, "../../skills/rango/SKILL.md"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new CliError("Bundled skill file not found; reinstall @rango-dev/cli", ExitCode.General);
}

function detect(client: ClientDef): boolean {
  if (existsSync(join(homedir(), client.homeDir))) return true;
  return client.id === "claude-code" && Boolean(which("claude"));
}

interface Step {
  kind: "mcp" | "skill";
  description: string;
  apply: () => string;
}

function skillStep(client: ClientDef, scope: Scope): Step {
  const base = scope === "global" ? join(homedir(), client.homeDir) : join(process.cwd(), client.localDir);
  const target = join(base, client.skillsSubdir, "rango", "SKILL.md");
  return {
    kind: "skill",
    description: `write skill ${target}`,
    apply: () => {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(skillSource(), target);
      return `skill installed at ${target}`;
    },
  };
}

function claudeCodeMcpStep(): Step {
  const claude = which("claude");
  const launch = mcpLaunch();
  if (!claude) {
    return {
      kind: "mcp",
      description: "Claude Code: print the command to register the MCP server (claude binary not on PATH)",
      apply: () =>
        `claude not found on PATH. Register the server yourself:\n  claude mcp add --scope user rango -- ${launch.command} ${launch.args.join(" ")}`,
    };
  }
  return {
    kind: "mcp",
    description: `run: claude mcp add --scope user rango -- ${launch.command} ${launch.args.join(" ")}`,
    apply: () => {
      try {
        execFileSync(claude, ["mcp", "get", "rango"], { stdio: "ignore" });
        return "Claude Code already has an MCP server named rango; left unchanged";
      } catch {
        // not registered yet
      }
      execFileSync(claude, ["mcp", "add", "--scope", "user", "rango", "--", launch.command, ...launch.args], {
        stdio: "ignore",
      });
      return "Claude Code: MCP server rango registered (user scope)";
    },
  };
}

function cursorMcpStep(): Step {
  const path = join(homedir(), ".cursor", "mcp.json");
  return {
    kind: "mcp",
    description: `merge server "rango" into ${path}`,
    apply: () => {
      let config: { mcpServers?: Record<string, unknown> } = {};
      if (existsSync(path)) {
        try {
          config = JSON.parse(readFileSync(path, "utf8")) as typeof config;
        } catch {
          throw new CliError(`${path} is not valid JSON; fix it and rerun`, ExitCode.General);
        }
      }
      config.mcpServers ??= {};
      if (config.mcpServers["rango"]) return `Cursor already has server "rango" in ${path}; left unchanged`;
      config.mcpServers["rango"] = mcpLaunch();
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
      return `Cursor: server "rango" added to ${path}`;
    },
  };
}

function codexMcpStep(): Step {
  const path = join(homedir(), ".codex", "config.toml");
  return {
    kind: "mcp",
    description: `append [mcp_servers.rango] to ${path}`,
    apply: () => {
      const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
      if (/^\[mcp_servers\.rango\]/m.test(existing))
        return `Codex already has [mcp_servers.rango] in ${path}; left unchanged`;
      const launch = mcpLaunch();
      const block = `\n[mcp_servers.rango]\ncommand = "${launch.command}"\nargs = [${launch.args.map((a) => `"${a}"`).join(", ")}]\n`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${existing.trimEnd()}${existing ? "\n" : ""}${block}`);
      return `Codex: [mcp_servers.rango] appended to ${path}`;
    },
  };
}

function plan(client: ClientDef, scope: Scope, mcp: boolean, skills: boolean): Step[] {
  const steps: Step[] = [];
  if (mcp) {
    if (client.id === "claude-code") steps.push(claudeCodeMcpStep());
    if (client.id === "cursor") steps.push(cursorMcpStep());
    if (client.id === "codex") steps.push(codexMcpStep());
  }
  if (skills) steps.push(skillStep(client, scope));
  return steps;
}

function skillInstalled(client: ClientDef, scope: Scope): boolean {
  const base = scope === "global" ? join(homedir(), client.homeDir) : join(process.cwd(), client.localDir);
  return existsSync(join(base, client.skillsSubdir, "rango", "SKILL.md"));
}

function mcpConfigured(client: ClientDef): boolean | "unknown" {
  if (client.id === "cursor") {
    const path = join(homedir(), ".cursor", "mcp.json");
    if (!existsSync(path)) return false;
    try {
      return Boolean(
        (JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: Record<string, unknown> }).mcpServers?.[
          "rango"
        ],
      );
    } catch {
      return false;
    }
  }
  if (client.id === "codex") {
    const path = join(homedir(), ".codex", "config.toml");
    return existsSync(path) && /^\[mcp_servers\.rango\]/m.test(readFileSync(path, "utf8"));
  }
  const claude = which("claude");
  if (!claude) return "unknown";
  try {
    execFileSync(claude, ["mcp", "get", "rango"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function registerAgentCommand(program: Command): void {
  const agent = program
    .command("agent")
    .description("Set up AI coding agents with the Rango MCP server and skill");

  agent
    .command("setup")
    .description("Detect Claude Code, Cursor and Codex and give each the Rango MCP server and skill")
    .addOption(new Option("--client <id>", "Only this agent").choices(CLIENTS.map((c) => c.id)))
    .addOption(
      new Option("--scope <scope>", "Where the skill goes: the agent's home directory or this project")
        .choices(["global", "local"])
        .default("global"),
    )
    .option("--status", "Report what is detected and configured; change nothing")
    .option("--skills-only", "Install the skill, skip the MCP server")
    .option("--mcp-only", "Register the MCP server, skip the skill")
    .option("-y, --yes", "Do not ask before writing")
    .addHelpText(
      "after",
      `
Examples:
  $ rango agent setup --status
  $ rango agent setup -y
  $ rango agent setup --client cursor --skills-only --scope local

What it writes:
  Claude Code  claude mcp add --scope user rango -- rango mcp ; ~/.claude/skills/rango/SKILL.md
  Cursor       ~/.cursor/mcp.json (merged)                     ; ~/.cursor/skills/rango/SKILL.md
  Codex        ~/.codex/config.toml (appended)                 ; ~/.codex/skills/rango/SKILL.md
The API key is never written into an agent's config: rango mcp reads it like every other command.`,
    )
    .action(
      action(
        async (options: {
          client?: ClientId;
          scope: Scope;
          status?: boolean;
          skillsOnly?: boolean;
          mcpOnly?: boolean;
          yes?: boolean;
        }) => {
          const targets = CLIENTS.filter((c) => (options.client ? c.id === options.client : detect(c)));
          if (options.status) {
            const report = CLIENTS.map((c) => ({
              client: c.id,
              detected: detect(c),
              mcp: mcpConfigured(c),
              skill: skillInstalled(c, options.scope),
            }));
            if (isJsonMode()) return printJson({ launch: mcpLaunch(), clients: report });
            for (const r of report) {
              const mcp =
                r.mcp === "unknown"
                  ? "mcp: unknown (claude not on PATH)"
                  : `mcp: ${r.mcp ? "configured" : "not configured"}`;
              print(
                `${r.detected ? "+" : "-"} ${r.client.padEnd(12)} ${r.detected ? "detected    " : "not detected"}  ${mcp}  skill: ${r.skill ? "installed" : "missing"}`,
              );
            }
            return;
          }
          if (targets.length === 0) {
            throw invalidArgs(
              "No supported agent detected (Claude Code, Cursor, Codex)",
              "Pick one explicitly with --client <id>.",
            );
          }
          const plans = targets.map((c) => ({
            client: c,
            steps: plan(c, options.scope, !options.skillsOnly, !options.mcpOnly),
          }));
          if (!options.yes) {
            if (!isInteractive()) {
              if (isJsonMode()) {
                printJson({
                  planned: plans.map((p) => ({
                    client: p.client.id,
                    steps: p.steps.map((s) => s.description),
                  })),
                  applied: false,
                });
              } else {
                for (const p of plans) for (const s of p.steps) print(`${p.client.label}: ${s.description}`);
              }
              throw new CliError(
                "Nothing written: pass -y to apply this plan without a prompt",
                ExitCode.InvalidArgs,
              );
            }
            for (const p of plans) for (const s of p.steps) note(`${p.client.label}: ${s.description}`);
            if (!(await confirm("Apply these changes?"))) {
              throw new CliError("Cancelled; nothing written", ExitCode.General);
            }
          }
          const results: { client: ClientId; kind: string; result: string }[] = [];
          for (const p of plans) {
            for (const s of p.steps) results.push({ client: p.client.id, kind: s.kind, result: s.apply() });
          }
          if (isJsonMode()) return printJson({ applied: true, results });
          for (const r of results) print(r.result);
          print("\nSet the key once if you have not: rango auth set <key>");
        },
      ),
    );
}
