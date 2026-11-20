import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Command, InvalidArgumentError, Option } from "commander";
import { action } from "../core/command.js";
import { isLoopback, resolveApiKey } from "../core/config.js";
import { ExitCode, HOSTED_MCP_URL, SKILLS_INDEX_URL, SKILLS_REPO } from "../core/constants.js";
import { CliError, invalidArgs } from "../core/errors.js";
import { checkboxPrompt, selectPrompt, whileShowing } from "../core/interactive.js";
import { color, isInteractive, isJsonMode, print, printJson } from "../core/output.js";
import { installSkills, loadSkills, type SkillSet, type SkillsState, skillsState } from "../core/skills.js";

/**
 * `rango agent setup`: detect the coding agents on this machine and give each
 * one the Rango MCP server and the Rango skill. Modelled on `stripe agent setup`.
 *
 *   Claude Code  MCP via `claude mcp add` (user scope); skill in ~/.claude/skills
 *   Cursor       MCP merged into ~/.cursor/mcp.json;  skill in ~/.cursor/skills
 *   Codex        MCP written to ~/.codex/config.toml;  skill in ~/.codex/skills
 *
 * The MCP server an agent is pointed at is either Rango's hosted one (a URL) or
 * this CLI run on the user's machine (`rango mcp`); see mcpTarget. Neither puts
 * the API key in an agent's config: the hosted server needs none from the user,
 * and `rango mcp` reads it from RANGO_API_KEY or `rango auth set`.
 *
 * The skills are not part of this CLI. They are downloaded from Rango's skills
 * repository (SKILLS_REPO) when setup runs; see core/skills.ts.
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

/** Where agents reach the Rango MCP server: Rango's hosted one, or this CLI run on the user's machine. */
export type McpTarget = { kind: "hosted"; url: string } | { kind: "local"; command: string; args: string[] };

/** How an agent launches the local server: the installed binary, else npx. */
export function mcpLaunch(): { command: string; args: string[] } {
  return which("rango")
    ? { command: "rango", args: ["mcp"] }
    : { command: "npx", args: ["-y", "@rango-dev/cli", "mcp"] };
}

/**
 * The server setup registers. Hosted as soon as there is a URL for it
 * (--mcp-url, or HOSTED_MCP_URL once Rango's server is live); until then, and
 * with --local, the local one.
 */
export function mcpTarget(options: { local?: boolean; mcpUrl?: string } = {}): McpTarget {
  const url = options.local ? "" : (options.mcpUrl ?? HOSTED_MCP_URL);
  return url ? { kind: "hosted", url } : { kind: "local", ...mcpLaunch() };
}

const describeTarget = (target: McpTarget) =>
  target.kind === "hosted" ? target.url : [target.command, ...target.args].join(" ");

/** What an agent has registered under the name "rango". */
type McpEntry = { kind: "hosted"; url: string } | { kind: "local" };

/** A local entry is left alone whatever command it runs; a hosted one must be the same URL. */
function matches(entry: McpEntry | undefined, target: McpTarget): boolean {
  if (entry?.kind === "hosted") return target.kind === "hosted" && entry.url === target.url;
  return entry?.kind === target.kind;
}

function detect(client: ClientDef): boolean {
  if (existsSync(join(homedir(), client.homeDir))) return true;
  return client.id === "claude-code" && Boolean(which("claude"));
}

interface Step {
  kind: "mcp" | "skill";
  description: string;
  apply: () => string;
  /** The step could not finish on its own; its result tells the user what to do. */
  manual?: boolean;
}

/**
 * The folder agents share instead of each keeping its own: `.agents/skills`, in
 * the project or in the home folder. Codex, Cursor, Gemini CLI, GitHub Copilot
 * and others read it; `--client shared` and the menu's last row install there.
 */
const SHARED = { homeDir: ".agents", localDir: ".agents", skillsSubdir: "skills" };
const SHARED_DIR = { local: "./.agents/skills", global: "~/.agents/skills" };
const SCOPES: Scope[] = ["local", "global"];

