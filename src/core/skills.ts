import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The Rango skills and how they reach a skills folder. They live in their own
 * repository (SKILLS_REPO), a folder per skill holding SKILL.md and whatever it
 * links to, with an index.json beside the folders that lists them: the layout
 * Stripe publishes its skills in. The CLI carries no copy that could go stale;
 * `rango agent setup` downloads them each time it runs.
 */

export interface Skill {
  name: string;
  files: { path: string; content: Buffer }[];
}

export interface SkillSet {
  skills: Skill[];
  /** The index they were asked from. */
  from: string;
  /** Why the index or a file it lists could not be downloaded; there are then no skills. */
  unreachable?: string;
}

/** "unknown" when the skills could not be downloaded, so there is nothing to compare a folder with. */
export type SkillsState = "missing" | "outdated" | "current" | "unknown";

// An index is remote input that decides where files are written, so a name is
// one plain folder and a file stays inside it: no absolute path, no "..".
const SAFE_NAME = /^[a-z0-9-]+$/;
const isSafeFile = (path: unknown): path is string =>
  typeof path === "string" && path !== "" && !/^[/\\]|^[A-Za-z]:|\\|(^|\/)\.\.?(\/|$)/.test(path);

const TIMEOUT_MS = 10_000;

/** Fetch one file; a failure says what went wrong and for which URL. */
async function download(url: string): Promise<Buffer> {
  let response: Response;
  try {
    // Plain fetch on purpose: this is not the Rango API and must never see the API key.
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    // fetch() says only "fetch failed"; what went wrong (ENOTFOUND, a refused connection) is in its cause.
    const failure = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
    const what =
      failure.name === "TimeoutError"
        ? `no answer in ${TIMEOUT_MS / 1000}s`
        : (failure.cause?.code ?? failure.cause?.message ?? failure.message ?? "network error");
    throw new Error(`${what} for ${url}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Download every skill an index lists; files sit beside the index as <skill>/<file>. All or nothing. */
export async function publishedSkills(indexUrl: string): Promise<SkillSet> {
  const text = (await download(indexUrl)).toString("utf8");
  let index: { skills?: unknown };
  try {
    index = JSON.parse(text) as { skills?: unknown };
  } catch {
    throw new Error(`${indexUrl} is not JSON`);
  }
  const entries = Array.isArray(index?.skills) ? index.skills : [];
  if (entries.length === 0) throw new Error(`${indexUrl} lists no skills`);
  const skills = await Promise.all(
    entries.map(async (entry: { name?: unknown; files?: unknown }): Promise<Skill> => {
      const { name, files } = entry;
      const usable =
        typeof name === "string" &&
        SAFE_NAME.test(name) &&
        Array.isArray(files) &&
        files.every(isSafeFile) &&
        files.includes("SKILL.md");
      if (!usable) throw new Error(`${indexUrl} lists a skill that cannot be installed safely`);
      const contents = await Promise.all(
        files.map((path) => download(new URL(`${name}/${path}`, indexUrl).href)),
      );
      return { name, files: files.map((path, i) => ({ path, content: contents[i] ?? Buffer.alloc(0) })) };
    }),
  );
  return { skills, from: indexUrl };
}

/** The skills an index lists, or the reason they could not be downloaded. */
export async function loadSkills(indexUrl: string): Promise<SkillSet> {
  try {
    return await publishedSkills(indexUrl);
  } catch (error) {
    return {
      skills: [],
      from: indexUrl,
      unreachable: error instanceof Error ? error.message : String(error),
    };
  }
}

/** How the skills in `dir` compare with the set. */
export function skillsState(set: SkillSet, dir: string): SkillsState {
  if (set.unreachable) return "unknown";
  if (!set.skills.some((skill) => existsSync(join(dir, skill.name, "SKILL.md")))) return "missing";
  const same = (skill: Skill) =>
    skill.files.every((file) => {
      const target = join(dir, skill.name, file.path);
      return existsSync(target) && readFileSync(target).equals(file.content);
    });
  return set.skills.every(same) ? "current" : "outdated";
}

/** Write every skill into `dir`, one folder per skill. Returns the folders written. */
export function installSkills(set: SkillSet, dir: string): string[] {
  for (const skill of set.skills) {
    for (const file of skill.files) {
      const target = join(dir, skill.name, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
  }
  return set.skills.map((skill) => join(dir, skill.name));
}
