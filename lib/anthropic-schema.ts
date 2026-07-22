const UNSUPPORTED_NUMERIC_OR_LENGTH_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

/**
 * Anthropic's strict-output grammar accepts a narrower JSON Schema subset.
 * Keep the structural schema sent to the provider small, then enforce the
 * original length and numeric bounds in application code.
 */
export function toAnthropicStrictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toAnthropicStrictSchema);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const typeUnion = Array.isArray(input.type) ? input.type : null;
  const anyOf = Array.isArray(input.anyOf) ? input.anyOf : null;
  const nonNullBranch = anyOf?.find(
    (branch) =>
      branch &&
      typeof branch === "object" &&
      (branch as Record<string, unknown>).type !== "null"
  ) as Record<string, unknown> | undefined;
  const hasNullBranch = anyOf?.some(
    (branch) =>
      branch &&
      typeof branch === "object" &&
      (branch as Record<string, unknown>).type === "null"
  );
  const nullableType = typeUnion?.includes("null")
    ? typeUnion.find((type) => type !== "null")
    : null;

  if (nullableType || (hasNullBranch && nonNullBranch)) {
    const branch: Record<string, unknown> = nullableType
      ? { ...input, type: nullableType, anyOf: undefined }
      : { ...input, ...nonNullBranch, anyOf: undefined };
    const type = branch.type;
    const sentinel = type === "integer" || type === "number" ? -1 : "";
    if (Array.isArray(branch.enum) && !branch.enum.includes(sentinel)) {
      branch.enum = [...branch.enum, sentinel];
    }
    const note = type === "integer" || type === "number"
      ? "Use -1 when this filter does not apply."
      : "Use an empty string when this field does not apply.";
    branch.description = `${typeof branch.description === "string" ? `${branch.description} ` : ""}${note}`;
    delete branch.anyOf;
    return toAnthropicStrictSchema(branch);
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (UNSUPPORTED_NUMERIC_OR_LENGTH_KEYWORDS.has(key)) continue;
    if (child === undefined) continue;
    output[key] = toAnthropicStrictSchema(child);
  }
  return output;
}
