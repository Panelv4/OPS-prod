import React, { Suspense } from "react";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import { AppShell } from "@/components/app/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShell>
        <Suspense fallback={null}>{children}</Suspense>
      </AppShell>
    </WorkspaceProvider>
  );
}
