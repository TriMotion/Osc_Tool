import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { FileBar } from "@/components/file-bar";
import { StatusBar } from "@/components/status-bar";
import { ClientLayout } from "@/components/client-layout";

export const metadata: Metadata = {
  title: "Oscilot",
  description: "Signal testing and control for OSC and beyond",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-black text-gray-100 h-screen flex flex-col overflow-hidden">
        <ClientLayout>
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
              <FileBar />
              <main className="flex-1 overflow-auto px-6 pb-6">
                {children}
              </main>
            </div>
          </div>
        </ClientLayout>
        <StatusBar />
      </body>
    </html>
  );
}
