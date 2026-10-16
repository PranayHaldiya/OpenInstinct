import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@web/components/ui/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@web/components/ui/sidebar";
import {
  requireRequestScope,
  UnauthenticatedError,
} from "@web/auth/request-scope";
import { TRPCProvider } from "@web/trpc/client";
import { AuthenticatedAccountControl } from "./_components/account-control";
import {
  AuthenticatedMobileHeader,
  AuthenticatedNavigation,
} from "./_components/authenticated-navigation";

export default async function AuthenticatedLayout({
  children,
}: LayoutProps<"/">) {
  try {
    await requireRequestScope();
  } catch (error) {
    // The proxy redirects signed-out requests first, but it doesn't run for
    // the bare base path when the app is served under a prefix.
    if (error instanceof UnauthenticatedError) redirect("/sign-in");
    throw error;
  }

  return (
    <TRPCProvider>
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/" />}>
                  <Logo />
                  <span>OpenInstinct</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <AuthenticatedNavigation />
          </SidebarContent>
          <SidebarFooter>
            <AuthenticatedAccountControl />
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="h-svh overflow-y-auto">
          <AuthenticatedMobileHeader />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TRPCProvider>
  );
}
