import { z } from "zod";
import { env } from "@shared/environment";

const apiBase = "https://api.maritime.sh";

const maritimeAgentSchema = z.object({
  id: z.string(),
  publicUrl: z.string().nullish(),
  status: z.string(),
});

function apiKey() {
  if (!env.MARITIME_API_KEY) throw new Error("MARITIME_API_KEY is not set.");
  return env.MARITIME_API_KEY;
}

async function maritimeRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(new URL(path, apiBase), {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey()}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Maritime ${init.method ?? "GET"} ${path} failed: ${String(response.status)} ${text.slice(0, 300)}`
    );
  }
  const body: unknown = text ? JSON.parse(text) : null;
  return body;
}

/**
 * Creates the end user's agent exactly once (a repeat call returns the same
 * agent) from the shared user image, with its own environment.
 */
export async function provisionUserAgent(input: {
  readonly environment: Readonly<Record<string, string>>;
  readonly externalId: string;
  readonly image: string;
  readonly name: string;
}) {
  return maritimeAgentSchema.parse(
    await maritimeRequest(
      `/api/v1/end-users/${encodeURIComponent(input.externalId)}/agents`,
      {
        body: JSON.stringify({
          exposedPort: 8080,
          framework: "custom",
          idleTtlSeconds: 900,
          imageName: input.image,
          initialEnvVars: Object.entries(input.environment).map(
            ([key, value]) => ({ isSecret: true, key, value })
          ),
          name: input.name,
          publicWeb: true,
        }),
        method: "POST",
      }
    )
  );
}

export async function getMaritimeAgent(agentId: string) {
  return maritimeAgentSchema.parse(
    await maritimeRequest(`/api/agents/${encodeURIComponent(agentId)}`)
  );
}
