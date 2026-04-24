"use client";

import { RecorderProvider } from "@/contexts/recorder-context";
import { ToastProvider } from "@/contexts/toast-context";
import { ToastContainer } from "@/components/toast";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <RecorderProvider>{children}</RecorderProvider>
      <ToastContainer />
    </ToastProvider>
  );
}
