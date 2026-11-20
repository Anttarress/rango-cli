import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKILLS_INDEX_URL } from "../core/constants.js";
import { checkboxPrompt, selectPrompt } from "../core/interactive.js";
import { mockFetch, publishSkills, run, SKILL_FILES } from "../test/helpers.js";
import { mcpLaunch } from "./agent.js";

// The menu itself is tested in core/interactive.test.ts; here it is a stub that
// answers with whatever the test says the user picked.
vi.mock("../core/interactive.js", () => ({
  checkboxPrompt: vi.fn(),
  selectPrompt: vi.fn(),
  whileShowing: (_text: string, work: () => unknown) => work(),
}));

const HOSTED = "https://mcp.rango.test/mcp";
const LOCAL = { command: "npx", args: ["-y", "@rango-dev/cli", "mcp"] };

let home: string;
let savedHome: string | undefined;
let savedPath: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rango-agent-"));
  savedHome = process.env["HOME"];
  savedPath = process.env["PATH"];
  process.env["HOME"] = home;
  process.env["PATH"] = join(home, "empty-bin"); // no claude, no rango on PATH
  mkdirSync(join(home, "empty-bin"));
  publishSkills(); // setup downloads the skills; this is the repository it finds
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env["HOME"] = savedHome;
  process.env["PATH"] = savedPath;
  rmSync(home, { recursive: true, force: true });
});

