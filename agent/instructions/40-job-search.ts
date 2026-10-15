import { defineDynamic } from "eve/instructions";
import { resolveModeInstructions } from "@agent/lib/mode";
import jobSearch from "./content/job-search.md?raw";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeInstructions(context, {
        interactive: jobSearch,
        "scheduled-worker": jobSearch,
      }),
  },
});
