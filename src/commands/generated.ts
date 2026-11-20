import { type Command, InvalidArgumentError, Option } from "commander";
import { z } from "zod";
import { operations, SURFACES, toolName } from "../catalog/index.js";
import type { Operation } from "../catalog/types.js";
import { action } from "../core/command.js";
import { invoke } from "../core/invoke.js";
import { isJsonMode, jsonOutput, print, printJson } from "../core/output.js";
import { registerSurfaceTokenCommands } from "./tokens.js";

/**
 * `rango basic <op>` and `rango main <op>`: one subcommand per catalogue
 * entry, flags derived from its zod schema. This is the whole surface area
 * of the API; the top-level (`rango agent`, `rango api`, `rango auth`,
 * `rango mcp`, `rango map`, `rango schema`) is only infrastructure around it.
 * `basic token`, `basic tokens`, `main token`, `main tokens` are the
 * non-generated conveniences registered on the two surface groups.
 */

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

interface Unwrapped {
  inner: z.ZodTypeAny;
  optional: boolean;
  defaultValue: unknown;
}

export function unwrap(schema: z.ZodTypeAny): Unwrapped {
  let inner = schema;
  let optional = false;
  let defaultValue: unknown;
  for (;;) {
    if (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable) {
      optional = true;
      inner = inner.unwrap();
    } else if (inner instanceof z.ZodDefault) {
      optional = true;
      defaultValue = inner._def.defaultValue();
      inner = inner.removeDefault();
    } else {
      return { inner, optional, defaultValue };
    }
  }
}

function parseNumber(value: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) throw new InvalidArgumentError("expected a number");
  return n;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new InvalidArgumentError(`expected JSON (${(error as Error).message})`);
  }
}

function parseList(value: string, previous: string[] | undefined): string[] {
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return [...(previous ?? []), ...parts];
}

/**
 * Pick a plausible example value for a schema field so each generated command
 * can show one real-looking invocation under `--help`. Names, not types, drive
 * the mapping: `fromBlockchain`, `requestId`, `amount`, etc. Unknown types fall
 * back to `<value>`.
 */
function exampleValue(name: string, schema: z.ZodTypeAny): string {
  const { inner } = unwrap(schema);
  if (inner instanceof z.ZodEnum) return (inner.options as string[])[0] ?? "VALUE";
  if (inner instanceof z.ZodBoolean) return "";
  const n = name.toLowerCase();
  if (n === "from" || n === "to") return n === "from" ? "BSC.BNB" : "ETH.ETH";
  if (n === "amount" || n.endsWith("amount")) return "1";
  if (n === "slippage") return "0.5";
  if (n === "step") return "1";
  if (n === "requestid") return "<requestId>";
  if (n === "txid") return "0xhash";
  if (n.endsWith("address") || n === "walletaddress") return "0xYOU";
  if (n.includes("blockchain") || n === "chain") return "ETH";
  if (n === "symbol" || n.endsWith("symbol")) return "USDC";
  if (n === "blockchains") return "ETH,BSC";
  if (n === "addresses") return '["ETH.0xYOU","BSC.0xYOU"]';
  if (n === "swappers") return "1inch,paraswap";
  if (inner instanceof z.ZodArray) return "a,b";
  if (inner instanceof z.ZodObject || inner instanceof z.ZodRecord) return '{"ETH":"0xYOU"}';
  if (inner instanceof z.ZodNumber) return "1";
  return "<value>";
}

/** One example invocation for an operation, built from its required fields. */
function exampleFor(op: Operation): string {
  const parts = [`rango ${op.surface} ${op.name}`];
  for (const [name, schema] of Object.entries(op.input.shape)) {
    const { optional } = unwrap(schema as z.ZodTypeAny);
    if (optional) continue;
    const kebabName = kebab(name);
    const value = exampleValue(name, schema as z.ZodTypeAny);
    if (value === "") parts.push(`--${kebabName}`);
    else parts.push(`--${kebabName} ${value.includes(" ") ? `"${value}"` : value}`);
  }
  return parts.join(" ");
}

