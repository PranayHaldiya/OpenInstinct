import { listUpcomingScheduledRuns } from "@db/services/scheduled-agent-jobs";

// Maritime polls this while the VM is awake and wakes the VM shortly before
// each listed time, so schedules fire even though idle VMs sleep. It exposes
// only opaque ids and times.
export async function GET() {
  const runs = await listUpcomingScheduledRuns();
  return Response.json(
    runs.flatMap((run) =>
      run.nextRunAt
        ? [{ id: run.id, nextRunAt: run.nextRunAt.toISOString() }]
        : []
    ),
    { headers: { "cache-control": "no-store" } }
  );
}
