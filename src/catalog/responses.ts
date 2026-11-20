import reference from "./responses.json";
import type { Operation } from "./types.js";

/**
 * What each operation returns, taken from Rango's OpenAPI reference.
 * responses.json is written by scripts/sync-openapi.mjs and never edited by
 * hand: one entry per catalogue operation, and the shapes they share (a
 * token, a transaction) stored once and referred to by name.
 */

/** A schema of the reference, trimmed to what a reader needs. */
export interface SchemaNode {
  /** Name of a shared schema this stands for. */
  $ref?: string;
  /** Name of the schema an expanded variant came from. */
  title?: string;
  type?: string;
  /** How a number is encoded: int32, int64, double or decimal. */
  format?: string;
  description?: string;
  enum?: string[];
  items?: SchemaNode;
  /** The shapes this can take, one of them at a time. */
  oneOf?: SchemaNode[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  $comment?: string;
}

export interface Endpoint {
  method: string;
  /** As the reference writes it, e.g. /tx/{requestId}/check-approval. */
  path: string;
  /** Name of the reference page. */
  docs: string;
  response: SchemaNode;
}

const REFERENCE = reference as unknown as {
  source: string;
  operations: Record<string, Endpoint>;
  schemas: Record<string, SchemaNode>;
};

export const schemas = REFERENCE.schemas;

export function endpointOf(op: Pick<Operation, "surface" | "name">): Endpoint | undefined {
  return REFERENCE.operations[`${op.surface} ${op.name}`];
}

/** The page of Rango's API reference that documents an endpoint. */
export function referenceUrl(endpoint: Endpoint): string {
  return `${REFERENCE.source}/${endpoint.docs}`;
}

function resolve(node: SchemaNode): { schema: SchemaNode; name?: string } {
  let schema = node;
  let name: string | undefined;
  while (schema.$ref) {
    name = schema.$ref;
    schema = REFERENCE.schemas[name] ?? {};
  }
  return { schema, name };
}

/**
 * A schema with its references written out, `depth` levels of nested fields
 * deep: 0 is the fields of the schema itself, 1 adds the fields of each object
 * among them, and so on. An object below that keeps its type and description
 * only, and a oneOf keeps the names of its variants.
 */
export function expand(node: SchemaNode, depth: number, above: string[] = []): SchemaNode {
  const { schema, name } = resolve(node);
  const { items, oneOf, properties, required, ...own } = schema;
  const out: SchemaNode = { ...own };
  // A schema that contains itself (a swap made of swaps) is written out once.
  const open = depth >= 0 && !(name && above.includes(name));
  const below = name ? [...above, name] : above;

  // An array is not a level of its own: its items' fields sit where an object's would.
  if (items) out.items = expand(items, depth, above);
  if (oneOf) {
    out.oneOf = oneOf.map((variant) => {
      const title = resolve(variant).name;
      return open ? { title, ...expand(variant, depth - 1, below) } : { title };
    });
  }
  if (properties && open) {
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, expand(value, depth - 1, below)]),
    );
    if (required) out.required = required;
  }
  return out;
}
