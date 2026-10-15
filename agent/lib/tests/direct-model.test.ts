import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  nativeAnthropicModelId,
  objectRootSchema,
} from "@agent/lib/direct-model";
import { sendMessageOutputSchema } from "@shared/chat/message-delivery";

afterEach(() => {
  vi.doUnmock("@shared/environment");
  vi.resetModules();
});

async function resolveWith(environment: Record<string, string | undefined>) {
  vi.doMock("@shared/environment", () => ({ env: environment }));
  const { resolveModel } = await import("@agent/lib/direct-model");
  return resolveModel;
}

describe("direct model routing", () => {
  it("maps gateway Anthropic ids to native ids", () => {
    expect(nativeAnthropicModelId("anthropic/claude-sonnet-5.5")).toBe(
      "claude-sonnet-5-5"
    );
    expect(nativeAnthropicModelId("anthropic/claude-opus-4.6")).toBe(
      "claude-opus-4-6"
    );
    expect(nativeAnthropicModelId("meta/muse-spark-1.3")).toBeUndefined();
    expect(nativeAnthropicModelId("anthropic/../other")).toBeUndefined();
  });

  it("keeps gateway routing when gateway credentials exist", async () => {
    const withGatewayKey = await resolveWith({
      AI_GATEWAY_API_KEY: "gateway-key",
      ANTHROPIC_API_KEY: "anthropic-key",
    });
    expect(withGatewayKey("meta/muse-spark-1.3")).toBe("meta/muse-spark-1.3");

    vi.resetModules();
    const onVercel = await resolveWith({
      ANTHROPIC_API_KEY: "anthropic-key",
      VERCEL_ENV: "production",
    });
    expect(onVercel("anthropic/claude-sonnet-5.5")).toBe(
      "anthropic/claude-sonnet-5.5"
    );

    vi.resetModules();
    const withoutAnthropic = await resolveWith({});
    expect(withoutAnthropic("openai/gpt-6.1-sol-fast")).toBe(
      "openai/gpt-6.1-sol-fast"
    );
  });

  it("calls Anthropic directly with only an Anthropic key", async () => {
    const resolveModel = await resolveWith({
      ANTHROPIC_API_KEY: "anthropic-key",
    });
    expect(resolveModel("anthropic/claude-haiku-5.5")).toMatchObject({
      modelId: "claude-haiku-5-5",
    });
    expect(resolveModel("meta/muse-spark-1.3")).toMatchObject({
      modelId: "claude-sonnet-5-5",
    });
  });

  it("gives union tool inputs an object root for Anthropic", () => {
    // SAFETY: zod emits draft-7 JSON Schema objects for these tool inputs.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The test feeds zod's JSON Schema output to the middleware's schema type.
    const sendMessage = z.toJSONSchema(sendMessageOutputSchema, {
      io: "input",
      target: "draft-7",
    }) as Parameters<typeof objectRootSchema>[0];
    expect(sendMessage.type).toBeUndefined();

    const schema = objectRootSchema(sendMessage);
    expect(schema.type).toBe("object");
    expect(schema.anyOf).toBeUndefined();
    expect(Object.keys(schema.properties ?? {}).toSorted()).toEqual([
      "attachments",
      "kind",
      "replyTo",
      "text",
      "url",
    ]);
    expect(schema.properties?.kind).toEqual({
      type: "string",
      enum: ["message", "link"],
    });
    expect(schema.required).toEqual(["kind"]);

    const plainObject = { type: "object" as const, properties: {} };
    expect(objectRootSchema(plainObject)).toBe(plainObject);
  });
});