/** Where a client, or the shared folder, keeps skills. */
function skillsDir(owner: typeof SHARED, scope: Scope): string {
  const base = scope === "global" ? join(homedir(), owner.homeDir) : join(process.cwd(), owner.localDir);
  return join(base, owner.skillsSubdir);
}

function skillStep(dir: string, set: SkillSet): Step {
  return {
    kind: "skill",
    description: `write skill ${set.skills.map((skill) => join(dir, skill.name)).join(", ")}`,
    apply: () => `skill installed at ${installSkills(set, dir).join(", ")}`,
  };
}

function claudeEntry(claude: string): McpEntry | undefined {
  let report: string;
  try {
    report = execFileSync(claude, ["mcp", "get", "rango"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined; // no server named rango
  }
  const url = /^\s*URL:\s*(\S+)/m.exec(report)?.[1];
  return url ? { kind: "hosted", url } : { kind: "local" };
}

function claudeCodeMcpStep(target: McpTarget): Step {
  const claude = which("claude");
  const add =
    target.kind === "hosted"
      ? ["mcp", "add", "--scope", "user", "--transport", "http", "rango", target.url]
      : ["mcp", "add", "--scope", "user", "rango", "--", target.command, ...target.args];
  const command = `claude ${add.join(" ")}`;
  if (!claude) {
    return {
      kind: "mcp",
      description: "Claude Code: print the command to register the MCP server (claude binary not on PATH)",
      manual: true,
      apply: () => `claude not found on PATH. Register the server yourself:\n  ${command}`,
    };
  }
  return {
    kind: "mcp",
    description: `run: ${command}`,
    apply: () => {
      const entry = claudeEntry(claude);
      if (matches(entry, target)) return "Claude Code already has an MCP server named rango; left unchanged";
      if (entry) {
        try {
          execFileSync(claude, ["mcp", "remove", "rango", "--scope", "user"], { stdio: "ignore" });
        } catch {
          throw new CliError(
            "Claude Code has an MCP server named rango outside the user scope",
            ExitCode.General,
            "Remove it with: claude mcp remove rango   then run setup again.",
          );
        }
      }
      execFileSync(claude, add, { stdio: "ignore" });
      return entry
        ? `Claude Code: MCP server rango now points to ${describeTarget(target)}`
        : "Claude Code: MCP server rango registered (user scope)";
    },
  };
}

const cursorConfigPath = () => join(homedir(), ".cursor", "mcp.json");

function readCursorConfig(path: string): { mcpServers?: Record<string, unknown> } {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: Record<string, unknown> };
  } catch {
    throw new CliError(`${path} is not valid JSON; fix it and rerun`, ExitCode.General);
  }
}

function cursorEntry(server: unknown): McpEntry | undefined {
  if (!server || typeof server !== "object") return undefined;
  const url = (server as { url?: unknown }).url;
  return typeof url === "string" ? { kind: "hosted", url } : { kind: "local" };
}

function cursorMcpStep(target: McpTarget): Step {
  const path = cursorConfigPath();
  return {
    kind: "mcp",
    description: `merge server "rango" into ${path}`,
    apply: () => {
      const config = readCursorConfig(path);
      config.mcpServers ??= {};
      const entry = cursorEntry(config.mcpServers["rango"]);
      if (matches(entry, target)) return `Cursor already has server "rango" in ${path}; left unchanged`;
      config.mcpServers["rango"] =
        target.kind === "hosted" ? { url: target.url } : { command: target.command, args: target.args };
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
      return entry
        ? `Cursor: server "rango" in ${path} now points to ${describeTarget(target)}`
        : `Cursor: server "rango" added to ${path}`;
    },
  };
}

const codexConfigPath = () => join(homedir(), ".codex", "config.toml");

