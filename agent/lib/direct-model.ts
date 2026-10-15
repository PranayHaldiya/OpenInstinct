import { isDeepStrictEqual } from "node:util";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { anthropic } from "eve/models/anthropic";
import { env } from "@shared/environment";

const defaultDirectAnthropicModel = "claude-sonnet-5-5";

type CallOptions = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0]["params"];
type ToolInputSchema = Extract<
  NonNullable<CallOptions["tools"]>[number],
  { type: "function" }
>["inputSchema"];
type SchemaDefinition = NonNullable<ToolInputSchema["properties"]>[string];

/**
 * Self-hosted installs without AI Gateway credentials can run on an Anthropic
 * API key alone. Gateway Anthropic ids are translated to native ids; any other
 * gateway id falls back to the default Claude model. Installs with gateway
 * credentials (an API key, or Vercel's project OIDC) keep gateway routing.
 */
export function resolveModel(gatewayModelId: string) {
  if (!env.ANTHROPIC_API_KEY || env.AI_GATEWAY_API_KEY || env.VERCEL_ENV) {
    return gatewayModelId;
  }
  const model = anthropic(
    nativeAnthropicModelId(gatewayModelId) ?? defaultDirectAnthropicModel
  );
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- eve's helper is typed as the full LanguageModel union, which includes gateway id strings, but always returns a provider model object.
  if (typeof model === "string") return model;
  return wrapLanguageModel({ middleware: objectRootToolSchemas, model });
}

/** Maps `anthropic/claude-sonnet-5.5` to Anthropic's native `claude-sonnet-5-5`. */
export function nativeAnthropicModelId(gatewayModelId: string) {
  const modelId = /^anthropic\/(claude-[a-z0-9.-]+)$/.exec(gatewayModelId)?.[1];
  return modelId?.replaceAll(".", "-");
}

// Anthropic requires every tool's input_schema to be an object at the root,
// while union tool inputs (send_message's message | link, for example) compile
// to a root anyOf. The model sees one object with every variant's fields; each
// tool still validates its call against its own schema.
const objectRootToolSchemas: LanguageModelMiddleware = {
  transformParams: async ({ params }) => ({
    ...params,
    tools: params.tools?.map((tool) =>
      tool.type === "function"
        ? { ...tool, inputSchema: objectRootSchema(tool.inputSchema) }
        : tool
    ),
  }),
};

export function objectRootSchema(schema: ToolInputSchema): ToolInputSchema {
  if (schema.type === "object") return schema;
  const { anyOf, oneOf, ...rest } = schema;
  const variants = (anyOf ?? oneOf ?? []).filter(
    (variant) => variant !== true && variant !== false
  );
  if (variants.length === 0 || variants.some((v) => v.type !== "object")) {
    return { ...schema, type: "object" };
  }

  const properties: Record<string, SchemaDefinition> = {};
  for (const variant of variants) {
    for (const [name, property] of Object.entries(variant.properties ?? {})) {
      const existing = properties[name];
      properties[name] =
        existing === undefined ? property : mergeProperty(existing, property);
    }
  }
  const merged: ToolInputSchema = { ...rest, type: "object", properties };
  const required = variants
    .map((variant) => variant.required ?? [])
    .reduce((shared, next) => shared.filter((name) => next.includes(name)));
  if (required.length > 0) merged.required = required;
  if (variants.every((variant) => variant.additionalProperties === false)) {
    merged.additionalProperties = false;
  }
  return merged;
}

function mergeProperty(
  left: SchemaDefinition,
  right: SchemaDefinition
): SchemaDefinition {
  if (isDeepStrictEqual(left, right)) return left;
  if (left === true || left === false || right === true || right === false) {
    return { anyOf: [left, right] };
  }
  // Discriminators such as `kind` merge their literal values into one enum.
  if (right.const !== undefined && left.type === right.type) {
    if (left.const !== undefined) {
      return { type: left.type, enum: [left.const, right.const] };
    }
    if (left.enum !== undefined) {
      return { ...left, enum: [...left.enum, right.const] };
    }
  }
  return { anyOf: [...(left.anyOf ?? [left]), right] };
}
