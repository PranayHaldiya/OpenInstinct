import {
  defaultTelegramAuth,
  telegramChannel,
  type TelegramContext,
  type TelegramMessage,
} from "eve/channels/telegram";
import {
  ensureTelegramOwner,
  findUserIdByTelegramUserId,
  redeemTelegramLinkCode,
} from "@db/services/telegram-links";
import { ensureScope } from "@db/services/scope";
import type { z } from "zod";
import {
  sendMessageToolResultSchema,
  type sendMessageOutputSchema,
} from "@shared/chat/message-delivery";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { env } from "@shared/environment";
import {
  extractImageArtifactMarkdownReferences,
  stripImageArtifactMarkdownReferences,
} from "../lib/linq-image-artifact/markdown";
import {
  maxDocumentBytes,
  saveTelegramDocuments,
  telegramFetch,
} from "@agent/lib/jobs/telegram-upload";
import {
  finalizeScheduledReportDelivery,
  scheduledReportFromSession,
} from "@agent/lib/schedules/report-lifecycle";

const botUsername = env.TELEGRAM_BOT_USERNAME;
const unlinkedReply =
  "I don't know who you are yet. Open your OpenInstinct workspace and tap Connect Telegram.";

export default telegramChannel({
  api: { fetch: telegramFetch },
  botUsername,
  credentials: {
    botToken: env.TELEGRAM_BOT_TOKEN,
    // Without a configured secret, reject every webhook rather than trusting it.
    ...(env.TELEGRAM_WEBHOOK_SECRET_TOKEN
      ? { webhookSecretToken: env.TELEGRAM_WEBHOOK_SECRET_TOKEN }
      : { webhookVerifier: () => false }),
  },
  events: {
    async "action.result"(event, channel, session) {
      const message = sendMessageToolResultSchema.safeParse(event.result);
      if (event.status !== "completed" || !message.success) return;
      await channel.telegram.post(telegramText(message.data.output));
      await finalizeScheduledReportDelivery(session);
    },
    // As with Linq, only send_message reaches the user. Final assistant text,
    // such as the DELIVERY_COMPLETE terminator, stays internal.
    async "message.completed"(event, _channel, session) {
      if (event.finishReason === "tool-calls") return;
      if (scheduledReportFromSession(session)) {
        await finalizeScheduledReportDelivery(session, "suppressed");
      }
    },
  },
  async onMessage(context, message) {
    const sender = message.from;
    if (!sender || sender.isBot) return null;
    const isPrivate = message.chat.type === "private";

    const linkCode = /^\/start(?:@[A-Za-z0-9_]+)?\s+(\S+)$/.exec(
      message.text.trim()
    )?.[1];
    if (isPrivate && linkCode) {
      const linkedUserId = await redeemTelegramLinkCode(linkCode, sender.id);
      await context.telegram.post(
        linkedUserId
          ? "Connected. Text me whenever you need something."
          : "That link has expired. Tap Connect Telegram in your workspace for a new one."
      );
      return null;
    }

    if (!shouldDispatch(message)) return null;
    const userId =
      (await findUserIdByTelegramUserId(sender.id)) ??
      (await claimDeploymentOwner(sender));
    if (!userId) {
      // Only the linked account authenticates a principal; never mint one for
      // an unknown Telegram user, and stay quiet in groups.
      if (isPrivate) await notifyUnlinked(context);
      return null;
    }
    const auth = defaultTelegramAuth(message);
    if (!auth) return null;
    await context.telegram.startTyping();
    const principalId = `better-auth:${userId}`;
    const scope = accessScopeForUser(principalId);
    const uploads = isPrivate
      ? await saveTelegramDocuments(scope, message.attachments)
      : [];
    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          conversationChannel: "telegram",
          conversationId: `telegram:${message.chat.id}`,
          workspaceId: scope.workspaceId,
        },
        principalId,
      },
      context: uploads,
    };
  },
  // The model reads PDFs and images the user sends; Word files are only
  // saved as job documents.
  uploadPolicy: {
    allowedMediaTypes: ["application/pdf", "image/*"],
    maxBytes: maxDocumentBytes,
  },
});

/**
 * A per-user deployment knows its one owner from the environment; their first
 * message links them without a web sign-in. Anyone else stays unlinked.
 */
async function claimDeploymentOwner(
  sender: NonNullable<TelegramMessage["from"]>
) {
  if (!env.OWNER_TELEGRAM_USER_ID || sender.id !== env.OWNER_TELEGRAM_USER_ID) {
    return undefined;
  }
  const userId = await ensureTelegramOwner({
    name: sender.firstName ?? sender.username ?? "Telegram user",
    telegramUserId: sender.id,
  });
  await ensureScope(accessScopeForUser(`better-auth:${userId}`));
  return userId;
}

function shouldDispatch(message: TelegramMessage) {
  const text = message.text || message.caption;
  if (!text.trim() && message.attachments.length === 0) return false;
  if (message.chat.type === "private") return true;
  if (message.chat.type === "channel") return false;
  if (message.replyToMessage?.from?.isBot) return true;
  return (
    botUsername !== undefined &&
    text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)
  );
}

async function notifyUnlinked(context: TelegramContext) {
  await context.telegram.post(unlinkedReply);
}

function telegramText(output: z.infer<typeof sendMessageOutputSchema>) {
  if (output.kind === "link") return output.url;
  const text = output.text ?? "";
  // Browser image artifacts are private; Telegram delivery is text-only for now.
  const imageNote =
    extractImageArtifactMarkdownReferences(text).length > 0
      ? "(I took a screenshot, but I can't send images on Telegram yet.)"
      : undefined;
  return [
    stripImageArtifactMarkdownReferences(text),
    ...(output.attachments?.map((attachment) => attachment.url) ?? []),
    imageNote,
  ]
    .filter(Boolean)
    .join("\n\n");
}
