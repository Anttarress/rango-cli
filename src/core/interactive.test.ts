import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CheckboxItem,
  type CheckboxState,
  checkboxKeyFor,
  checkboxPrompt,
  initialCheckboxState,
  reduceCheckbox,
  renderCheckbox,
  selectPrompt,
  whileShowing,
} from "./interactive.js";
import { configureOutput } from "./output.js";

const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const TITLE = "Select agents to set up with Rango:";

const items: ReadonlyArray<CheckboxItem<string>> = [
  { value: "claude-code", label: "Claude Code", detail: "not set up", selected: true },
  { value: "cursor", label: "Cursor", detail: "already set up" },
  { value: "codex", label: "Codex", detail: "not set up", selected: true },
];

/** Colours follow stdout; tests run with it piped, so they are off unless a test turns them on. */
const inheritedNoColor = process.env["NO_COLOR"];
function useColor(on: boolean): void {
  if (on) delete process.env["NO_COLOR"];
  else if (inheritedNoColor !== undefined) process.env["NO_COLOR"] = inheritedNoColor;
  Object.defineProperty(process.stdout, "isTTY", { value: on, configurable: true });
  configureOutput({});
}
afterEach(() => useColor(false));

/**
 * Just enough of a terminal to check what the menu leaves on screen: text with
 * wrapping at the right edge, carriage return, line feed, cursor up, erase to
 * end of line and erase to end of screen. Colours and cursor visibility are
 * accepted and ignored. A line feed does not return the carriage, so the menu
 * must not rely on the terminal doing that for it.
 */
class Terminal extends EventEmitter {
  isTTY = true;
  private rows = [""];
  private row = 0;
  private col = 0;

  constructor(public columns: number) {
    super();
  }

  write(data: string): boolean {
    for (let i = 0; i < data.length; i++) {
      const ch = data[i] as string;
      if (ch === ESC && data[i + 1] === "[") {
        let end = i + 2;
        while (!/[a-zA-Z]/.test(data[end] ?? "x")) end++;
        this.control(data.slice(i + 2, end), data[end] ?? "");
        i = end;
      } else if (ch === "\r") {
        this.col = 0;
      } else if (ch === "\n") {
        this.row++;
        if (this.rows[this.row] === undefined) this.rows[this.row] = "";
      } else {
        this.put(ch);
      }
    }
    return true;
  }

  private control(params: string, final: string): void {
    const line = this.rows[this.row] ?? "";
    if (final === "A") this.row = Math.max(0, this.row - (Number(params) || 1));
    else if (final === "K") this.rows[this.row] = line.slice(0, this.col);
    else if (final === "J") {
      this.rows[this.row] = line.slice(0, this.col);
      this.rows.length = this.row + 1;
    }
  }

  private put(ch: string): void {
    if (this.col >= this.columns) {
      this.row++;
      this.col = 0;
      if (this.rows[this.row] === undefined) this.rows[this.row] = "";
    }
    const line = (this.rows[this.row] ?? "").padEnd(this.col);
    this.rows[this.row] = line.slice(0, this.col) + ch + line.slice(this.col + 1);
    this.col++;
  }

  /** Change the window width the way most terminals do: lines that no longer fit are re-wrapped. */
  resize(columns: number): void {
    const rewrap = (line: string) =>
      line.length <= columns ? [line] : (line.match(new RegExp(`.{1,${columns}}`, "g")) ?? [line]);
    const above = this.rows.slice(0, this.row).flatMap(rewrap);
    this.rows = [...above, ...this.rows.slice(this.row).flatMap(rewrap)];
    this.row = above.length;
    this.columns = columns;
    this.emit("resize");
  }

  get lines(): string[] {
    const lines = this.rows.map((line) => line.trimEnd());
    while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }

  get screen(): string {
    return this.lines.join("\n");
  }
}

/** A keyboard in raw mode: every press arrives as the bytes a terminal would send. */
class Keyboard extends EventEmitter {
  isTTY = true;
  isRaw = false;
  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  press(...keys: string[]): void {
    for (const key of keys) this.emit("data", Buffer.from(key));
  }
}

function open(columns: number, list = items) {
  const terminal = new Terminal(columns);
  const keyboard = new Keyboard();
  terminal.write("$ rango agent setup\r\n");
  const result = checkboxPrompt({
    title: TITLE,
    items: list,
    input: keyboard as unknown as NodeJS.ReadStream,
    output: terminal as unknown as NodeJS.WriteStream,
  });
  return { terminal, keyboard, result };
}

