#!/usr/bin/env node
/**
 * Rebuild src/catalog/responses.json from Rango's OpenAPI reference
 * (https://api-docs.rango.exchange). `rango schema` prints its output section
 * from that file.
 *
 *   node scripts/sync-openapi.mjs
 *
 * Every reference page is also served as Markdown with the endpoint's OpenAPI
 * definition in a JSON block. This keeps the 200 response of each operation in
 * the catalogue and trims it to what a reader needs: type, format,
 * description, short enums, properties, required. No API key is involved.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SITE = "https://api-docs.rango.exchange";
const TARGET = fileURLToPath(new URL("../src/catalog/responses.json", import.meta.url));

/** Catalogue operation → the endpoint it calls. src/catalog/responses.test.ts checks these against the catalogue. */
const OPERATIONS = {
  "basic meta": "GET /basic/meta",
  "basic chains": "GET /basic/meta/blockchains",
  "basic swappers": "GET /basic/meta/swappers",
  "basic messaging-protocols": "GET /basic/meta/messaging-protocols",
  "basic custom-token": "GET /basic/meta/custom-token",
  "basic quote": "GET /basic/quote",
  "basic swap": "GET /basic/swap",
  "basic status": "GET /basic/status",
  "basic check-approval": "GET /basic/is-approved",
  "basic report-tx": "POST /basic/report-tx",
  "basic balance": "GET /basic/balance",
  "basic token-balance": "GET /basic/token-balance",
  "basic connected-assets": "GET /basic/connected-assets",
  "main meta": "GET /meta",
  "main compact-meta": "GET /meta/compact",
  "main blockchains": "GET /meta/blockchains",
  "main swappers": "GET /meta/swappers",
  "main custom-token": "GET /meta/custom-token",
  "main contracts": "GET /meta/rango-contracts",
  "main best-route": "POST /routing/best",
  "main best-routes": "POST /routing/bests",
  "main confirm-route": "POST /routing/confirm",
  "main create-tx": "POST /tx/create",
  "main check-tx-status": "POST /tx/check-status",
  "main check-approval": "GET /tx/{requestId}/check-approval",
  "main report-tx": "POST /tx/report-tx",
  "main token-balance": "GET /wallets/token-balance",
  "main multiple-token-balance": "POST /wallets/multiple-token-balance",
};

/** Longer enums are lists of every blockchain or failure code: stale in a copy, and no help to a reader. */
const MAX_ENUM = 20;

