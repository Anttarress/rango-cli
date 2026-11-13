import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../test/helpers.js";
import { mcpLaunch, skillSource } from "./agent.js";

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
});

afterEach(() => {
  process.env["HOME"] = savedHome;
  process.env["PATH"] = savedPath;
  rmSync(home, { recursive: true, force: true });
});

describe("agent setup", () => {
  it("ships a skill file and falls back to npx when rango is not on PATH", () => {
    expect(readFileSync(skillSource(), "utf8")).toMatch(/^---\nname: rango/);
    expect(mcpLaunch()).toEqual({ command: "npx", args: ["-y", "@rango-dev/cli", "mcp"] });
  });

  it("status reports detection without writing anything", async () => {
    mkdirSync(join(home, ".cursor"));
    const r = await run(["agent", "setup", "--status"]);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    const cursor = report.clients.find((c: { client: string }) => c.client === "cursor");
    expect(cursor).toEqual({ client: "cursor", detected: true, mcp: false, skill: false });
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
});
