import type { Metadata } from "next";
import { Jost, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import Sidebar from "@/components/layout/Sidebar";
import MobileHeader from "@/components/layout/MobileHeader";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import "./globals.css";

const jost = Jost({ variable: "--font-jost", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SpaceArmour | Mission Control",
  description: "SpaceArmour AI Agent Mission Control Dashboard",
  icons: {
    icon: "/spacearmour-logo.svg",
    shortcut: "/spacearmour-logo.svg",
    apple: "/spacearmour-logo.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "";
  const isAuthPage = pathname === "/login" || pathname === "/signup";

  return (
    <html
      lang="en"
      className={`${jost.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-dark-950 text-white">
        {isAuthPage ? (
          <ErrorBoundary>{children}</ErrorBoundary>
        ) : (
          <SidebarProvider>
            <div className="h-full flex flex-col lg:flex-row">
              <div className="border-r border-white/10 flex-shrink-0">
                <Sidebar />
              </div>
              <div className="flex-1 flex flex-col min-h-screen min-w-0">
                <MobileHeader />
                <main className="flex-1 overflow-y-auto" data-testid="ch-app-shell">
                  <ErrorBoundary>{children}</ErrorBoundary>
                </main>
              </div>
            </div>
          </SidebarProvider>
        )}
      </body>
    </html>
  );
}