/** Build the commander options for one schema field. Booleans get --x and --no-x. */
export function optionsFor(name: string, schema: z.ZodTypeAny): Option[] {
  const { inner, optional } = unwrap(schema);
  const flag = `--${kebab(name)}`;
  const help = schema.description ?? inner.description ?? "";

  if (inner instanceof z.ZodBoolean) {
    return [
      new Option(flag, help),
      new Option(`--no-${kebab(name)}`, `Explicitly send ${name}=false`).hideHelp(),
    ];
  }

  let option: Option;
  if (inner instanceof z.ZodNumber) {
    option = new Option(`${flag} <number>`, help).argParser(parseNumber);
  } else if (inner instanceof z.ZodEnum) {
    option = new Option(`${flag} <value>`, help).choices(inner.options as string[]);
  } else if (inner instanceof z.ZodString) {
    option = new Option(`${flag} <value>`, help);
  } else if (inner instanceof z.ZodArray && unwrap(inner.element).inner instanceof z.ZodString) {
    option = new Option(`${flag} <a,b>`, `${help} (comma-separated, repeatable)`).argParser(parseList);
  } else {
    option = new Option(`${flag} <json>`, `${help} (JSON)`).argParser(parseJson);
  }
  if (!optional) option.makeOptionMandatory();
  return [option];
}

/** Commander's option bag → the catalogue input: drop undefined, keep explicit false. */
export function inputFrom(opts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export function registerGeneratedCommands(program: Command): void {
  for (const surface of SURFACES) {
    const group = program.command(surface.name).description(surface.help);
    registerSurfaceTokenCommands(group, surface.name);
    for (const op of operations.filter((o) => o.surface === surface.name)) {
      const cmd = group
        .command(op.name)
        .description(op.summary)
        .addHelpText(
          "after",
          `\n${op.description}\n\nExample:\n  $ ${exampleFor(op)}\n\nMCP tool: ${toolName(op)}${op.readOnly ? "" : "\nThis operation builds or records something; it does not sign."}`,
        );
      for (const [name, schema] of Object.entries(op.input.shape)) {
        for (const option of optionsFor(name, schema as z.ZodTypeAny)) cmd.addOption(option);
      }
      cmd.action(
        action(async (opts: Record<string, unknown>) => {
          const data = await invoke(op, inputFrom(opts));
          if (isJsonMode()) return printJson(data);
          print(jsonOutput(data));
        }),
      );
    }
  }

  program
    .command("map")
    .description(
      "List every rango command and its matching MCP tool. Prints a tree on a terminal, JSON when piped or with --json.",
    )
    .addHelpText("after", "\nExamples:\n  $ rango map\n  $ rango map --json | jq '.surfaces.basic[].command'")
    .action(
      action(async () => {
        const curated = program.commands
          .filter(
            (c) =>
              !SURFACES.some((s) => s.name === c.name()) && !["map", "schema", "help"].includes(c.name()),
          )
          .map((c) => ({ command: `rango ${c.name()}`, summary: c.description() }))
          .sort((a, b) => a.command.localeCompare(b.command));
        interface SurfaceEntry {
          command: string;
          tool?: string;
          summary: string;
          readOnly: boolean;
        }
        const surfaces: Record<string, SurfaceEntry[]> = {};
        for (const s of SURFACES) {
          const bucket: SurfaceEntry[] = [];
          for (const op of operations.filter((o) => o.surface === s.name)) {
            bucket.push({
              command: `rango ${op.surface} ${op.name}`,
              tool: toolName(op),
              summary: op.summary,
              readOnly: op.readOnly,
            });
          }
          const group = program.commands.find((c) => c.name() === s.name);
          for (const sub of group?.commands ?? []) {
            const name = sub.name();
            if (name === "help") continue;
            if (bucket.some((e) => e.command === `rango ${s.name} ${name}`)) continue;
            bucket.push({
              command: `rango ${s.name} ${name}`,
              summary: sub.description(),
              readOnly: true,
            });
          }
          surfaces[s.name] = bucket;
        }
        const tree = { curated, surfaces };
        if (isJsonMode()) return printJson(tree);
        const lines = ["rango"];
        for (const c of curated) lines.push(`  ${c.command.slice(6).padEnd(30)} ${c.summary}`);
        for (const s of SURFACES) {
          lines.push(`  ${s.name}`);
          for (const entry of surfaces[s.name] ?? []) {
            const name = entry.command.replace(`rango ${s.name} `, "");
            lines.push(`    ${name.padEnd(28)} ${entry.summary}${entry.readOnly ? "" : "  [writes]"}`);
          }
        }
        print(lines.join("\n"));
      }),
    );
}
