import { defineSchedule } from "eve/schedules";
import { ingestJobs } from "@agent/lib/jobs/ingest";
import { env } from "@shared/environment";

// Shared job ingest: fetch sources, refresh boards and screen new postings.
// No model turn runs here; per-user matching happens when the agent asks.
export default defineSchedule({
  cron: "17 */4 * * *",
  run({ waitUntil }) {
    // Per-user VMs read the hub's index instead of fetching their own.
    if (env.OI_ROLE === "user") return;
    waitUntil(runIngest());
  },
});

async function runIngest() {
  try {
    console.info("[jobs] ingest finished", await ingestJobs());
  } catch (error) {
    console.error("[jobs] ingest failed", error);
  }
}
