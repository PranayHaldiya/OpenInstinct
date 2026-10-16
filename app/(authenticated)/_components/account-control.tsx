"use client";

import { LogOutIcon, UserIcon } from "lucide-react";
import { authClient } from "@web/auth/client";
import { withBasePath } from "@shared/environment/public/env";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@web/components/ui/sidebar";

export function AuthenticatedAccountControl() {
  const { data: session } = authClient.useSession();
  if (!session?.user) return null;

  const accountLabel = session.user.phoneNumber ?? "Signed in";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton render={<div />} tooltip={accountLabel}>
          <UserIcon />
          <span>{accountLabel}</span>
        </SidebarMenuButton>
        <SidebarMenuAction
          aria-label="Sign out"
          onClick={() => {
            void authClient.signOut().finally(() => {
              window.location.assign(withBasePath("/sign-in"));
            });
          }}
          title="Sign out"
          type="button"
        >
          <LogOutIcon />
        </SidebarMenuAction>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
