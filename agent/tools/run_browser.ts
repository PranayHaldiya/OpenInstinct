import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { resolveModeValue } from "@agent/lib/mode";
import { taskCompletionSchema } from "@agent/subagents/browser-agent/lib/completion";

export default defineWorkflowTool({
  description:
    "Execute one bounded browser assignment and return a verified result with optional private image artifacts. Pass agentId to continue a parked worker. The completion schema is supplied automatically.",
  inputSchema: z.object({
    message: z.string().min(1),
    agentId: z.string().optional(),
  }),
  execution: "background",
  async execute(input, ctx) {
    "use workflow";
    // Scheduled reports only deliver results; they never start browser work.
    // Workflow tools must stay static, so the mode check runs here.
    if (
      !resolveModeValue(ctx, { interactive: true, "scheduled-worker": true })
    ) {
      throw new Error(
        "Browser work is unavailable while reporting a scheduled result."
      );
    }
    const result = await ctx.agent("browser-agent", {
      ...input,
      outputSchema: z
        .record(z.string(), z.json())
        .parse(z.toJSONSchema(taskCompletionSchema)),
    });
    return taskCompletionSchema.parse(result);
  },
});
