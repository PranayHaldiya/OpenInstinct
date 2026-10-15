import { defineAgent, defineDynamic } from "eve";
import { resolveModel } from "@agent/lib/direct-model";

// A static definition, so a direct provider model can be resolved per step;
// dynamic subagent definitions must serialize. Mode gating lives on the
// run_browser tool, the only caller.
export default defineAgent({
  build: {
    externalDependencies: ["@onkernel/browser-loop"],
  },
  tool: false,
  description:
    "Execute one bounded browser assignment for the root coordinator, including secure vault autofill, transaction preparation, optional durable browser images, human-takeover handoff, cleanup, and a concise verified result.",
  model: defineDynamic({
    events: {
      "step.started": () => resolveModel("meta/muse-spark-1.3"),
    },
  }),
  reasoning: "low",
  compaction: {
    thresholdPercent: 0.7,
  },
});
