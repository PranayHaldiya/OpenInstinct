"use client";

import { SendIcon } from "lucide-react";
import { Button } from "@web/components/ui/button";
import { api } from "@web/trpc/client";

export function TelegramConnectAction({
  linked,
}: {
  readonly linked: boolean;
}) {
  const createLink = api.telegram.createLink.useMutation({
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  return (
    <Button
      disabled={createLink.isPending}
      onClick={() => {
        createLink.mutate();
      }}
      type="button"
      variant="surface"
    >
      <SendIcon />
      {linked ? "Telegram (relink)" : "Connect Telegram"}
    </Button>
  );
}
