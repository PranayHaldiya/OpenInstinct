import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const publicEnv = createEnv({
  client: {
    // The path the app is served under, inlined at build. The Maritime image
    // builds with a placeholder the VM launcher swaps for `/a/<agentId>`.
    NEXT_PUBLIC_BASE_PATH: z
      .string()
      .regex(/^(?:\/[\w.-]+)*$/, "NEXT_PUBLIC_BASE_PATH must look like /a/id")
      .default(""),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH,
  },
  emptyStringAsUndefined: true,
});

/**
 * Prefixes a root-relative app path with the base path, for URLs Next.js
 * doesn't rewrite itself: fetch endpoints, form actions, `location` changes
 * and image sources. `<Link>`, `redirect()` and the router already add it.
 */
export function withBasePath(path: string) {
  return `${publicEnv.NEXT_PUBLIC_BASE_PATH}${path}`;
}
