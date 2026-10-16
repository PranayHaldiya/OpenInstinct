import { listUpcomingScheduledRuns } from "@db/services/scheduled-agent-jobs";
import { env } from "@shared/environment";
import { jobsIngestCron } from "@shared/jobs/schema";

// Maritime polls this while the VM is awake and wakes the VM shortly before
// each listed time, so schedules fire even though idle VMs sleep. It exposes
// only opaque ids and times.
export async function GET() {
  const runs = await listUpcomingScheduledRuns();
  const wakes: Record<string, string | boolean>[] = runs.flatMap((run) =>
    run.nextRunAt
      ? [{ id: run.id, nextRunAt: run.nextRunAt.toISOString() }]
      : []
  );
  // The hub sleeps between messages; wake it for the shared job ingest.
  if (env.OI_ROLE === "hub") {
    wakes.push({
      cron: jobsIngestCron,
      enabled: true,
      id: "jobs-ingest",
      tz: "UTC",
    });
  }
  return Response.json(wakes, { headers: { "cache-control": "no-store" } });
}
