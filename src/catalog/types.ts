import type { z } from "zod";
import type { Params } from "../core/http.js";

/**
 * One entry per API operation. This catalogue is the single source both the
 * generated CLI commands (`rango basic …`, `rango main …`) and the MCP tools
 * (`rango mcp`) are built from, so the two can never drift.
 *
 * Phase 2 replaces the hand-written entries with ones generated from Rango's
 * OpenAPI document; nothing downstream has to change.
 */

export type Surface = "basic" | "main";

export interface RequestSpec {
  method: "GET" | "POST";
  path: string;
  params?: Params;
  body?: unknown;
}

export interface Operation<S extends z.ZodRawShape = z.ZodRawShape> {
  surface: Surface;
  /** Kebab-case, unique within the surface; the CLI subcommand name. */
  name: string;
  summary: string;
  description: string;
  readOnly: boolean;
  input: z.ZodObject<S>;
  request: (input: z.infer<z.ZodObject<S>>) => RequestSpec;
}

export function defineOperation<S extends z.ZodRawShape>(op: Operation<S>): Operation {
  return op as unknown as Operation;
}

/** MCP tool name: `basic_quote`, `main_best_route`. */
export function toolName(op: Pick<Operation, "surface" | "name">): string {
  return `${op.surface}_${op.name.replace(/-/g, "_")}`;
}

/** Drop undefined values so bodies and query strings only carry what was given. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}
