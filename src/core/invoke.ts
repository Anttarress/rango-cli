import type { ZodError } from "zod";
import type { Operation } from "../catalog/types.js";
import { invalidArgs } from "./errors.js";
import { request } from "./http.js";

function describeIssues(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(input)"}: ${issue.message}`).join("; ");
}

/** Validate input against the operation's schema, build the request, send it. */
export async function invoke(op: Operation, rawInput: unknown): Promise<unknown> {
  const parsed = op.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    throw invalidArgs(`Invalid input for ${op.surface} ${op.name}: ${describeIssues(parsed.error)}`);
  }
  const spec = op.request(parsed.data);
  return request(spec.method, spec.path, { params: spec.params, body: spec.body });
}
