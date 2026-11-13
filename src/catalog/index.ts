import { basicOperations } from "./basic.js";
import { mainOperations } from "./main.js";
import type { Operation, Surface } from "./types.js";
import { toolName } from "./types.js";

export type { Operation, RequestSpec, Surface } from "./types.js";
export { toolName } from "./types.js";

export const operations: Operation[] = [...basicOperations, ...mainOperations];

export const SURFACES: { name: Surface; help: string }[] = [
  { name: "basic", help: "Single-step swaps: quote, swap, status, balances, metadata (raw API)" },
  { name: "main", help: "Multi-step routing: best routes, confirm, per-step transactions (raw API)" },
];

/**
 * Accepts "basic quote", "basic/quote", "basic_quote", "basic-quote", "basic:quote"
 * or an MCP tool name like "main_best_route".
 */
export function findOperation(ref: string, name?: string): Operation | undefined {
  const text = name ? `${ref} ${name}` : ref;
  const match = /^(basic|main)[\s/:_-]+(.+)$/i.exec(text.trim());
  if (!match) return undefined;
  const surface = match[1]?.toLowerCase();
  const wanted = (match[2] ?? "").trim().toLowerCase().replace(/_/g, "-");
  return operations.find(
    (op) => op.surface === surface && (op.name === wanted || toolName(op) === text.trim()),
  );
}
