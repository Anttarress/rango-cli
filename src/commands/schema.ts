import { type Command, InvalidArgumentError, Option } from "commander";
import { z } from "zod";
import { findOperation, toolName } from "../catalog/index.js";
import { endpointOf, expand, referenceUrl, type SchemaNode } from "../catalog/responses.js";
import type { Operation } from "../catalog/types.js";
import { action } from "../core/command.js";
import { invalidArgs } from "../core/errors.js";
import { color, isJsonMode, print, printTidyJson } from "../core/output.js";
import { unwrap } from "./generated.js";

/**
 * `rango schema <surface> <op>`: what one operation takes and what it returns,
 * laid out like a page of Rango's API reference: a line per field with its
 * type, whether it is required, and its description. The input comes from the
 * catalogue, the output from that reference (src/catalog/responses.json).
 */

/** zod 3 has no built-in JSON Schema export; describe the shape well enough for an agent. */
function jsonSchemaFor(op: Operation): SchemaNode {
  const properties: Record<string, SchemaNode> = {};
  const required: string[] = [];
  for (const [name, schema] of Object.entries(op.input.shape)) {
    const { inner, optional } = unwrap(schema as z.ZodTypeAny);
    let type = "string";
    let extra: SchemaNode = {};
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

/** What a reader has to know that the fields themselves do not say. */
function notesFor(response: SchemaNode, output: SchemaNode, depth: number): string[] {
  const notes: string[] = [];
  // The reference types amounts as numbers; the API sends them as strings to keep every digit.
  if (/"format":"(int64|decimal)"/.test(JSON.stringify(output))) {
    notes.push("int64 and decimal amounts are sent as strings");
  }
  if (JSON.stringify(expand(response, depth + 1)) !== JSON.stringify(output)) {
    notes.push(`--depth ${depth + 1} shows nested fields`);
  }
  return notes;
}

interface Row {
  level: number;
  name: string;
  required: boolean;
  type: string;
  text: string;
}

/** What an array ends up holding (an object, or the variants of one); anything else is itself. */
function itemOf(node: SchemaNode): SchemaNode {
  return node.type === "array" && node.items ? itemOf(node.items) : node;
}

/** Type as the reference shows it: the format of a number, `[]` after what an array holds. */
function typeLabel(node: SchemaNode): string {
  if (node.type === "array") return `${typeLabel(node.items ?? {})}[]`;
  if (node.oneOf) return "oneOf";
  if (node.format && (node.type === "integer" || node.type === "number")) return node.format;
  return node.type ?? "any";
}

function describe(node: SchemaNode): string {
  const target = itemOf(node);
  const text = node.description ?? target.description ?? "";
  // Variants that are not written out as rows are named here, like the values of an enum.
  const variants = target.oneOf?.every((variant) => !variant.properties)
    ? target.oneOf.map((variant) => variant.title ?? "object")
    : undefined;
  const values = (target.enum ?? variants ?? []).join(" | ");
  if (!values) return text;
  return text ? `${text.replace(/[.:]$/, "")} (${values})` : values;
}

/** One row per field, nested fields after their parent, one level further in. */
function rowsOf(node: SchemaNode, level = 0): Row[] {
  const target = itemOf(node);
  const rows: Row[] = [];
  for (const variant of target.oneOf ?? []) {
    if (!variant.properties) continue;
    rows.push({
      level,
      name: variant.title ?? "object",
      required: false,
      type: "object",
      text: variant.description ?? "",
    });
    rows.push(...rowsOf(variant, level + 1));
  }
  for (const [name, field] of Object.entries(target.properties ?? {})) {
    const required = target.required?.includes(name) ?? false;
    rows.push({ level, name, required, type: typeLabel(field), text: describe(field) });
    rows.push(...rowsOf(field, level + 1));
  }
  return rows;
}

/** Break text at spaces into lines of at most `width` characters; a `|` stays with the value before it. */
function wrap(text: string, width: number): string[] {
  const words: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word === "|" && words.length > 0) words[words.length - 1] += " |";
    else words.push(word);
  }
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A name longer than this does not widen the name column for every other row. */
const MAX_NAME = 32;
/** Below this many columns for descriptions they go under the field instead of beside it. */
const MIN_TEXT = 28;

function table(sections: Row[][], width: number): string[][] {
  const all = sections.flat();
  const lead = (row: Row) => 2 * (row.level + 1) + row.name.length + (row.required ? 2 : 0);
  const nameWidth = Math.max(0, ...all.map(lead).filter((length) => length <= MAX_NAME));
  const typeWidth = Math.max(0, ...all.map((row) => row.type.length));
  const textAt = nameWidth + 2 + typeWidth + 2;
  const beside = width - textAt >= MIN_TEXT;

  return sections.map((rows) =>
    rows.flatMap((row) => {
      const indent = "  ".repeat(row.level + 1);
      const name = `${indent}${row.name}${row.required ? ` ${color.red("*")}` : ""}`;
      const head = `${name}${" ".repeat(Math.max(0, nameWidth - lead(row)))}  ${color.dim(row.type)}`;
      if (!row.text) return [head];
      if (!beside) {
        const under = `${indent}    `;
        return [head, ...wrap(row.text, Math.max(20, width - under.length)).map((line) => under + line)];
      }
      // A name too long for its column pushes its own description right; the rest stay aligned.
      const start = Math.max(textAt, lead(row) + 2 + typeWidth + 2);
      const [first = "", ...rest] = wrap(row.text, Math.max(MIN_TEXT, width - start));
      const gap = " ".repeat(typeWidth - row.type.length + 2);
      return [`${head}${gap}${first}`, ...rest.map((line) => " ".repeat(start) + line)];
    }),
  );
}

function printText(op: Operation, depth: number): void {
  const endpoint = endpointOf(op);
  const output = endpoint && expand(endpoint.response, depth);
  const width = Math.max(40, Math.min(process.stdout.columns || 100, 120));
  const [input = [], result = []] = table([rowsOf(jsonSchemaFor(op)), output ? rowsOf(output) : []], width);

  const lines = [color.bold(`rango ${op.surface} ${op.name}`), op.summary];
  const tool = `MCP tool ${toolName(op)}`;
  lines.push(color.dim(endpoint ? `${endpoint.method} ${endpoint.path} · ${tool}` : tool));
  lines.push("", color.bold("Input"), ...(input.length > 0 ? input : ["  none"]));
  if (endpoint && output) {
    // An object is the usual answer; anything else (a list of blockchains) is said beside the title.
    const kind = output.type === "object" ? "" : color.dim(`  ${typeLabel(output)}`);
    lines.push("", `${color.bold("Output")}${kind}`, ...result);
    const notes = ["* required", ...notesFor(endpoint.response, output, depth)].join(" · ");
    const legend = wrap(notes, width).map((line) =>
      line.startsWith("*") ? `${color.red("*")}${color.dim(line.slice(1))}` : color.dim(line),
    );
    lines.push("", ...legend, color.dim(referenceUrl(endpoint)));
  }
  print(lines.join("\n"));
}

function printJsonSchema(op: Operation, depth: number): void {
  const endpoint = endpointOf(op);
  const output = endpoint && expand(endpoint.response, depth);
  const notes = endpoint && output ? notesFor(endpoint.response, output, depth) : [];
  printTidyJson({
    command: `rango ${op.surface} ${op.name}`,
    tool: toolName(op),
    method: endpoint?.method,
    path: endpoint?.path,
    summary: op.summary,
    description: op.description,
    readOnly: op.readOnly,
    input: jsonSchemaFor(op),
    output: output && { ...(notes.length > 0 ? { $comment: `${notes.join(". ")}.` } : {}), ...output },
    reference: endpoint && referenceUrl(endpoint),
  });
}

function parseDepth(value: string): number {
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 0)
    throw new InvalidArgumentError("expected a whole number, 0 or more");
  return depth;
}

export function registerSchemaCommand(program: Command): void {
  program
    .command("schema <operation> [name]")
    .description(
      "What one operation takes and returns, field by field. A table on a terminal, JSON Schema when piped or with --json.",
    )
    .addOption(
      new Option("--depth <n>", "Levels of nested output fields to show").argParser(parseDepth).default(1),
    )
    .addHelpText(
      "after",
      "\nExamples:\n  $ rango schema basic quote\n  $ rango schema main_best_route\n  $ rango schema basic swap --depth 2\n  $ rango schema main create-tx --json",
    )
    .action(
      action(async (ref: string, name: string | undefined, options: { depth: number }) => {
        const op = findOperation(ref, name);
        if (!op)
          throw invalidArgs(
            `Unknown operation "${name ? `${ref} ${name}` : ref}"`,
            "List them with: rango map",
          );
        if (isJsonMode()) return printJsonSchema(op, options.depth);
        printText(op, options.depth);
      }),
    );
}
