import { type Command, InvalidArgumentError, Option } from "commander";
import { z } from "zod";
import { findOperation, operations, SURFACES, toolName } from "../catalog/index.js";
import type { Operation } from "../catalog/types.js";
import { action } from "../core/command.js";
import { invalidArgs } from "../core/errors.js";
import { invoke } from "../core/invoke.js";
import { isJsonMode, jsonOutput, print, printJson } from "../core/output.js";

/**
 * `rango basic <op>` and `rango main <op>`: one subcommand per catalogue
 * entry, flags derived from its zod schema. This is the raw layer; the
 * curated commands (quote, swap, status, …) sit on top with friendlier flags
 * and tables.
 */

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

interface Unwrapped {
  inner: z.ZodTypeAny;
  optional: boolean;
  defaultValue: unknown;
}

function unwrap(schema: z.ZodTypeAny): Unwrapped {
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
    for (const op of operations.filter((o) => o.surface === surface.name)) {
      const cmd = group
        .command(op.name)
        .description(op.summary)
        .addHelpText(
          "after",
          `\n${op.description}\n\nMCP tool: ${toolName(op)}${op.readOnly ? "" : "\nThis operation builds or records something; it does not sign."}`,
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
    .command("schema <operation> [name]")
    .description(
      'JSON schema of one operation, e.g. "rango schema basic quote" or "rango schema main_best_route"',
    )
    .action(
      action(async (ref: string, name?: string) => {
        const op = findOperation(ref, name);
        if (!op)
          throw invalidArgs(
            `Unknown operation "${name ? `${ref} ${name}` : ref}"`,
            "List them with: rango map",
          );
        printJson({
          command: `rango ${op.surface} ${op.name}`,
          tool: toolName(op),
          summary: op.summary,
          description: op.description,
          readOnly: op.readOnly,
          input: jsonSchemaFor(op),
        });
      }),
    );

  program
    .command("map")
    .description("Every command and MCP tool in one listing")
    .action(
      action(async () => {
        const curated = program.commands
          .filter(
            (c) =>
              !SURFACES.some((s) => s.name === c.name()) && !["map", "schema", "help"].includes(c.name()),
          )
          .map((c) => ({ command: `rango ${c.name()}`, summary: c.description() }))
          .sort((a, b) => a.command.localeCompare(b.command));
        const surfaces: Record<string, unknown[]> = {};
        for (const op of operations) {
          const bucket = surfaces[op.surface] ?? [];
          surfaces[op.surface] = bucket;
          bucket.push({
            command: `rango ${op.surface} ${op.name}`,
            tool: toolName(op),
            summary: op.summary,
            readOnly: op.readOnly,
          });
        }
        const tree = { curated, surfaces };
        if (isJsonMode()) return printJson(tree);
        const lines = ["rango"];
        for (const c of curated) lines.push(`  ${c.command.slice(6).padEnd(30)} ${c.summary}`);
        for (const s of SURFACES) {
          lines.push(`  ${s.name}`);
          for (const op of operations.filter((o) => o.surface === s.name)) {
            lines.push(`    ${op.name.padEnd(28)} ${op.summary}${op.readOnly ? "" : "  [writes]"}`);
          }
        }
        print(lines.join("\n"));
      }),
    );
}

/** zod 3 has no built-in JSON Schema export; describe the shape well enough for an agent. */
export function jsonSchemaFor(op: Operation): unknown {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, schema] of Object.entries(op.input.shape)) {
    const { inner, optional } = unwrap(schema as z.ZodTypeAny);
    let type = "string";
    let extra: Record<string, unknown> = {};
    if (inner instanceof z.ZodNumber) type = "number";
    else if (inner instanceof z.ZodBoolean) type = "boolean";
    else if (inner instanceof z.ZodArray) {
      type = "array";
      extra = {
        items: unwrap(inner.element).inner instanceof z.ZodString ? { type: "string" } : { type: "object" },
      };
    } else if (inner instanceof z.ZodEnum) extra = { enum: inner.options };
    else if (inner instanceof z.ZodObject || inner instanceof z.ZodRecord) type = "object";
    properties[name] = { type, ...extra, description: (schema as z.ZodTypeAny).description ?? "" };
    if (!optional) required.push(name);
  }
  return { type: "object", properties, required };
}