const occurrences = (text: string, part: string) => text.split(part).length - 1;

describe("checkboxKeyFor", () => {
  it("maps the keys Stripe's menu uses", () => {
    expect(checkboxKeyFor(undefined, { name: "up" })).toBe("up");
    expect(checkboxKeyFor("k", { name: "k" })).toBe("up");
    expect(checkboxKeyFor(undefined, { name: "down" })).toBe("down");
    expect(checkboxKeyFor("j", { name: "j" })).toBe("down");
    expect(checkboxKeyFor(" ", { name: "space" })).toBe("toggle");
    expect(checkboxKeyFor(" ", undefined)).toBe("toggle");
    expect(checkboxKeyFor("a", { name: "a" })).toBe("toggleAll");
    expect(checkboxKeyFor("\r", { name: "return" })).toBe("confirm");
    expect(checkboxKeyFor("\n", { name: "enter" })).toBe("confirm");
    expect(checkboxKeyFor("q", { name: "q" })).toBe("cancel");
    expect(checkboxKeyFor(undefined, { name: "escape" })).toBe("cancel");
    expect(checkboxKeyFor(undefined, { name: "c", ctrl: true })).toBe("cancel");
  });

  it("ignores everything else, including ctrl with a mapped letter", () => {
    expect(checkboxKeyFor("x", { name: "x" })).toBeNull();
    expect(checkboxKeyFor(undefined, { name: "a", ctrl: true })).toBeNull();
    expect(checkboxKeyFor(undefined, { name: "tab" })).toBeNull();
    expect(checkboxKeyFor(undefined, undefined)).toBeNull();
  });
});

describe("reduceCheckbox", () => {
  const press = (state: CheckboxState, ...keys: Parameters<typeof reduceCheckbox>[1][]) =>
    keys.reduce((s, key) => reduceCheckbox(s, key, items), state);
  const checked = (state: CheckboxState) => Array.from(state.selected).sort();

  it("opens with the preselected rows checked and the pointer on the first row", () => {
    const state = initialCheckboxState(items);
    expect(state.cursor).toBe(0);
    expect(checked(state)).toEqual([0, 2]);
    expect(state.done).toBeNull();
  });

  it("space toggles only the row under the pointer", () => {
    let state = press(initialCheckboxState(items), "toggle");
    expect(checked(state)).toEqual([2]);
    state = press(state, "down", "toggle");
    expect(checked(state)).toEqual([1, 2]);
    state = press(state, "toggle");
    expect(checked(state)).toEqual([2]);
  });

  it("the pointer stops at the first and last row", () => {
    let state = press(initialCheckboxState(items), "up");
    expect(state.cursor).toBe(0);
    state = press(state, "down", "down", "down", "down");
    expect(state.cursor).toBe(2);
  });

  it("a selects everything, and clears everything once all are selected", () => {
    let state = press(initialCheckboxState(items), "toggleAll");
    expect(checked(state)).toEqual([0, 1, 2]);
    state = press(state, "toggleAll");
    expect(checked(state)).toEqual([]);
  });

  it("a disabled row cannot be toggled, by space or by a", () => {
    const withDisabled = [...items, { value: "grok", label: "Grok", disabled: true, selected: true }];
    let state = initialCheckboxState(withDisabled);
    expect(checked(state)).toEqual([0, 2]);
    state = reduceCheckbox({ ...state, cursor: 3 }, "toggle", withDisabled);
    expect(checked(state)).toEqual([0, 2]);
    state = reduceCheckbox(state, "toggleAll", withDisabled);
    expect(checked(state)).toEqual([0, 1, 2]);
  });

  it("enter confirms and q cancels without touching the selection", () => {
    const start = initialCheckboxState(items);
    expect(press(start, "confirm")).toMatchObject({ done: "confirm", selected: start.selected });
    expect(press(start, "cancel")).toMatchObject({ done: "cancel", selected: start.selected });
  });
});

