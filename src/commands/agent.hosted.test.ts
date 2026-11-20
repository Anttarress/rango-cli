import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishSkills, run } from "../test/helpers.js";

// The day Rango's hosted MCP server goes live, the only change is this one
// constant. These tests run the CLI as it will behave from then on.
const HOSTED = "https://mcp.rango.test/mcp";
vi.mock("../core/constants.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core/constants.js")>()),
  HOSTED_MCP_URL: "https://mcp.rango.test/mcp",
}));

let home: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rango-agent-hosted-"));
  for (const name of ["HOME", "PATH"]) saved[name] = process.env[name];
  process.env["HOME"] = home;
  process.env["PATH"] = join(home, "empty-bin"); // no claude, no rango on PATH
  mkdirSync(join(home, "empty-bin"));
  mkdirSync(join(home, ".cursor"));
  publishSkills();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [name, value] of Object.entries(saved)) process.env[name] = value;
  rmSync(home, { recursive: true, force: true });
});

const rango = () => JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).mcpServers.rango;

describe("agent setup once the hosted MCP server has a URL", () => {
  it("registers the hosted server by default", async () => {
    const status = JSON.parse((await run(["agent", "setup", "--status"])).stdout);
    expect(status.server).toEqual({ kind: "hosted", url: HOSTED });
    expect((await run(["agent", "setup", "-y"])).code).toBe(0);
    expect(rango()).toEqual({ url: HOSTED });
  });

  it("moves an agent that was set up before launch onto the hosted server", async () => {
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { rango: { command: "rango", args: ["mcp"] } } }),
    );
    const r = await run(["agent", "setup", "-y"]);
    expect(JSON.parse(r.stdout).results[0].result).toMatch(/now points to https:\/\/mcp\.rango\.test\/mcp/);
    expect(rango()).toEqual({ url: HOSTED });
  });

  it("--local still registers the server this CLI runs on the machine", async () => {
    await run(["agent", "setup", "--local", "-y"]);
    expect(rango()).toEqual({ command: "npx", args: ["-y", "@rango-dev/cli", "mcp"] });
  });
});
