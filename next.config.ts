import type { NextConfig } from "next";
import { withEve } from "eve/next";
import { publicEnv } from "./shared/environment/public/env";

const nextConfig: NextConfig = {};
// The Maritime VM image ships Next's traced standalone server only.
// oxlint-disable-next-line eslint/no-restricted-properties -- a build-time switch the Dockerfile sets for the Next config itself
if (process.env.NEXT_OUTPUT_STANDALONE === "1") {
  nextConfig.output = "standalone";
}

// Serves the app under a path prefix. The Maritime image builds with a
// placeholder prefix that its VM launcher swaps for `/a/<agentId>` at boot.
if (publicEnv.NEXT_PUBLIC_BASE_PATH) {
  nextConfig.basePath = publicEnv.NEXT_PUBLIC_BASE_PATH;
}

export default withEve(nextConfig);
