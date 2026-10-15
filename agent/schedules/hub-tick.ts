import { defineSchedule } from "eve/schedules";
import { hubTick } from "@agent/lib/hub/router";
import { env } from "@shared/environment";

// Hub only: finish provisioning new users' VMs and deliver queued messages.
export default defineSchedule({
  cron: "* * * * *",
  run({ waitUntil }) {
    if (env.OI_ROLE !== "hub") return;
    waitUntil(runHubTick());
  },
});

async function runHubTick() {
  try {
    await hubTick();
  } catch (error) {
    console.error("[hub] tick failed", error);
  }
}
