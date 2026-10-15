import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  claimHubUser,
  drainHubUpdates,
  getHubUser,
  listHubUsersByStatus,
  listUsersWithPendingUpdates,
  queueHubUpdate,
  updateHubUser,
  type HubUser,
} from "@db/services/hub/users";
import { env } from "@shared/environment";
import { getMaritimeAgent, provisionUserAgent } from "./maritime";
import { sendTelegramText } from "./telegram-api";
import { hubTokenFor } from "./token";

const senderSchema = z.object({
  first_name: z.string().optional(),
  id: z.number(),
  is_bot: z.boolean().optional(),
  username: z.string().optional(),
});
const chatSchema = z.object({ id: z.number() });
/** A raw Telegram update; the hub reads only who sent it and forwards it whole. */
export const telegramUpdateSchema = z.looseObject({ update_id: z.number() });
type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

const updateSchema = z.object({
  callback_query: z
    .object({
      from: senderSchema,
      message: z.object({ chat: chatSchema }).optional(),
    })
    .optional(),
  edited_message: z
    .object({ chat: chatSchema, from: senderSchema.optional() })
    .optional(),
  message: z
    .object({ chat: chatSchema, from: senderSchema.optional() })
    .optional(),
});

// A VM that hasn't answered its health check this long after creation failed.
const provisioningDeadlineMs = 15 * 60_000;
const readyStatuses = new Set(["active", "running", "sleeping", "idle"]);

function sender(update: z.infer<typeof updateSchema>) {
  const from =
    update.message?.from ??
    update.edited_message?.from ??
    update.callback_query?.from;
  const chat =
    update.message?.chat ??
    update.edited_message?.chat ??
    update.callback_query?.message?.chat;
  if (!from || from.is_bot) return undefined;
  return {
    chatId: String(chat?.id ?? from.id),
    name: from.first_name ?? from.username ?? "Telegram user",
    telegramUserId: String(from.id),
  };
}

/** Routes one Telegram update to its sender's VM, creating the VM first. */
export async function routeTelegramUpdate(raw: TelegramUpdate) {
  const parsed = updateSchema.safeParse(raw);
  const from = parsed.success ? sender(parsed.data) : undefined;
  if (!from) return;
  const existing = await getHubUser(from.telegramUserId);
  if (existing?.status === "ready") {
    if (await forwardUpdate(existing, raw)) return;
    await queueHubUpdate(from.telegramUserId, raw);
    return;
  }
  await queueHubUpdate(from.telegramUserId, raw);
  if (existing?.status === "failed") {
    await sendTelegramText(
      from.chatId,
      "Your agent couldn't start. I've let the team know; try again in a little while."
    );
    return;
  }
  if (existing) return;
  const claim = await claimHubUser({
    forwardSecret: randomBytes(24).toString("base64url"),
    name: from.name,
    telegramUserId: from.telegramUserId,
  });
  if (!claim.created || !claim.user) return;
  await sendTelegramText(
    from.chatId,
    "Hi! I'm setting up your own private agent. It runs on its own machine, so give it about a minute."
  );
  await provision(claim.user);
}

async function provision(user: HubUser) {
  if (!env.OI_USER_IMAGE || !env.OI_HUB_SECRET) {
    throw new Error("The hub needs OI_USER_IMAGE and OI_HUB_SECRET.");
  }
  const shared = Object.fromEntries(
    (
      [
        "ANTHROPIC_API_KEY",
        "KERNEL_API_KEY",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_BOT_USERNAME",
      ] as const
    ).flatMap((key) => {
      const value = env[key];
      return value ? [[key, value]] : [];
    })
  );
  try {
    const agent = await provisionUserAgent({
      environment: {
        ...shared,
        OI_HUB_TOKEN: hubTokenFor(env.OI_HUB_SECRET, user.telegramUserId),
        OI_HUB_URL: hubPublicUrl(),
        OI_ROLE: "user",
        OWNER_NAME: user.name,
        OWNER_TELEGRAM_USER_ID: user.telegramUserId,
        TELEGRAM_WEBHOOK_SECRET_TOKEN: user.forwardSecret,
      },
      externalId: `tg_${user.telegramUserId}`,
      image: env.OI_USER_IMAGE,
      name: `oi-${user.telegramUserId}`,
    });
    await updateHubUser(user.telegramUserId, {
      agentId: agent.id,
      publicUrl: agent.publicUrl ?? null,
    });
  } catch (error) {
    console.error("[hub] provisioning failed", {
      cause: error,
      telegramUserId: user.telegramUserId,
    });
    await updateHubUser(user.telegramUserId, {
      lastError: error instanceof Error ? error.message : String(error),
      status: "failed",
    });
  }
}

function hubPublicUrl() {
  if (!env.OI_PUBLIC_URL) throw new Error("The hub needs OI_PUBLIC_URL.");
  return env.OI_PUBLIC_URL;
}

async function forwardUpdate(user: HubUser, update: TelegramUpdate) {
  if (!user.publicUrl) return false;
  try {
    const response = await fetch(
      new URL("eve/v1/telegram", `${user.publicUrl.replace(/\/$/, "")}/`),
      {
        body: JSON.stringify(update),
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": user.forwardSecret,
        },
        method: "POST",
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (response.ok) return true;
    console.warn("[hub] forward failed", {
      status: response.status,
      telegramUserId: user.telegramUserId,
    });
  } catch (error) {
    console.warn("[hub] forward failed", {
      cause: error,
      telegramUserId: user.telegramUserId,
    });
  }
  return false;
}

async function isHealthy(publicUrl: string) {
  try {
    const response = await fetch(
      new URL("eve/v1/health", `${publicUrl.replace(/\/$/, "")}/`),
      { signal: AbortSignal.timeout(30_000) }
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Runs every minute on the hub: promotes VMs that came up, fails ones that
 * never did, and delivers queued updates in order.
 */
export async function hubTick(now = new Date()) {
  for (const user of await listHubUsersByStatus(["provisioning"])) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- few users provision at once; sequential keeps Maritime calls gentle.
    await advanceProvisioning(user, now);
  }
  for (const telegramUserId of await listUsersWithPendingUpdates()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each user's queue drains independently but in order.
    const user = await getHubUser(telegramUserId);
    if (user?.status !== "ready") continue;
    // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
    await drainHubUpdates(telegramUserId, (update) => {
      const parsed = telegramUpdateSchema.safeParse(update);
      // A malformed row can never be delivered; drop it rather than block.
      return parsed.success ? forwardUpdate(user, parsed.data) : true;
    });
  }
}

async function advanceProvisioning(user: HubUser, now: Date) {
  if (!user.agentId) {
    if (now.getTime() - user.createdAt.getTime() > 2 * 60_000) {
      await provision(user);
    }
    return;
  }
  const agent = await getMaritimeAgent(user.agentId).catch(() => undefined);
  const publicUrl = agent?.publicUrl ?? user.publicUrl;
  if (agent && readyStatuses.has(agent.status) && publicUrl) {
    if (await isHealthy(publicUrl)) {
      await updateHubUser(user.telegramUserId, {
        lastError: null,
        publicUrl,
        status: "ready",
      });
      return;
    }
  }
  if (now.getTime() - user.createdAt.getTime() > provisioningDeadlineMs) {
    await updateHubUser(user.telegramUserId, {
      lastError: `Not healthy after provisioning (Maritime status ${agent?.status ?? "unknown"}).`,
      status: "failed",
    });
  }
}
