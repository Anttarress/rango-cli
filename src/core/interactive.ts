import { emitKeypressEvents } from "node:readline";
import { color } from "./output.js";

/**
 * The menus of `rango agent setup`, modelled on the ones in `stripe agent
 * setup`: a bordered list where the arrow keys move the pointer and enter
 * confirms. In a checkbox menu space toggles the row under the pointer; in a
 * select menu the pointer is the choice.
 *
 * The state machine (reduceCheckbox), the key mapping (checkboxKeyFor) and the
 * drawing (renderCheckbox) are pure and exported for tests; checkboxPrompt and
 * selectPrompt connect them to a terminal.
 */

const ESC = String.fromCharCode(27);

export interface CheckboxItem<T> {
  value: T;
  label: string;
  /** Shown after the label, e.g. "not set up". */
  detail?: string;
  /** Checked when the menu opens. */
  selected?: boolean;
  /** Listed as [-]; cannot be toggled and is never returned. */
  disabled?: boolean;
  /** A labelled rule drawn above this row to set it apart from the ones before it, e.g. "OR". */
  divider?: string;
}

export interface CheckboxState {
  cursor: number;
  selected: ReadonlySet<number>;
  done: "confirm" | "cancel" | null;
}

export type CheckboxKey = "up" | "down" | "toggle" | "toggleAll" | "confirm" | "cancel";

export function initialCheckboxState<T>(items: ReadonlyArray<CheckboxItem<T>>): CheckboxState {
  const selected = new Set<number>();
  items.forEach((item, i) => {
    if (item.selected && !item.disabled) selected.add(i);
  });
  return { cursor: 0, selected, done: null };
}

/** Pure state transition. The pointer stops at the first and last row; it does not wrap. */
export function reduceCheckbox<T>(
  state: CheckboxState,
  key: CheckboxKey,
  items: ReadonlyArray<CheckboxItem<T>>,
): CheckboxState {
  switch (key) {
    case "up":
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    case "down":
      return { ...state, cursor: Math.max(0, Math.min(items.length - 1, state.cursor + 1)) };
    case "toggle": {
      const item = items[state.cursor];
      if (!item || item.disabled) return state;
      const selected = new Set(state.selected);
      if (!selected.delete(state.cursor)) selected.add(state.cursor);
      return { ...state, selected };
    }
    case "toggleAll": {
      // Select everything unless everything already is; then clear.
      const enabled = items.flatMap((item, i) => (item.disabled ? [] : [i]));
      const allSelected = enabled.every((i) => state.selected.has(i));
      return { ...state, selected: new Set(allSelected ? [] : enabled) };
    }
    case "confirm":
      return { ...state, done: "confirm" };
    case "cancel":
      return { ...state, done: "cancel" };
  }
}

interface Keypress {
  name?: string;
  ctrl?: boolean;
}

/** Which menu action a `keypress` event from node:readline stands for, if any. */
export function checkboxKeyFor(str: string | undefined, key: Keypress | undefined): CheckboxKey | null {
  if (key?.ctrl) return key.name === "c" ? "cancel" : null;
  switch (key?.name ?? str) {
    case "up":
    case "k":
      return "up";
    case "down":
    case "j":
      return "down";
    case "space":
    case " ":
      return "toggle";
    case "a":
      return "toggleAll";
    case "return":
    case "enter":
      return "confirm";
    case "escape":
    case "q":
      return "cancel";
    default:
      return null;
  }
}

type Style = (text: string) => string;
/** A run of text and how to paint it. Widths are counted before painting. */
type Segment = readonly [text: string, style?: Style];
type Line = readonly Segment[];

interface Row {
  text: string;
  width: number;
}

const LABEL_WIDTH = 22;
const HINT = {
  checkbox: "↑/↓ move · space toggle · a select all · enter confirm · q quit",
  select: "↑/↓ move · enter confirm · q cancel",
};
type Kind = keyof typeof HINT;

const widthOf = (line: Line) => line.reduce((n, [text]) => n + text.length, 0);

/** Paint a line, cut to at most `max` visible characters. */
function paint(line: Line, max: number): Row {
  let room = Math.max(0, max);
  let text = "";
  for (const [segment, style] of line) {
    const shown = segment.slice(0, room);
    if (!shown) continue;
    room -= shown.length;
    text += style ? style(shown) : shown;
  }
  return { text, width: Math.max(0, max) - room };
}