describe("agent setup", () => {
  it("launches the local server through npx when rango is not on PATH", () => {
    expect(mcpLaunch()).toEqual({ command: "npx", args: ["-y", "@rango-dev/cli", "mcp"] });
  });

  it("status reports detection without writing anything", async () => {
    mkdirSync(join(home, ".cursor"));
    const r = await run(["agent", "setup", "--status"]);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    const cursor = report.clients.find((c: { client: string }) => c.client === "cursor");
    expect(cursor).toEqual({ client: "cursor", detected: true, mcp: "none", skill: "missing" });
    expect(report.clients.find((c: { client: string }) => c.client === "claude-code").mcp).toBe("unknown");
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
  });

  it("refuses to write without -y when it cannot ask", async () => {
    mkdirSync(join(home, ".cursor"));
    const r = await run(["agent", "setup"]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout).applied).toBe(false);
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
  });

  it("merges Cursor's mcp.json and keeps other servers", async () => {
    mkdirSync(join(home, ".cursor"));
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "x" } } }),
    );
    const r = await run(["agent", "setup", "--client", "cursor", "-y"]);
    expect(r.code).toBe(0);
    const config = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
    expect(config.mcpServers.other).toEqual({ command: "x" });
    expect(config.mcpServers.rango).toEqual({ command: "npx", args: ["-y", "@rango-dev/cli", "mcp"] });
    expect(existsSync(join(home, ".cursor", "skills", "rango", "SKILL.md"))).toBe(true);
    const again = JSON.parse((await run(["agent", "setup", "--client", "cursor", "-y"])).stdout);
    expect(again.results.map((x: { result: string }) => x.result).join(" ")).toMatch(/left unchanged/);
  });

  it("appends to Codex's config.toml once and supports skills-only and local scope", async () => {
    mkdirSync(join(home, ".codex"));
    writeFileSync(join(home, ".codex", "config.toml"), 'model = "o3"\n');
    const r = await run(["agent", "setup", "--client", "codex", "-y", "--mcp-only"]);
    expect(r.code).toBe(0);
    const toml = readFileSync(join(home, ".codex", "config.toml"), "utf8");
    expect(toml).toMatch(/^model = "o3"/);
    expect(toml).toMatch(
      /\[mcp_servers\.rango\]\ncommand = "npx"\nargs = \["-y", "@rango-dev\/cli", "mcp"\]/,
    );
    expect(existsSync(join(home, ".codex", "skills", "rango", "SKILL.md"))).toBe(false);
    await run(["agent", "setup", "--client", "codex", "-y", "--mcp-only"]);
    expect(
      readFileSync(join(home, ".codex", "config.toml"), "utf8").match(/mcp_servers\.rango/g),
    ).toHaveLength(1);
    const cwd = process.cwd();
    const project = mkdtempSync(join(tmpdir(), "rango-project-"));
    process.chdir(project);
    try {
      const local = await run([
        "agent",
        "setup",
        "--client",
        "claude-code",
        "-y",
        "--skills-only",
        "--scope",
        "local",
      ]);
      expect(local.code).toBe(0);
      expect(existsSync(join(project, ".claude", "skills", "rango", "SKILL.md"))).toBe(true);
    } finally {
      process.chdir(cwd);
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("tells the user the claude command when the binary is missing", async () => {
    const r = await run(["agent", "setup", "--client", "claude-code", "-y", "--mcp-only"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).results[0].result).toMatch(
      /claude mcp add --scope user rango -- npx -y @rango-dev\/cli mcp/,
    );
  });

  it("accepts multiple --client values both comma-separated and repeated", async () => {
    mkdirSync(join(home, ".cursor"));
    mkdirSync(join(home, ".codex"));
    const comma = await run(["agent", "setup", "--client", "cursor,codex", "-y", "--mcp-only"]);
    expect(comma.code).toBe(0);
    const touched = JSON.parse(comma.stdout)
      .results.map((r: { client: string }) => r.client)
      .sort();
    expect(touched).toEqual(["codex", "cursor"]);

    const repeated = await run([
      "agent",
      "setup",
      "--client",
      "cursor",
      "--client",
      "codex",
      "-y",
      "--mcp-only",
    ]);
    expect(repeated.code).toBe(0);

    const bad = await run(["agent", "setup", "--client", "cursor,nope", "-y"]);
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toMatch(/Unknown --client/);
  });
});

describe("agent setup menu", () => {
  const prompt = vi.mocked(checkboxPrompt);
  const where = vi.mocked(selectPrompt);
  const saved: Record<string, string | undefined> = {};
  const SKILLS_ROW = {
    value: "shared",
    label: "Install Rango skills",
    detail: ".agents/skills",
    selected: false,
    divider: "OR",
  };
  let project: string;
  let cwd: string;

  /** Run the way a person at a terminal does: stdin and stdout are both terminals. */
  async function atTerminal(args: string[]) {
    const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      return await run([...args, "--no-color"], { tty: true });
    } finally {
      if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  }
  const offered = (call = 0) => prompt.mock.calls[call]?.[0].items;

  beforeEach(() => {
    prompt.mockReset();
    where.mockReset();
    cwd = process.cwd();
    project = mkdtempSync(join(tmpdir(), "rango-project-"));
    process.chdir(project);
    for (const name of ["RANGO_API_KEY", "XDG_CONFIG_HOME"]) saved[name] = process.env[name];
    process.env["RANGO_API_KEY"] = "test-key-00000000";
    process.env["XDG_CONFIG_HOME"] = join(home, "no-config");
    mkdirSync(join(home, ".cursor"));
    mkdirSync(join(home, ".codex"));
  });
  afterEach(() => {
    process.chdir(cwd);
    rmSync(project, { recursive: true, force: true });
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("offers the detected agents, sets up only the ones picked and reports one line each", async () => {
    prompt.mockResolvedValueOnce(["codex"]);
    const r = await atTerminal(["agent", "setup"]);
    expect(r.code).toBe(0);
    expect(prompt.mock.calls[0]?.[0].title).toBe("Select agents to set up with Rango:");
    expect(offered()).toEqual([
      { value: "cursor", label: "Cursor", detail: "not set up", selected: true },
      { value: "codex", label: "Codex", detail: "not set up", selected: true },
      SKILLS_ROW,
    ]);
    expect(r.stdout).toBe("✔ Codex");
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf8")).toMatch(/\[mcp_servers\.rango\]/);
    expect(existsSync(join(home, ".codex", "skills", "rango", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
    expect(existsSync(join(home, ".cursor", "skills"))).toBe(false);
  });

  it("installs the skill's reference file too, and notices when either file is stale", async () => {
    await run(["agent", "setup", "--client", "cursor", "-y"]);
    const installed = join(home, ".cursor", "skills", "rango");
    const reference = join(installed, "references", "REFERENCE.md");
    expect(readFileSync(reference, "utf8")).toBe(SKILL_FILES["references/REFERENCE.md"]);
    prompt.mockResolvedValue(null);
    await atTerminal(["agent", "setup"]);
    expect(offered(0)?.[0]?.detail).toBe("already set up");
    writeFileSync(reference, "an older reference");
    await atTerminal(["agent", "setup"]);
    expect(offered(1)?.[0]?.detail).toBe("skill out of date");
    rmSync(reference);
    await atTerminal(["agent", "setup"]);
    expect(offered(2)?.[0]?.detail).toBe("skill out of date");
  });

  it("leaves finished agents unchecked and writes nothing when nothing is picked", async () => {
    await run(["agent", "setup", "--client", "cursor,codex", "-y"]);
    const codexSkill = join(home, ".codex", "skills", "rango", "SKILL.md");
    writeFileSync(codexSkill, "an older skill");
    prompt.mockResolvedValueOnce([]);
    const r = await atTerminal(["agent", "setup"]);
    expect(offered()).toEqual([
      { value: "cursor", label: "Cursor", detail: "already set up", selected: false },
      { value: "codex", label: "Codex", detail: "skill out of date", selected: true },
      SKILLS_ROW,
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("Nothing selected. No changes made.");
    expect(readFileSync(codexSkill, "utf8")).toBe("an older skill");
  });

  it("names the missing half of a partly set up agent, and cancelling changes nothing", async () => {
    await run(["agent", "setup", "--client", "cursor", "-y", "--mcp-only"]);
    await run(["agent", "setup", "--client", "codex", "-y", "--skills-only"]);
    prompt.mockResolvedValue(null);
    const r = await atTerminal(["agent", "setup"]);
    expect(offered()?.map((item) => item.detail)).toEqual([
      "skill not installed",
      "MCP server not registered",
      ".agents/skills",
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("Canceled. No changes made.");
    expect(existsSync(join(home, ".cursor", "skills"))).toBe(false);
    expect(existsSync(join(home, ".codex", "config.toml"))).toBe(false);
    // With --skills-only the MCP server is not part of the question.
    await atTerminal(["agent", "setup", "--skills-only"]);
    expect(offered(1)?.map((item) => item.detail)).toEqual([
      "not set up",
      "already set up",
      ".agents/skills",
    ]);
  });

  it("prints what is left to do by hand, and where to put the key when none is set", async () => {
    mkdirSync(join(home, ".claude"));
    delete process.env["RANGO_API_KEY"];
    prompt.mockResolvedValueOnce(["claude-code"]);
    const r = await atTerminal(["agent", "setup"]);
    expect(r.code).toBe(0);
    expect(r.stdout.split("\n")).toEqual([
      "⚠ Claude Code: claude not found on PATH. Register the server yourself:",
      "  claude mcp add --scope user rango -- npx -y @rango-dev/cli mcp",
      "",
      "Set your API key next: rango auth set <key>",
    ]);
    expect(existsSync(join(home, ".claude", "skills", "rango", "SKILL.md"))).toBe(true);
  });

  it("offers to switch an agent that is on the other MCP server", async () => {
    await run(["agent", "setup", "--client", "cursor,codex", "-y"]);
    await run(["agent", "setup", "--client", "codex", "--mcp-only", "--mcp-url", HOSTED, "-y"]);
    prompt.mockResolvedValue(null);
    await atTerminal(["agent", "setup", "--mcp-url", HOSTED]);
    expect(offered(0)).toEqual([
      { value: "cursor", label: "Cursor", detail: "uses the local MCP server", selected: true },
      { value: "codex", label: "Codex", detail: "already set up", selected: false },
      SKILLS_ROW,
    ]);
    await atTerminal(["agent", "setup"]);
    expect(offered(1)?.map((item) => item.detail)).toEqual([
      "already set up",
      "uses another MCP server",
      ".agents/skills",
    ]);
  });

  it("does not ask for an API key when the agents use the hosted server", async () => {
    delete process.env["RANGO_API_KEY"];
    prompt.mockResolvedValueOnce(["cursor"]);
    const r = await atTerminal(["agent", "setup", "--mcp-url", HOSTED]);
    expect(r.stdout).toBe("✔ Cursor");
    expect(JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).mcpServers.rango).toEqual({
      url: HOSTED,
    });
  });

  it("installs the skills into the shared folder, asking the way Stripe does: project or global", async () => {
    prompt.mockResolvedValueOnce(["shared"]);
    where.mockResolvedValueOnce("local");
    const r = await atTerminal(["agent", "setup"]);
    expect(where.mock.calls[0]?.[0]).toEqual({
      title: "Install Rango skills where?",
      items: [
        { value: "local", label: "This project", detail: "./.agents/skills  (not installed)" },
        { value: "global", label: "Global", detail: "~/.agents/skills  (not installed)" },
      ],
      initial: 0,
    });
    expect(r.stdout).toBe("✔ Rango skills in ./.agents/skills");
    expect(existsSync(join(project, ".agents", "skills", "rango", "references", "REFERENCE.md"))).toBe(true);
    expect(existsSync(join(home, ".agents"))).toBe(false);
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
  });

  it("points the skills row and the question at a copy that is out of date", async () => {
    await run(["agent", "setup", "--client", "shared"]);
    writeFileSync(join(home, ".agents", "skills", "rango", "SKILL.md"), "an older skill");
    prompt.mockResolvedValueOnce(["shared"]);
    where.mockResolvedValueOnce("global");
    const r = await atTerminal(["agent", "setup"]);
    expect(offered()?.at(-1)).toEqual({
      ...SKILLS_ROW,
      detail: ".agents/skills · out of date",
      selected: true,
    });
    expect(where.mock.calls[0]?.[0]).toMatchObject({ title: "Update Rango skills where?", initial: 1 });
    expect(where.mock.calls[0]?.[0].items[1]?.detail).toBe("~/.agents/skills  (out of date)");
    expect(r.stdout).toBe("✔ Rango skills in ~/.agents/skills");
    expect(readFileSync(join(home, ".agents", "skills", "rango", "SKILL.md"), "utf8")).toMatch(
      /^---\nname: rango/,
    );
  });

  it("does not ask where when --scope says, and cancelling the question writes nothing", async () => {
    prompt.mockResolvedValueOnce(["cursor", "shared"]);
    const scoped = await atTerminal(["agent", "setup", "--scope", "local"]);
    expect(where).not.toHaveBeenCalled();
    expect(scoped.stdout.split("\n")).toEqual(["✔ Cursor", "✔ Rango skills in ./.agents/skills"]);

    prompt.mockResolvedValueOnce(["codex", "shared"]);
    where.mockResolvedValueOnce(null);
    const cancelled = await atTerminal(["agent", "setup"]);
    expect(cancelled.stdout).toBe("Canceled. No changes made.");
    expect(existsSync(join(home, ".codex", "config.toml"))).toBe(false);
    expect(existsSync(join(home, ".agents"))).toBe(false);
  });

  it("with no agent on the machine, still offers the skills", async () => {
    rmSync(join(home, ".cursor"), { recursive: true });
    rmSync(join(home, ".codex"), { recursive: true });
    where.mockResolvedValueOnce("global");
    const r = await atTerminal(["agent", "setup"]);
    expect(prompt).not.toHaveBeenCalled();
    expect(r.stdout.split("\n")).toEqual([
      "No supported agent detected (Claude Code, Cursor, Codex).",
      "You can still install the Rango skills.",
      "",
      "✔ Rango skills in ~/.agents/skills",
    ]);
    expect(existsSync(join(home, ".agents", "skills", "rango", "SKILL.md"))).toBe(true);
    expect((await atTerminal(["agent", "setup", "--mcp-only"])).code).toBe(2);
  });

  it("shows no menu when the skills cannot be downloaded, and says how to go on", async () => {
    mockFetch({});
    const r = await atTerminal(["agent", "setup"]);
    expect(r.code).toBe(5);
    expect(prompt).not.toHaveBeenCalled();
    expect(r.stderr.split("\n")).toEqual([
      `Error: Could not download the Rango skills: HTTP 404 for ${SKILLS_INDEX_URL}`,
      "  Run this again when the network is back, or set up the MCP server alone with --mcp-only.",
    ]);
    prompt.mockResolvedValueOnce(["cursor"]);
    expect((await atTerminal(["agent", "setup", "--mcp-only"])).stdout).toBe("✔ Cursor");
  });

  it("is skipped by -y, --client and --json, and when stdin is not a terminal", async () => {
    expect((await atTerminal(["agent", "setup", "-y"])).code).toBe(0);
    expect((await atTerminal(["agent", "setup", "--client", "cursor"])).code).toBe(0);
    expect((await atTerminal(["agent", "setup", "--json"])).code).toBe(2);
    expect((await run(["agent", "setup"], { tty: true })).code).toBe(2);
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe("agent setup with a hosted MCP server", () => {
  const cursorConfig = () => JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
  const codexConfig = () => readFileSync(join(home, ".codex", "config.toml"), "utf8");
  const results = (stdout: string) =>
    (JSON.parse(stdout).results as { result: string }[]).map((r) => r.result).join("\n");

  beforeEach(() => {
    mkdirSync(join(home, ".cursor"));
    mkdirSync(join(home, ".codex"));
  });

  it("--mcp-url registers the URL in each agent instead of a local command", async () => {
    mkdirSync(join(home, ".claude"));
    const r = await run(["agent", "setup", "--mcp-url", HOSTED, "--mcp-only", "-y"]);
    expect(r.code).toBe(0);
    expect(results(r.stdout)).toContain(`claude mcp add --scope user --transport http rango ${HOSTED}`);
    expect(cursorConfig().mcpServers.rango).toEqual({ url: HOSTED });
    expect(codexConfig()).toBe(`[mcp_servers.rango]\nurl = "${HOSTED}"\n`);
  });

  it("switches an agent between the local and the hosted server and keeps the rest of its config", async () => {
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "x" } } }),
    );
    const others = 'model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\nargs = ["[a]"]\n';
    writeFileSync(join(home, ".codex", "config.toml"), others);
    const setup = (...flags: string[]) =>
      run(["agent", "setup", "--client", "cursor,codex", "--mcp-only", "-y", ...flags]);

    await setup();
    expect(cursorConfig().mcpServers.rango).toEqual(LOCAL);

    const toHosted = await setup("--mcp-url", HOSTED);
    expect(results(toHosted.stdout).match(/now points to https:\/\/mcp\.rango\.test\/mcp/g)).toHaveLength(2);
    expect(cursorConfig().mcpServers).toEqual({ other: { command: "x" }, rango: { url: HOSTED } });
    expect(codexConfig()).toBe(`${others}\n[mcp_servers.rango]\nurl = "${HOSTED}"\n`);

    const again = await setup("--mcp-url", HOSTED);
    expect(results(again.stdout).match(/left unchanged/g)).toHaveLength(2);

    const toLocal = await setup("--local");
    expect(results(toLocal.stdout).match(/now points to npx -y @rango-dev\/cli mcp/g)).toHaveLength(2);
    expect(cursorConfig().mcpServers).toEqual({ other: { command: "x" }, rango: LOCAL });
    expect(codexConfig()).toBe(
      `${others}\n[mcp_servers.rango]\ncommand = "npx"\nargs = ["-y", "@rango-dev/cli", "mcp"]\n`,
    );
  });

  it("replaces a rango table in the middle of Codex's config, sub-tables included", async () => {
    writeFileSync(
      join(home, ".codex", "config.toml"),
      [
        'model = "o3"',
        "",
        "[mcp_servers.rango]",
        'command = "old"',
        "",
        "[mcp_servers.rango.env]",
        'A = "1"',
        "",
        "[mcp_servers.other]",
        'command = "x"',
        "",
      ].join("\n"),
    );
    await run(["agent", "setup", "--client", "codex", "--mcp-only", "--mcp-url", HOSTED, "-y"]);
    expect(codexConfig()).toBe(
      `model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.rango]\nurl = "${HOSTED}"\n`,
    );
  });

  it("refuses a URL that is not https, and --local together with --mcp-url", async () => {
    const plainHttp = await run(["agent", "setup", "--mcp-url", "http://mcp.rango.test/mcp", "-y"]);
    expect(plainHttp.code).not.toBe(0);
    expect(plainHttp.stderr).toMatch(/must use https/);
    expect((await run(["agent", "setup", "--mcp-url", "not a url", "-y"])).stderr).toMatch(/expected a URL/);
    const both = await run(["agent", "setup", "--mcp-url", HOSTED, "--local", "-y"]);
    expect(both.code).not.toBe(0);
    expect(both.stderr).toMatch(/cannot be used with/);
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
    // A server under development on this machine may be plain http.
    const dev = await run([
      "agent",
      "setup",
      "--client",
      "cursor",
      "--mcp-only",
      "--mcp-url",
      "http://localhost:8787/mcp",
      "-y",
    ]);
    expect(dev.code).toBe(0);
    expect(cursorConfig().mcpServers.rango).toEqual({ url: "http://localhost:8787/mcp" });
  });

  it("status says which server each agent uses and which one setup would register", async () => {
    await run(["agent", "setup", "--client", "cursor", "--mcp-only", "-y"]);
    await run(["agent", "setup", "--client", "codex", "--mcp-only", "--mcp-url", HOSTED, "-y"]);
    const report = JSON.parse((await run(["agent", "setup", "--status"])).stdout);
    expect(report.server).toEqual({ kind: "local", ...LOCAL });
    expect(report.clients).toEqual([
      { client: "claude-code", detected: false, mcp: "unknown", skill: "missing" },
      { client: "cursor", detected: true, mcp: "local", skill: "missing" },
      { client: "codex", detected: true, mcp: "hosted", mcpUrl: HOSTED, skill: "missing" },
    ]);
    const withUrl = JSON.parse((await run(["agent", "setup", "--status", "--mcp-url", HOSTED])).stdout);
    expect(withUrl.server).toEqual({ kind: "hosted", url: HOSTED });

    const text = (await run(["agent", "setup", "--status", "--no-color"], { tty: true })).stdout;
    expect(text).toMatch(/^Setup registers the local server: npx -y @rango-dev\/cli mcp/);
    expect(text).toMatch(/cursor +detected +mcp: local server +skill: not installed/);
    expect(text).toContain(`mcp: ${HOSTED}`);
    expect(existsSync(join(home, ".cursor", "skills"))).toBe(false);
  });
});

describe("agent setup and where the skills come from", () => {
  const INDEX = "https://skills.rango.test/.well-known/skills/index.json";
  const skillIn = (...folder: string[]) => join(...folder, "rango", "SKILL.md");
  let project: string;
  let cwd: string;

  beforeEach(() => {
    cwd = process.cwd();
    project = mkdtempSync(join(tmpdir(), "rango-project-"));
    process.chdir(project);
    mkdirSync(join(home, ".cursor"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.chdir(cwd);
    rmSync(project, { recursive: true, force: true });
  });

  it("--client shared installs into .agents/skills, at home or in the project, and nothing else", async () => {
    const global = await run(["agent", "setup", "--client", "shared"]);
    expect(JSON.parse(global.stdout).results).toEqual([
      {
        client: "shared",
        kind: "skill",
        result: `skill installed at ${join(home, ".agents", "skills", "rango")}`,
      },
    ]);
    expect(existsSync(skillIn(home, ".agents", "skills"))).toBe(true);
    expect((await run(["agent", "setup", "--client", "shared", "--scope", "local"])).code).toBe(0);
    expect(existsSync(skillIn(project, ".agents", "skills"))).toBe(true);
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
    expect((await run(["agent", "setup", "--client", "shared", "--mcp-only"])).code).toBe(2);
  });

  it("-y leaves the shared folder alone, and status reports it", async () => {
    await run(["agent", "setup", "-y"]);
    expect(existsSync(join(home, ".agents"))).toBe(false);
    await run(["agent", "setup", "--client", "shared"]);
    const status = JSON.parse((await run(["agent", "setup", "--status"])).stdout);
    expect(status.skills).toEqual({ source: SKILLS_INDEX_URL, project: "missing", global: "current" });
    const text = (await run(["agent", "setup", "--status", "--no-color"], { tty: true })).stdout;
    expect(text).toContain(`Skills come from ${SKILLS_INDEX_URL}`);
    expect(text).toMatch(/this project +\.\/\.agents\/skills +not installed/);
    expect(text).toMatch(/global +~\/\.agents\/skills +up to date/);
  });

  it("--skills-url installs what another index lists, for agents and the shared folder alike", async () => {
    publishSkills({ "SKILL.md": "published elsewhere" });
    const r = await run([
      "agent",
      "setup",
      "--client",
      "cursor,shared",
      "--skills-only",
      "--skills-url",
      INDEX,
    ]);
    expect(r.code).toBe(0);
    expect(readFileSync(skillIn(home, ".cursor", "skills"), "utf8")).toBe("published elsewhere");
    expect(readFileSync(skillIn(home, ".agents", "skills"), "utf8")).toBe("published elsewhere");
    const status = JSON.parse((await run(["agent", "setup", "--status", "--skills-url", INDEX])).stdout);
    expect(status.skills).toEqual({ source: INDEX, project: "missing", global: "current" });
    expect(status.clients[1]).toMatchObject({ client: "cursor", skill: "current" });
    // Measured against Rango's own repository, that copy is a different version.
    publishSkills();
    const ours = JSON.parse((await run(["agent", "setup", "--status"])).stdout);
    expect(ours.skills).toEqual({ source: SKILLS_INDEX_URL, project: "missing", global: "outdated" });
    expect(ours.clients[1]).toMatchObject({ client: "cursor", skill: "outdated" });
  });

  it("stops before writing anything when the skills cannot be downloaded", async () => {
    mockFetch({});
    const failed = `Could not download the Rango skills: HTTP 404 for ${SKILLS_INDEX_URL}`;
    const r = await run(["agent", "setup", "--client", "cursor,shared", "-y"]);
    expect(r.code).toBe(5);
    expect(JSON.parse(r.stderr)).toMatchObject({
      message: failed,
      hint: "Run this again when the network is back, or set up the MCP server alone with --mcp-only.",
    });
    expect(r.stdout).toBe("");
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
    expect(existsSync(join(home, ".agents"))).toBe(false);
    // With nothing but skills asked for, there is no MCP server to fall back on.
    const skillsOnly = await run(["agent", "setup", "--client", "cursor", "--skills-only", "-y"]);
    expect(JSON.parse(skillsOnly.stderr).hint).toBe("Run this again when the network is back.");
    // The MCP server does not need the skills.
    expect((await run(["agent", "setup", "--client", "cursor", "--mcp-only", "-y"])).code).toBe(0);
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(true);
  });

  it("status still answers when the skills cannot be downloaded, and says what it could not check", async () => {
    await run(["agent", "setup", "--client", "cursor", "-y"]);
    const offline = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    mockFetch({ "/skills/index.json": offline });
    const r = await run(["agent", "setup", "--status"]);
    expect(r.code).toBe(0);
    const status = JSON.parse(r.stdout);
    expect(status.skills).toEqual({
      source: SKILLS_INDEX_URL,
      unreachable: `ENOTFOUND for ${SKILLS_INDEX_URL}`,
      project: "unknown",
      global: "unknown",
    });
    expect(status.clients[1]).toEqual({ client: "cursor", detected: true, mcp: "local", skill: "unknown" });
    const text = (await run(["agent", "setup", "--status", "--no-color"], { tty: true })).stdout;
    expect(text).toMatch(/cursor +detected +mcp: local server +skill: not checked/);
    expect(text).toContain(
      `Skills come from ${SKILLS_INDEX_URL}\n  could not be downloaded: ENOTFOUND for ${SKILLS_INDEX_URL}`,
    );
  });

  it("refuses an index that is not served over https", async () => {
    expect(
      (await run(["agent", "setup", "--skills-url", "http://skills.rango.test/index.json"])).stderr,
    ).toMatch(/must use https/);
  });
});
