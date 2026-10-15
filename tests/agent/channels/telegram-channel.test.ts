import type {
  TelegramChannelConfig,
  TelegramMessage,
} from "eve/channels/telegram";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessScopeForUser } from "@shared/identity/access-scope";

const channelCapture = vi.hoisted(() => {
  const configs: TelegramChannelConfig[] = [];
  return { configs };
});
const links = vi.hoisted(() => ({
  findUserIdByTelegramUserId:
    vi.fn<(id: string) => Promise<string | undefined>>(),
  redeemTelegramLinkCode:
    vi.fn<(code: string, id: string) => Promise<string | undefined>>(),
}));
const reports = vi.hoisted(() => ({
  finalizeScheduledReportDelivery: vi.fn<() => Promise<void>>(),
  scheduledReportFromSession: vi.fn<() => undefined>(),
}));

vi.mock(import("eve/channels/telegram"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    telegramChannel(config?: TelegramChannelConfig) {
      if (config) channelCapture.configs.push(config);
      return original.telegramChannel(config);
    },
  };
});
vi.mock("@shared/environment", () => ({
  env: {
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_BOT_USERNAME: "job_bot",
    TELEGRAM_WEBHOOK_SECRET_TOKEN: "test-secret",
  },
}));
vi.mock("@db/services/telegram-links", () => links);
vi.mock("@agent/lib/schedules/report-lifecycle", () => reports);

// Loads the production channel so the mocked factory captures its configuration.
await import("@agent/channels/telegram");

const config = channelCapture.configs[0];
const handleActionResult = config?.events?.["action.result"];
const handleMessageCompleted = config?.events?.["message.completed"];
const onMessage = config?.onMessage;
if (!handleActionResult || !handleMessageCompleted || !onMessage) {
  throw new Error("The Telegram channel must configure delivery and auth.");
}

function telegramContext() {
  const telegram = {
    post: vi
      .fn<(text: string) => Promise<{ id: string; raw: unknown }>>()
      .mockResolvedValue({ id: "1", raw: {} }),
    startTyping: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  // SAFETY: the channel handlers under test only call post and startTyping.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- A focused fake stands in for eve's Telegram handle.
  return { context: { telegram } as never, telegram };
}

// SAFETY: scheduled report lookups are mocked, so the session is never read.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The mocked report lifecycle ignores the session.
const session = {} as never;

function message(
  text: string,
  chat: TelegramMessage["chat"] = { id: "42", type: "private" }
): TelegramMessage {
  return {
    attachments: [],
    caption: "",
    chat,
    from: { id: "42", isBot: false, firstName: "Pranay" },
    messageId: "7",
    raw: {},
    text,
  };
}

describe("Telegram channel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reports.finalizeScheduledReportDelivery.mockResolvedValue(undefined);
  });

  it("keeps final assistant text such as DELIVERY_COMPLETE internal", async () => {
    const { context, telegram } = telegramContext();
    await handleMessageCompleted(
      {
        finishReason: "stop",
        message: "DELIVERY_COMPLETE",
        sequence: 1,
        stepIndex: 1,
        turnId: "turn-1",
      },
      context,
      session
    );
    expect(telegram.post).not.toHaveBeenCalled();
  });

  it("delivers send_message text", async () => {
    const { context, telegram } = telegramContext();
    await handleActionResult(
      {
        result: {
          callId: "call-1",
          kind: "tool-result",
          output: { kind: "message", text: "hola! what can I get done?" },
          toolName: "send_message",
        },
        sequence: 0,
        status: "completed",
        stepIndex: 0,
        turnId: "turn-1",
      },
      context,
      session
    );
    expect(telegram.post).toHaveBeenCalledExactlyOnceWith(
      "hola! what can I get done?"
    );
  });

  it("authenticates a linked Telegram user as their workspace user", async () => {
    links.findUserIdByTelegramUserId.mockResolvedValue("user-1");
    const { context, telegram } = telegramContext();
    const result = await onMessage(context, message("find me roles"));
    const scope = accessScopeForUser("better-auth:user-1");
    expect(result?.auth).toMatchObject({
      attributes: {
        conversationChannel: "telegram",
        conversationId: "telegram:42",
        workspaceId: scope.workspaceId,
      },
      principalId: scope.userId,
    });
    expect(telegram.startTyping).toHaveBeenCalledOnce();
  });

  it("never dispatches an unlinked Telegram user", async () => {
    links.findUserIdByTelegramUserId.mockResolvedValue(undefined);
    const { context, telegram } = telegramContext();
    expect(await onMessage(context, message("hi"))).toBeNull();
    expect(telegram.post).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("Connect Telegram")
    );
  });

  it("redeems a /start link code without dispatching it", async () => {
    links.redeemTelegramLinkCode.mockResolvedValue("user-1");
    const { context, telegram } = telegramContext();
    expect(
      await onMessage(context, message("/start AAAAAAAAAAAAAAAAAAAAAA"))
    ).toBeNull();
    expect(links.redeemTelegramLinkCode).toHaveBeenCalledExactlyOnceWith(
      "AAAAAAAAAAAAAAAAAAAAAA",
      "42"
    );
    expect(telegram.post).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("Connected")
    );
  });

  it("answers groups only when mentioned", async () => {
    links.findUserIdByTelegramUserId.mockResolvedValue("user-1");
    const group = { id: "-100", type: "supergroup" as const };
    const { context } = telegramContext();
    expect(await onMessage(context, message("any leads?", group))).toBeNull();
    expect(links.findUserIdByTelegramUserId).not.toHaveBeenCalled();
    expect(
      await onMessage(context, message("@job_bot any leads?", group))
    ).not.toBeNull();
  });
});