/** The key hint on as few lines as fit in `max` columns, broken between keys. */
function hintLines(hint: string, max: number): string[] {
  const lines: string[] = [];
  for (const part of hint.split(" · ")) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} · ${part}`.length <= max)
      lines[lines.length - 1] = `${last} · ${part}`;
    else lines.push(part);
  }
  return lines;
}

function menuLines<T>(
  kind: Kind,
  title: string,
  items: ReadonlyArray<CheckboxItem<T>>,
  state: CheckboxState,
  labelWidth: number,
  hint: string[],
): Line[] {
  const rule = "─".repeat(20);
  const rows = items.flatMap((item, i): Line[] => {
    const atCursor = i === state.cursor;
    const row: Style | undefined = atCursor ? color.bold : undefined;
    const text = `${item.label.padEnd(labelWidth)} ${item.detail ?? ""}`.trimEnd();
    let line: Line;
    if (kind === "select") {
      line = [[`  ${atCursor ? "(•)" : "( )"} ${text}`, row]];
    } else {
      const mark: Segment = item.disabled
        ? ["-", row]
        : state.selected.has(i)
          ? ["✔", atCursor ? (t) => color.bold(color.green(t)) : color.green]
          : ["·", color.dim];
      line = [[`${atCursor ? "▶" : " "} [`, row], mark, [`] ${text}`, row]];
    }
    return item.divider ? [[], [[`${rule} ${item.divider} ${rule}`, color.dim]], line] : [line];
  });
  return [[[title]], [], ...rows, [], ...hint.map((text): Line => [[text]])];
}

function layout<T>(
  kind: Kind,
  title: string,
  items: ReadonlyArray<CheckboxItem<T>>,
  state: CheckboxState,
  columns: number,
): Row[] {
  const longestLabel = Math.max(...items.map((item) => item.label.length));
  const lines = menuLines(kind, title, items, state, Math.max(LABEL_WIDTH, longestLabel), [HINT[kind]]);
  const inner = Math.max(...lines.map(widthOf));
  // Box = content + 2 columns of padding and a border on each side. Keep one
  // column spare so no row ever touches the right edge of the window.
  if (inner + 6 >= columns) {
    // Too narrow for the box: plain lines, labels packed tight, hint wrapped.
    const max = columns - 1;
    const hint = hintLines(HINT[kind], max);
    return menuLines(kind, title, items, state, longestLabel, hint).map((line) => paint(line, max));
  }
  const boxed = (line: Line): Row => {
    const { text, width } = paint(line, inner);
    return { text: `│  ${text}${" ".repeat(inner - width)}  │`, width: inner + 6 };
  };
  const rule = "─".repeat(inner + 4);
  return [
    { text: `╭${rule}╮`, width: inner + 6 },
    boxed([]),
    ...lines.map(boxed),
    boxed([]),
    { text: `╰${rule}╯`, width: inner + 6 },
  ];
}

/**
 * The checkbox menu as terminal rows, none wider than `columns`. Drawn in a
 * rounded box when the window is wide enough for it, as plain lines otherwise.
 */
export function renderCheckbox<T>(
  title: string,
  items: ReadonlyArray<CheckboxItem<T>>,
  state: CheckboxState,
  columns = 80,
): string[] {
  return layout("checkbox", title, items, state, columns).map((row) => row.text);
}

interface MenuOptions<T> {
  title: string;
  items: ReadonlyArray<CheckboxItem<T>>;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

/**
 * Draw a menu, feed it keys until enter or a cancel key, wipe it from the
 * screen and hand back the final state. `null` on cancel, and when there is no
 * terminal to ask on or nothing to choose from.
 */
async function runMenu<T>(kind: Kind, options: MenuOptions<T>, cursor = 0): Promise<CheckboxState | null> {
  const { title, items, input = process.stdin, output = process.stdout } = options;
  if (!input.isTTY || !output.isTTY || items.length === 0) return null;

  let state: CheckboxState = { ...initialCheckboxState(items), cursor };
  let drawn: number[] = []; // width of every row currently on screen

  const columns = () => output.columns || 80;
  /** Back to the first row of the menu. A row wider than the window (after a resize) counts as several. */
  const toTop = () => {
    const rows = drawn.reduce((n, width) => n + Math.max(1, Math.ceil(width / columns())), 0);
    return rows ? `\r${ESC}[${rows}A` : "";
  };
  const draw = (wipeFirst = false) => {
    const rows = layout(kind, title, items, state, columns());
    // One write per frame: overwrite each row in place, then clear whatever is left below.
    const frame = rows.map((row) => `${row.text}${ESC}[K\r\n`).join("");
    output.write(`${toTop()}${wipeFirst ? `${ESC}[J` : ""}${frame}${ESC}[J`);
    drawn = rows.map((row) => row.width);
  };

  emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  output.write(`${ESC}[?25l`); // hide the text cursor while the menu is up
  draw();

  const onResize = () => draw(true);
  output.on("resize", onResize);
  try {
    return await new Promise<CheckboxState | null>((resolve) => {
      const onKeypress = (str: string | undefined, key: Keypress | undefined) => {
        const action = checkboxKeyFor(str, key);
        // A select menu has nothing to toggle.
        if (!action || (kind === "select" && action.startsWith("toggle"))) return;
        state = reduceCheckbox(state, action, items);
        if (!state.done) return draw();
        input.off("keypress", onKeypress);
        resolve(state.done === "confirm" ? state : null);
      };
      input.on("keypress", onKeypress);
    });
  } finally {
    output.off("resize", onResize);
    output.write(`${toTop()}${ESC}[J${ESC}[?25h`); // wipe the menu, show the cursor again
    input.setRawMode(wasRaw);
    input.pause();
  }
}

/** Several choices: resolves with the values of the checked rows, or `null` on cancel. */
export async function checkboxPrompt<T>(options: MenuOptions<T>): Promise<T[] | null> {
  const state = await runMenu("checkbox", options);
  if (!state) return null;
  return options.items.filter((item, i) => state.selected.has(i) && !item.disabled).map((item) => item.value);
}

/** One choice: resolves with the value of the row the pointer is on, or `null` on cancel. */
export async function selectPrompt<T>(options: MenuOptions<T> & { initial?: number }): Promise<T | null> {
  const state = await runMenu("select", options, options.initial);
  return state ? (options.items[state.cursor]?.value ?? null) : null;
}

/** Show a one-line status on the terminal while `work` runs, also when it is a promise, then wipe it. */
export function whileShowing<T>(text: string, work: () => T, output: NodeJS.WriteStream = process.stdout): T {
  if (!output.isTTY) return work();
  const wipe = () => output.write(`\r${ESC}[K`);
  output.write(text);
  let result: T;
  try {
    result = work();
  } catch (error) {
    wipe();
    throw error;
  }
  if (result instanceof Promise) return result.finally(wipe) as T;
  wipe();
  return result;
}
