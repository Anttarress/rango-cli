import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../bin/rango.js";
import { operations, toolName } from "../catalog/index.js";
import { setOverrides } from "../core/config.js";
import { META_ETH, mockFetch, run, sample } from "./helpers.js";

/**
 * The skills are documentation an agent acts on, so a command, flag, tool or
 * endpoint they name has to exist in this CLI. They live in their own
 * repository (SKILLS_REPO); these tests read a checkout of it and check its
 * Markdown against the program and the catalogue.
 *
 * The checkout is the folder RANGO_SKILLS_DIR names, which is how CI passes it,
 * or else the skills repository cloned next to this one. With neither, there is
 * nothing to read and the tests are skipped.
 */

const asked = process.env["RANGO_SKILLS_DIR"];
const SKILLS_DIR = asked ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../rango-skills/skills");
const checkedOut = existsSync(SKILLS_DIR);
if (asked && !checkedOut) throw new Error(`RANGO_SKILLS_DIR is ${asked}, and there is no such folder`);

function markdownUnder(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return markdownUnder(join(dir, entry.name), `${prefix}${entry.name}/`);
    return entry.name.endsWith(".md") ? [`${prefix}${entry.name}`] : [];
  });
}

const files = checkedOut ? markdownUnder(SKILLS_DIR) : [];
const read = (file: string) => readFileSync(join(SKILLS_DIR, file), "utf8");
const everything = files.map(read).join("\n");
const REFERENCE = "rango/references/REFERENCE.md";

const program = createProgram();

function walk(cmd: Command, visit: (cmd: Command) => void): void {
  visit(cmd);
  for (const sub of cmd.commands) walk(sub, visit);
}

/** Code fences of a file: their language and their lines. */
function fences(text: string): { lang: string; lines: string[] }[] {
  const found: { lang: string; lines: string[] }[] = [];
  let open: { lang: string; lines: string[] } | undefined;
  for (const line of text.split("\n")) {
    const fence = /^\s*```(\S*)\s*$/.exec(line);
    if (!fence) {
      open?.lines.push(line);
    } else if (open) {
      open = undefined;
    } else {
      open = { lang: fence[1] ?? "", lines: [] };
      found.push(open);
    }
  }
  return found;
}

/** `rango …` command lines in the bash fences: continuations joined, comments dropped. */
function commandLines(text: string): string[] {
  return fences(text)
    .filter((fence) => fence.lang === "bash")
    .flatMap((fence) => fence.lines.join("\n").replace(/\\\n/g, " ").split("\n"))
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter((line) => line.startsWith("rango "));
}

function shellWords(line: string): string[] {
  return Array.from(line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g), (m) => m[1] ?? m[2] ?? m[3] ?? "");
}

/** Every `rango …` mention: command lines in fences, and inline code spans. */
function mentions(text: string): string[] {
  const spans = Array.from(text.matchAll(/`(rango [^`]+)`/g), (m) => m[1] ?? "");
  return [...commandLines(text), ...spans];
}

/** The first word of a mention that should be a subcommand and is not, if any. */
function unknownCommand(mention: string): string | undefined {
  let cmd: Command = program;
  for (const word of shellWords(mention).slice(1)) {
    if (cmd.commands.length === 0 || !/^[a-z][a-z-]*$/.test(word)) return undefined;
    const sub = cmd.commands.find((c) => c.name() === word);
    if (!sub) return word;
    cmd = sub;
  }
  return undefined;
}

describe.skipIf(!checkedOut)(`the skills in ${SKILLS_DIR}`, () => {
  it("are the Rango skill and its reference", () => {
    expect(files).toContain("rango/SKILL.md");
    expect(files).toContain(REFERENCE);
  });

  it("name only flags the CLI has", () => {
    const known = new Set(["--help", "--version"]);
    walk(program, (cmd) => {
      for (const option of cmd.options) if (option.long) known.add(option.long);
    });
    const used = new Set(Array.from(everything.matchAll(/(?<![\w-])--[a-z][a-z0-9-]*/g), (m) => m[0]));
    expect(Array.from(used).filter((flag) => !known.has(flag))).toEqual([]);
    expect(used.size).toBeGreaterThan(15);
  });

  it("name only commands the CLI has", () => {
    const all = mentions(everything);
    expect(all.length).toBeGreaterThan(30);
    expect(all.filter((mention) => unknownCommand(mention))).toEqual([]);
    // The check itself has to catch a command that was removed.
    expect(unknownCommand("rango token ETH USDC")).toBe("token");
    expect(unknownCommand("rango basic is-approved --request-id <id>")).toBe("is-approved");
  });

  it("name only MCP tools the server offers, and every one of them", () => {
    const tools = new Set(operations.map(toolName));
    const named = new Set(Array.from(everything.matchAll(/\b(?:basic|main)_[a-z_]+\b/g), (m) => m[0]));
    expect(Array.from(named).filter((tool) => !tools.has(tool))).toEqual([]);
    expect(Array.from(tools).filter((tool) => !named.has(tool))).toEqual([]);
  });

  it("list every operation in the reference with its real method, path, command and tool", () => {
    const rows = read(REFERENCE)
      .split("\n")
      .filter((line) => /^\| `(GET|POST) \//.test(line));
    expect(rows).toHaveLength(operations.length);
    for (const op of operations) {
      const spec = op.request(sample(op.input, "") as never);
      const call = `\`${spec.method} ${decodeURIComponent(spec.path)}\``;
      const row = rows.find((line) => line.startsWith(`| ${call} |`));
      expect(row, `${op.surface} ${op.name}: no row for ${call}`).toBeDefined();
      expect(row).toContain(`\`rango ${op.surface} ${op.name}\``);
      expect(row).toContain(`\`${toolName(op)}\``);
    }
  });
});

describe.skipIf(!checkedOut)("the commands the skills show", () => {
  beforeEach(() => {
    process.env["RANGO_API_KEY"] = "test-key-00000000";
    process.env["XDG_CONFIG_HOME"] = "/nonexistent/for/test";
    setOverrides({});
    // Token lookups need a token list; everything else only has to be accepted.
    mockFetch({ "/basic/meta": META_ETH, "": {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  const lines = files.filter((file) => file.endsWith("SKILL.md")).flatMap((file) => commandLines(read(file)));

  it("are there to be run", () => {
    expect(lines.length).toBeGreaterThanOrEqual(10);
  });

  it.each(lines)("%s", async (line) => {
    const result = await run(shellWords(line).slice(1));
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  });
});