describe("renderCheckbox", () => {
  it("draws the menu in a rounded box, like stripe agent setup", () => {
    expect(renderCheckbox(TITLE, items, initialCheckboxState(items), 100)).toEqual([
      "╭───────────────────────────────────────────────────────────────────╮",
      "│                                                                   │",
      "│  Select agents to set up with Rango:                              │",
      "│                                                                   │",
      "│  ▶ [✔] Claude Code            not set up                          │",
      "│    [·] Cursor                 already set up                      │",
      "│    [✔] Codex                  not set up                          │",
      "│                                                                   │",
      "│  ↑/↓ move · space toggle · a select all · enter confirm · q quit  │",
      "│                                                                   │",
      "╰───────────────────────────────────────────────────────────────────╯",
    ]);
  });

  it("sets a row apart with a labelled rule, as Stripe does for its skills row", () => {
    const withSkills = [
      ...items,
      { value: "shared", label: "Install Rango skills", detail: ".agents/skills", divider: "OR" },
    ];
    const rows = renderCheckbox(TITLE, withSkills, initialCheckboxState(withSkills), 100);
    expect(rows.slice(6, 10).map((row) => row.slice(3).trimEnd().replace(/ +│$/, ""))).toEqual([
      "  [✔] Codex                  not set up",
      "",
      "──────────────────── OR ────────────────────",
      "  [·] Install Rango skills   .agents/skills",
    ]);
    expect(new Set(rows.map((row) => row.length)).size).toBe(1);
  });

  it("marks a disabled row with [-]", () => {
    const rows = renderCheckbox(
      TITLE,
      [{ value: "x", label: "Kiro", detail: "unsupported", disabled: true }],
      {
        cursor: 0,
        selected: new Set(),
        done: null,
      },
    );
    expect(rows.some((row) => row.includes("▶ [-] Kiro"))).toBe(true);
  });

  it("drops the box, packs the rows and wraps the hint when the window is too narrow", () => {
    expect(renderCheckbox(TITLE, items, initialCheckboxState(items), 40)).toEqual([
      "Select agents to set up with Rango:",
      "",
      "▶ [✔] Claude Code not set up",
      "  [·] Cursor      already set up",
      "  [✔] Codex       not set up",
      "",
      "↑/↓ move · space toggle · a select all",
      "enter confirm · q quit",
    ]);
  });

  it("cuts what still does not fit, so no row can wrap", () => {
    const rows = renderCheckbox(TITLE, items, initialCheckboxState(items), 30);
    expect(rows[0]).toBe("Select agents to set up with ");
    expect(rows[3]).toBe("  [·] Cursor      already set");
    expect(rows.slice(-3)).toEqual(["↑/↓ move · space toggle", "a select all · enter confirm", "q quit"]);
    expect(Math.max(...rows.map((row) => row.length))).toBeLessThan(30);
  });

  it("keeps every row the same width when colours are on", () => {
    useColor(true);
    const rows = renderCheckbox(TITLE, items, initialCheckboxState(items), 100);
    expect(rows.join("")).toContain(`${ESC}[32m`);
    const plain = rows.map((row) => row.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), ""));
    expect(new Set(plain.map((row) => row.length)).size).toBe(1);
  });
});

describe("checkboxPrompt", () => {
  it("toggles rows in place, returns what is left checked and wipes the menu", async () => {
    const { terminal, keyboard, result } = open(100);
    expect(terminal.screen).toContain("▶ [✔] Claude Code");
    expect(keyboard.isRaw).toBe(true);

    keyboard.press(DOWN);
    expect(terminal.screen).toContain("▶ [·] Cursor");
    keyboard.press(" ");
    expect(terminal.screen).toContain("▶ [✔] Cursor");
    keyboard.press(UP, " ");
    expect(terminal.screen).toContain("▶ [·] Claude Code");
    expect(occurrences(terminal.screen, TITLE)).toBe(1);
    expect(terminal.lines).toHaveLength(12); // the command line and one copy of the box

    keyboard.press("\r");
    expect(await result).toEqual(["cursor", "codex"]);
    expect(terminal.screen).toBe("$ rango agent setup");
    expect(keyboard.isRaw).toBe(false);
  });

  it("draws one menu, not a pile of them, in a window narrower than its lines", async () => {
    useColor(true);
    const { terminal, keyboard, result } = open(30);
    keyboard.press(DOWN, " ", DOWN, " ", UP, UP, "a", "a", " ");
    expect(occurrences(terminal.screen, "Select agents")).toBe(1);
    expect(terminal.lines).toHaveLength(10); // the command line and one copy of the menu
    expect(terminal.lines.slice(3, 6)).toEqual([
      "▶ [✔] Claude Code not set up",
      "  [·] Cursor      already set",
      "  [·] Codex       not set up",
    ]);
    keyboard.press("\r");
    expect(await result).toEqual(["claude-code"]);
    expect(terminal.screen).toBe("$ rango agent setup");
  });

  it("redraws for the new width when the window shrinks while it is open", async () => {
    const { terminal, keyboard, result } = open(100);
    terminal.resize(40);
    expect(terminal.screen).not.toContain("╭");
    expect(occurrences(terminal.screen, "Select agents")).toBe(1);
    expect(terminal.lines[0]).toBe("$ rango agent setup");
    keyboard.press("q");
    expect(await result).toBeNull();
    expect(terminal.screen).toBe("$ rango agent setup");
  });

  it("q, esc and ctrl-c cancel", async () => {
    for (const key of ["q", String.fromCharCode(3)]) {
      const { terminal, keyboard, result } = open(100);
      keyboard.press(" ", key);
      expect(await result).toBeNull();
      expect(terminal.screen).toBe("$ rango agent setup");
    }
    const { keyboard, result } = open(100);
    keyboard.press(ESC); // a lone escape is only told apart from an arrow key after a short wait
    expect(await result).toBeNull();
  });

  it("returns nothing checked when enter is pressed with every row cleared", async () => {
    const { keyboard, result } = open(100);
    keyboard.press("a", "a", "\r");
    expect(await result).toEqual([]);
  });

  it("does not ask when there is no terminal", async () => {
    const terminal = new Terminal(100);
    const keyboard = new Keyboard();
    keyboard.isTTY = false;
    const result = await checkboxPrompt({
      title: TITLE,
      items,
      input: keyboard as unknown as NodeJS.ReadStream,
      output: terminal as unknown as NodeJS.WriteStream,
    });
    expect(result).toBeNull();
    expect(terminal.screen).toBe("");
  });
});

