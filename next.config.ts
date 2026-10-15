import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {};
// The Maritime VM image ships Next's traced standalone server only.
// oxlint-disable-next-line eslint/no-restricted-properties -- a build-time switch the Dockerfile sets for the Next config itself
if (process.env.NEXT_OUTPUT_STANDALONE === "1") {
  nextConfig.output = "standalone";
}

export default withEve(nextConfig);