/** Split config.toml into the [mcp_servers.rango] table, with its sub-tables, and everything else. */
function splitCodexConfig(text: string): { table: string[]; rest: string[] } {
  const table: string[] = [];
  const rest: string[] = [];
  let inside = false;
  for (const line of text.split("\n")) {
    if (/^\s*\[/.test(line)) inside = /^\[mcp_servers\.rango(\.[^\]]*)?\]$/.test(line.trim());
    (inside ? table : rest).push(line);
  }
  return { table, rest };
}

function codexEntry(table: string[]): McpEntry | undefined {
  if (table.length === 0) return undefined;
  const url = table.map((line) => /^\s*url\s*=\s*"([^"]*)"/.exec(line)?.[1]).find(Boolean);
  return url ? { kind: "hosted", url } : { kind: "local" };
}

function codexMcpStep(target: McpTarget): Step {
  const path = codexConfigPath();
  return {
    kind: "mcp",
    description: `write [mcp_servers.rango] to ${path}`,
    apply: () => {
      const { table, rest } = splitCodexConfig(existsSync(path) ? readFileSync(path, "utf8") : "");
      const entry = codexEntry(table);
      if (matches(entry, target)) return `Codex already has [mcp_servers.rango] in ${path}; left unchanged`;
      const settings =
        target.kind === "hosted"
          ? `url = "${target.url}"`
          : `command = "${target.command}"\nargs = [${target.args.map((a) => `"${a}"`).join(", ")}]`;
      const kept = rest.join("\n").trimEnd();
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${kept}${kept ? "\n\n" : ""}[mcp_servers.rango]\n${settings}\n`);
      return entry
        ? `Codex: [mcp_servers.rango] in ${path} now points to ${describeTarget(target)}`
        : `Codex: [mcp_servers.rango] appended to ${path}`;
    },
  };
}

function plan(
  client: ClientDef,
  scope: Scope,
  want: { mcp: boolean; skills: boolean },
  target: McpTarget,
  set: SkillSet,
): Step[] {
  const steps: Step[] = [];
  if (want.mcp) {
    if (client.id === "claude-code") steps.push(claudeCodeMcpStep(target));
    if (client.id === "cursor") steps.push(cursorMcpStep(target));
    if (client.id === "codex") steps.push(codexMcpStep(target));
  }
  if (want.skills) steps.push(skillStep(skillsDir(client, scope), set));
  return steps;
}

/** The server an agent has under the name "rango"; "unknown" when only the missing claude binary could tell. */
function mcpEntry(client: ClientDef): McpEntry | "unknown" | undefined {
  if (client.id === "cursor") {
    try {
      return cursorEntry(readCursorConfig(cursorConfigPath()).mcpServers?.["rango"]);
    } catch {
      return undefined;
    }
  }
  if (client.id === "codex") {
    const path = codexConfigPath();
    return existsSync(path) ? codexEntry(splitCodexConfig(readFileSync(path, "utf8")).table) : undefined;
  }
  const claude = which("claude");
  return claude ? claudeEntry(claude) : "unknown";
}

/**
 * What the setup menu says about a client, and whether anything is left to do
 * for it. Only the parts being set up count (--mcp-only, --skills-only).
 */
function setupState(
  client: ClientDef,
  scope: Scope,
  want: { mcp: boolean; skills: boolean },
  target: McpTarget,
  set: SkillSet,
): { detail: string; complete: boolean } {
  const entry = want.mcp ? mcpEntry(client) : undefined;
  const registered = entry === "unknown" ? undefined : entry;
  const mcpMissing = want.mcp && !registered;
  const mcpElsewhere = registered !== undefined && !matches(registered, target);
  const skill = want.skills ? skillsState(set, skillsDir(client, scope)) : "current";
  if (!mcpMissing && !mcpElsewhere && skill === "current")
    return { detail: "already set up", complete: true };
  const nothingYet = (mcpMissing || !want.mcp) && (skill === "missing" || !want.skills);
  if (nothingYet) return { detail: "not set up", complete: false };
  if (mcpMissing) return { detail: "MCP server not registered", complete: false };
  if (mcpElsewhere) {
    const detail = registered?.kind === "local" ? "uses the local MCP server" : "uses another MCP server";
    return { detail, complete: false };
  }
  return { detail: skill === "missing" ? "skill not installed" : "skill out of date", complete: false };
}

/** An https URL; plain http only for a server on this machine. */
function parseHttpsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidArgumentError("expected a URL such as https://host/path");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url))) {
    throw new InvalidArgumentError("the URL must use https");
  }
  return url.href;
}

/** `--client` takes the agents, and "shared" for the shared skills folder. */
type Target = ClientId | "shared";

const NO_SKILLS: SkillSet = { skills: [], from: "" };
const STATE_TEXT: Record<SkillsState, string> = {
  missing: "not installed",
  outdated: "out of date",
  current: "up to date",
  unknown: "not checked",
};

export function registerAgentCommand(program: Command): void {
  const agent = program
    .command("agent")
    .description("Set up AI coding agents with the Rango MCP server and skill");

  const allowed: Target[] = [...CLIENTS.map((c) => c.id), "shared"];
  const parseClientList = (value: string, previous: Target[] | undefined): Target[] => {
    const parts = value
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const invalid = parts.filter((p) => !allowed.includes(p as Target));
    if (invalid.length > 0) {
      throw new InvalidArgumentError(
        `Unknown --client value(s): ${invalid.join(", ")}. Allowed: ${allowed.join(", ")}`,
      );
    }
    return [...(previous ?? []), ...(parts as Target[])];
  };

  agent
    .command("setup")
    .description("Detect Claude Code, Cursor and Codex and give each the Rango MCP server and skill")
    .option(
      "--client <ids>",
      `Limit to these (repeatable or comma-separated: ${allowed.join(", ")}); "shared" is the .agents/skills folder`,
      parseClientList,
    )
    .addOption(
      new Option(
        "--scope <scope>",
        "Where skills go: your home folder (global, the default) or this project (local)",
      ).choices(["global", "local"]),
    )
    .addOption(
      new Option("--mcp-url <url>", "Register a hosted Rango MCP server at this URL instead of the local one")
        .argParser(parseHttpsUrl)
        .conflicts("local"),
    )
    .addOption(
      new Option("--local", "Register the MCP server this CLI runs on your machine (rango mcp)").conflicts(
        "mcpUrl",
      ),
    )
    .addOption(
      new Option(
        "--skills-url <url>",
        "Install the skills this index.json lists instead of the ones in Rango's skills repository",
      ).argParser(parseHttpsUrl),
    )
    .option("--status", "Report what is detected and configured; change nothing")
    .option("--skills-only", "Install the skill, skip the MCP server")
    .option("--mcp-only", "Register the MCP server, skip the skill")
    .option("-y, --yes", "Do not ask before writing")
    .addHelpText(
      "after",
      `
Examples:
  $ rango agent setup                # pick agents from a menu: space toggles, enter applies
  $ rango agent setup --status
  $ rango agent setup -y
  $ rango agent setup --client cursor --skills-only --scope local
  $ rango agent setup --client claude-code,cursor -y
  $ rango agent setup --client claude-code --client codex -y
  $ rango agent setup --client shared --scope local
  $ rango agent setup --mcp-url https://mcp.example.com/mcp -y

What it writes:
  Claude Code  claude mcp add --scope user rango ...  ; ~/.claude/skills/rango
  Cursor       ~/.cursor/mcp.json (merged)            ; ~/.cursor/skills/rango
  Codex        ~/.codex/config.toml                   ; ~/.codex/skills/rango
  shared       nothing                                ; ~/.agents/skills/rango

Which MCP server: the one this CLI runs on your machine (rango mcp), or a hosted
Rango MCP server when a URL is given with --mcp-url. An agent already pointed at
the other one is switched. "rango agent setup --status" shows which is in use.
The API key is never written into an agent's config.

Which skills: Rango's, downloaded each time setup runs from
github.com/${SKILLS_REPO}, the repository that
"npx skills add ${SKILLS_REPO}" installs from too; or the ones another
index lists, with --skills-url. "shared" (the menu's "Install Rango skills") is
the .agents/skills folder that Codex, Cursor, Gemini CLI, GitHub Copilot and
others read in a project.`,
    )
    .action(
      action(
        async (options: {
          client?: Target[];
          scope?: Scope;
          mcpUrl?: string;
          local?: boolean;
          skillsUrl?: string;
          status?: boolean;
          skillsOnly?: boolean;
          mcpOnly?: boolean;
          yes?: boolean;
        }) => {
          const target = mcpTarget(options);
          const scope = options.scope ?? "global";
          const want = { mcp: !options.skillsOnly, skills: !options.mcpOnly };
          const named = options.client;
          const agents = named ? CLIENTS.filter((c) => named.includes(c.id)) : CLIENTS.filter(detect);

          // --client and -y say what to do up front. Otherwise a person at a
          // terminal picks from a menu, and picking is the consent; with no
          // terminal the plan is printed and nothing is written.
          const useMenu = !named && !options.yes && !options.status && isInteractive() && !isJsonMode();
          const checking = <T>(work: () => T): T =>
            useMenu ? whileShowing("Checking agents...", work) : work();

          const set =
            want.skills || options.status
              ? await checking(() => loadSkills(options.skillsUrl ?? SKILLS_INDEX_URL))
              : NO_SKILLS;
          // Without the skills there is nothing to install and nothing to tell an old copy
          // from, so setup stops here rather than do half of what was asked.
          if (set.unreachable && !options.status) {
            const retry = "Run this again when the network is back";
            throw new CliError(
              `Could not download the Rango skills: ${set.unreachable}`,
              ExitCode.NetworkError,
              want.mcp ? `${retry}, or set up the MCP server alone with --mcp-only.` : `${retry}.`,
            );
          }
          const sharedState = {
            local: skillsState(set, skillsDir(SHARED, "local")),
            global: skillsState(set, skillsDir(SHARED, "global")),
          };

          if (options.status) {
            const report = CLIENTS.map((c) => {
              const entry = mcpEntry(c);
              const mcp: "unknown" | "none" | "local" | "hosted" =
                entry === "unknown" ? "unknown" : (entry?.kind ?? "none");
              return {
                client: c.id,
                detected: detect(c),
                mcp,
                ...(entry !== "unknown" && entry?.kind === "hosted" ? { mcpUrl: entry.url } : {}),
                skill: skillsState(set, skillsDir(c, scope)),
              };
            });
            const skills = {
              source: set.from,
              ...(set.unreachable ? { unreachable: set.unreachable } : {}),
              project: sharedState.local,
              global: sharedState.global,
            };
            if (isJsonMode()) return printJson({ server: target, clients: report, skills });
            const where = target.kind === "hosted" ? "hosted server" : "local server";
            print(`Setup registers the ${where}: ${describeTarget(target)}\n`);
            const mcpText = {
              unknown: "unknown (claude not on PATH)",
              none: "not configured",
              local: "local server",
              hosted: "hosted server",
            };
            for (const r of report) {
              print(
                `${r.detected ? "+" : "-"} ${r.client.padEnd(12)} ${r.detected ? "detected    " : "not detected"}  mcp: ${r.mcpUrl ?? mcpText[r.mcp]}  skill: ${STATE_TEXT[r.skill]}`,
              );
            }
            print(`\nSkills come from ${set.from}`);
            if (set.unreachable) print(`  could not be downloaded: ${set.unreachable}`);
            print(`  this project  ${SHARED_DIR.local}  ${STATE_TEXT[sharedState.local]}`);
            print(`  global        ${SHARED_DIR.global}  ${STATE_TEXT[sharedState.global]}`);
            return;
          }

          let sharedScope: Scope | undefined = named?.includes("shared") ? scope : undefined;
          if (sharedScope && !want.skills) {
            throw invalidArgs("--mcp-only leaves nothing to do for the shared skills folder");
          }
          const offerShared = useMenu && want.skills;
          if (agents.length === 0 && !sharedScope && !offerShared) {
            throw invalidArgs(
              "No supported agent detected (Claude Code, Cursor, Codex)",
              "Pick one explicitly with --client <id>.",
            );
          }

          let chosen = agents;
          if (useMenu) {
            const outdated = Object.values(sharedState).includes("outdated");
            const have = Object.values(sharedState).includes("current") ? "installed" : "";
            let picked: Target[] | null;
            if (agents.length === 0) {
              print("No supported agent detected (Claude Code, Cursor, Codex).");
              print("You can still install the Rango skills.\n");
              picked = ["shared"];
            } else {
              const states = checking(() => agents.map((c) => setupState(c, scope, want, target, set)));
              const skillsRow = {
                value: "shared" as Target,
                label: "Install Rango skills",
                detail: [".agents/skills", outdated ? "out of date" : have].filter(Boolean).join(" · "),
                selected: outdated,
                divider: "OR",
              };
              picked = await checkboxPrompt<Target>({
                title: "Select agents to set up with Rango:",
                items: [
                  ...agents.map((c, i) => ({
                    value: c.id as Target,
                    label: c.label,
                    detail: states[i]?.detail,
                    selected: !states[i]?.complete,
                  })),
                  ...(offerShared ? [skillsRow] : []),
                ],
              });
            }
            if (picked === null) return print("Canceled. No changes made.");
            if (picked.length === 0) return print("Nothing selected. No changes made.");
            const wanted = picked;
            chosen = agents.filter((c) => wanted.includes(c.id));
            if (wanted.includes("shared")) {
              // Asked the way Stripe asks: this project or everywhere, starting on the one that needs it.
              const first = (state: SkillsState) => SCOPES.findIndex((s) => sharedState[s] === state);
              const where =
                options.scope ??
                (await selectPrompt<Scope>({
                  title: outdated ? "Update Rango skills where?" : "Install Rango skills where?",
                  items: SCOPES.map((s) => ({
                    value: s,
                    label: s === "local" ? "This project" : "Global",
                    detail: `${SHARED_DIR[s]}  (${STATE_TEXT[sharedState[s]]})`,
                  })),
                  initial: [first("outdated"), first("missing")].find((i) => i >= 0) ?? 0,
                }));
              if (where === null) return print("Canceled. No changes made.");
              sharedScope = where;
            }
          }

          const plans: { client: { id: Target; label: string }; steps: Step[] }[] = chosen.map((c) => ({
            client: c,
            steps: plan(c, scope, want, target, set),
          }));
          if (sharedScope) {
            plans.push({
              client: { id: "shared", label: `Rango skills in ${SHARED_DIR[sharedScope]}` },
              steps: [skillStep(skillsDir(SHARED, sharedScope), set)],
            });
          }
          if (!useMenu && !named && !options.yes) {
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

          // Only the local server reads the user's key; the hosted one needs none.
          const needsKey = want.mcp && chosen.length > 0 && target.kind === "local" && !resolveApiKey();
          const results: { client: Target; kind: string; result: string }[] = [];
          for (const p of plans) {
            const apply = () => p.steps.map((step) => ({ step, result: step.apply() }));
            const done = useMenu ? whileShowing(`Setting up ${p.client.label}...`, apply) : apply();
            for (const d of done) results.push({ client: p.client.id, kind: d.step.kind, result: d.result });
            if (useMenu) {
              // After the menu: one line per choice, or what is left for the user to do by hand.
              const manual = done.filter((d) => d.step.manual).map((d) => d.result);
              print(
                manual.length
                  ? `${color.yellow("⚠")} ${p.client.label}: ${manual.join("\n")}`
                  : `${color.green("✔")} ${p.client.label}`,
              );
            }
          }
          if (useMenu) {
            if (needsKey) print("\nSet your API key next: rango auth set <key>");
            return;
          }
          if (isJsonMode()) return printJson({ applied: true, results });
          for (const r of results) print(r.result);
          if (needsKey) print("\nSet your API key next: rango auth set <key>");
        },
      ),
    );
}
