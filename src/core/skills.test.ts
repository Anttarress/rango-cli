import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch, publishSkills } from "../test/helpers.js";
import { installSkills, loadSkills, publishedSkills, skillsState } from "./skills.js";

const SITE = "https://skills.rango.test/main/skills";
const INDEX = `${SITE}/index.json`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rango-skills-"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const installed = (path: string) => readFileSync(join(dir, "rango", path), "utf8");

describe("the Rango skills", () => {
  it("are downloaded from beside the index, and the API key is not sent", async () => {
    process.env["RANGO_API_KEY"] = "test-key-00000000";
    const calls = publishSkills({ "SKILL.md": "the skill", "references/REFERENCE.md": "the reference" });
    const set = await publishedSkills(INDEX);
    expect(set.from).toBe(INDEX);
    expect(set.skills[0]?.files.map((file) => [file.path, file.content.toString()])).toEqual([
      ["SKILL.md", "the skill"],
      ["references/REFERENCE.md", "the reference"],
    ]);
    expect(calls.map((call) => call.url.href)).toEqual([
      INDEX,
      `${SITE}/rango/SKILL.md`,
      `${SITE}/rango/references/REFERENCE.md`,
    ]);
    expect(calls.some((call) => call.url.href.includes("test-key"))).toBe(false);
  });

  it("install into a folder per skill, and a changed copy shows as out of date", async () => {
    publishSkills({ "SKILL.md": "v1", "references/REFERENCE.md": "ref" });
    const v1 = await loadSkills(INDEX);
    expect(skillsState(v1, dir)).toBe("missing");
    expect(installSkills(v1, dir)).toEqual([join(dir, "rango")]);
    expect(installed("references/REFERENCE.md")).toBe("ref");
    expect(skillsState(v1, dir)).toBe("current");

    publishSkills({ "SKILL.md": "v2", "references/REFERENCE.md": "ref" });
    const v2 = await loadSkills(INDEX);
    expect(skillsState(v2, dir)).toBe("outdated");
    installSkills(v2, dir);
    expect(installed("SKILL.md")).toBe("v2");
    expect(skillsState(v2, dir)).toBe("current");

    rmSync(join(dir, "rango", "references"), { recursive: true });
    expect(skillsState(v2, dir)).toBe("outdated");
  });

  it("are refused when the index would write outside the skills folder", async () => {
    const bad: object[] = [
      { name: "../rango" },
      { name: "Rango Skill" },
      { files: ["SKILL.md", "../../.zshrc"] },
      { files: ["SKILL.md", "/etc/hosts"] },
      { files: ["SKILL.md", "a\\b.md"] },
      { files: ["SKILL.md", "C:/x.md"] },
      { files: ["references/REFERENCE.md"] },
      { files: "SKILL.md" },
    ];
    for (const entry of bad) {
      publishSkills({ "SKILL.md": "x" }, entry);
      await expect(publishedSkills(INDEX), JSON.stringify(entry)).rejects.toThrow(
        /cannot be installed safely/,
      );
    }
    mockFetch({ "/skills/index.json": { skills: [] } });
    await expect(publishedSkills(INDEX)).rejects.toThrow(/lists no skills/);
  });

  it("are all or nothing: with one file missing there are none, and the reason says which", async () => {
    mockFetch({
      "/skills/index.json": { skills: [{ name: "rango", description: "d", files: ["SKILL.md", "gone.md"] }] },
      "/skills/rango/SKILL.md": new Response("v1"),
    });
    expect(await loadSkills(INDEX)).toEqual({
      skills: [],
      from: INDEX,
      unreachable: `HTTP 404 for ${SITE}/rango/gone.md`,
    });
  });

  it("cannot be compared or installed when they cannot be downloaded", async () => {
    mockFetch({});
    const set = await loadSkills(INDEX);
    expect(set.unreachable).toBe(`HTTP 404 for ${INDEX}`);
    expect(skillsState(set, dir)).toBe("unknown");

    // A copy installed earlier may be older or newer; there is no telling, and it stays.
    mkdirSync(join(dir, "rango"));
    writeFileSync(join(dir, "rango", "SKILL.md"), "installed yesterday");
    expect(skillsState(set, dir)).toBe("unknown");
    expect(installSkills(set, dir)).toEqual([]);
    expect(installed("SKILL.md")).toBe("installed yesterday");
  });

  it("say what went wrong and for which URL, which fetch hides behind 'fetch failed'", async () => {
    const reason = async (index: unknown) => {
      mockFetch({ "/skills/index.json": index });
      return (await loadSkills(INDEX)).unreachable;
    };
    const offline = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    expect(await reason(offline)).toBe(`ENOTFOUND for ${INDEX}`);
    const slow = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    expect(await reason(slow)).toBe(`no answer in 10s for ${INDEX}`);
    expect(await reason(new Response("<html>a login page</html>"))).toBe(`${INDEX} is not JSON`);
    expect(await reason(new Response("null"))).toBe(`${INDEX} lists no skills`);
  });
});