describe("selectPrompt", () => {
  const scopes: ReadonlyArray<CheckboxItem<string>> = [
    { value: "local", label: "This project", detail: "./.agents/skills  (not installed)" },
    { value: "global", label: "Global", detail: "~/.agents/skills  (out of date)" },
  ];
  function ask(initial?: number) {
    const terminal = new Terminal(100);
    const keyboard = new Keyboard();
    terminal.write("$ rango agent setup\r\n");
    const result = selectPrompt({
      title: "Install Rango skills where?",
      items: scopes,
      initial,
      input: keyboard as unknown as NodeJS.ReadStream,
      output: terminal as unknown as NodeJS.WriteStream,
    });
    return { terminal, keyboard, result };
  }
  const body = (terminal: Terminal) => terminal.lines.map((line) => line.slice(3).replace(/ +│$/, ""));

  it("draws one choice per row, moves with the arrows and returns the row the pointer is on", async () => {
    const { terminal, keyboard, result } = ask();
    expect(body(terminal).slice(3, 9)).toEqual([
      "Install Rango skills where?",
      "",
      "  (•) This project           ./.agents/skills  (not installed)",
      "  ( ) Global                 ~/.agents/skills  (out of date)",
      "",
      "↑/↓ move · enter confirm · q cancel",
    ]);
    keyboard.press(DOWN, DOWN, " ", "a");
    expect(terminal.screen).toContain("( ) This project");
    expect(terminal.screen).toContain("(•) Global");
    keyboard.press("\r");
    expect(await result).toBe("global");
    expect(terminal.screen).toBe("$ rango agent setup");
  });

  it("starts on the row it is told to, and q cancels", async () => {
    const { terminal, keyboard, result } = ask(1);
    expect(terminal.screen).toContain("(•) Global");
    keyboard.press("q");
    expect(await result).toBeNull();
    expect(terminal.screen).toBe("$ rango agent setup");
  });
});

describe("whileShowing", () => {
  it("shows a status while the work runs and wipes it afterwards, even on a throw", () => {
    const terminal = new Terminal(80);
    const output = terminal as unknown as NodeJS.WriteStream;
    const seen = whileShowing("Checking agents...", () => terminal.screen, output);
    expect(seen).toBe("Checking agents...");
    expect(terminal.screen).toBe("");
    expect(() =>
      whileShowing(
        "Working...",
        () => {
          throw new Error("boom");
        },
        output,
      ),
    ).toThrow("boom");
    expect(terminal.screen).toBe("");
  });

  it("keeps the status up until a promise settles", async () => {
    const terminal = new Terminal(80);
    let finish: (value: string) => void = () => {};
    const pending = whileShowing(
      "Checking agents...",
      () => new Promise<string>((resolve) => (finish = resolve)),
      terminal as unknown as NodeJS.WriteStream,
    );
    expect(terminal.screen).toBe("Checking agents...");
    finish("done");
    expect(await pending).toBe("done");
    expect(terminal.screen).toBe("");
  });
});
