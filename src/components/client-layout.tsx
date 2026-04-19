"use client";

import { RecorderProvider } from "@/contexts/recorder-context";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return <RecorderProvider>{children}</RecorderProvider>;
}