async function get(url) {
  const response = await fetch(url, { headers: { "user-agent": "rango-cli sync-openapi" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

/** The reference pages of the Basic and Main APIs, from the site's index. */
async function referencePages() {
  const index = await get(`${SITE}/llms.txt`);
  const pages = [];
  for (const section of index.split(/^## /m)) {
    if (!/^Reference: .*\b(Basic|Main) API/.test(section)) continue;
    for (const match of section.matchAll(/\((https:\/\/[^)\s]+\/reference\/([a-z0-9-]+))\.md\)/g)) {
      pages.push({ url: match[1], slug: match[2] });
    }
  }
  if (pages.length === 0) throw new Error(`No reference pages found in ${SITE}/llms.txt`);
  return pages;
}

/** "METHOD /path" → { slug, operation, schemas } for every endpoint the reference documents. */
async function endpoints() {
  const found = new Map();
  for (const page of await referencePages()) {
    const markdown = await get(`${page.url}.md`);
    const block = /```json\n([\s\S]*?)\n```/.exec(markdown);
    if (!block) throw new Error(`${page.url}.md has no OpenAPI definition`);
    const spec = JSON.parse(block[1]);
    for (const [path, methods] of Object.entries(spec.paths ?? {})) {
      for (const [method, operation] of Object.entries(methods)) {
        found.set(`${method.toUpperCase()} ${path}`, {
          slug: page.slug,
          operation,
          schemas: spec.components?.schemas ?? {},
        });
      }
    }
  }
  return found;
}

const refName = (ref) => ref.split("/").pop();
const text = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

/**
 * Trim one OpenAPI schema. A $ref stays a reference by name and is queued, so
 * a shared shape (a token, a transaction) is stored once.
 */
function trim(schema, schemas, queue) {
  if (schema.$ref) {
    queue.add(refName(schema.$ref));
    return { $ref: refName(schema.$ref) };
  }
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants?.length === 1) return trim(variants[0], schemas, queue);

  const out = {};
  const object = fold(schema, schemas, queue);
  const hasFields = Object.keys(object.properties).length > 0;
  out.type = schema.type ?? (hasFields || variants ? "object" : undefined);
  if ((out.type === "integer" || out.type === "number") && schema.format) out.format = schema.format;
  if (text(schema.description)) out.description = text(schema.description);
  if (Array.isArray(schema.enum) && schema.enum.length <= MAX_ENUM) out.enum = schema.enum.map(String);
  if (hasFields) {
    out.properties = object.properties;
    const required = [...object.required].filter((name) => name in object.properties);
    if (required.length > 0) out.required = required;
  }
  if (schema.items) out.items = trim(schema.items, schemas, queue);
  if (variants) out.oneOf = variants.map((variant) => trim(variant, schemas, queue));
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out;
}

/** An object's own fields plus those of every allOf part: the reference spells inheritance that way. */
function fold(schema, schemas, queue) {
  const properties = {};
  const required = new Set();
  for (const part of schema.allOf ?? []) {
    const base = part.$ref ? schemas[refName(part.$ref)] : part;
    if (!base) throw new Error(`Unknown schema ${part.$ref}`);
    const folded = fold(base, schemas, queue);
    Object.assign(properties, folded.properties);
    for (const name of folded.required) required.add(name);
  }
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    properties[name] = trim(property, schemas, queue);
  }
  for (const name of schema.required ?? []) required.add(name);
  return { properties, required };
}

const documented = await endpoints();
const operations = {};
const schemas = {};

for (const [name, endpoint] of Object.entries(OPERATIONS)) {
  const entry = documented.get(endpoint);
  if (!entry) throw new Error(`${SITE} does not document ${endpoint} (${name})`);
  const ok = entry.operation.responses?.["200"]?.content;
  const response = ok && Object.values(ok)[0]?.schema;
  if (!response) throw new Error(`${endpoint} has no 200 response schema`);

  const queue = new Set();
  // The response itself is written in place: two surfaces reuse a name such as
  // CheckApprovalResponse for different shapes.
  const top = response.$ref ? entry.schemas[refName(response.$ref)] : response;
  const [method, path] = endpoint.split(" ");
  operations[name] = { method, path, docs: entry.slug, response: trim(top, entry.schemas, queue) };

  for (const schemaName of queue) {
    const source = entry.schemas[schemaName];
    if (!source) throw new Error(`${endpoint} refers to an unknown schema ${schemaName}`);
    const trimmed = trim(source, entry.schemas, queue); // may queue more; a Set iterates those too
    const known = schemas[schemaName];
    if (known && JSON.stringify(known) !== JSON.stringify(trimmed)) {
      throw new Error(`${schemaName} is defined differently by ${endpoint} and an earlier endpoint`);
    }
    schemas[schemaName] = trimmed;
  }
}

// One operation and one schema per line: small in the repository, and a change
// in the reference shows up as a one-line diff.
const lines = (record) =>
  Object.entries(record)
    .map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join(",\n");
const sorted = Object.fromEntries(Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b)));

writeFileSync(
  TARGET,
  `{\n  "source": ${JSON.stringify(`${SITE}/reference`)},\n  "operations": {\n${lines(operations)}\n  },\n  "schemas": {\n${lines(sorted)}\n  }\n}\n`,
);
console.log(
  `${Object.keys(operations).length} operations, ${Object.keys(schemas).length} schemas → ${TARGET}`,
);
