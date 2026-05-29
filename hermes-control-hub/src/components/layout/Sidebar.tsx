// ═══════════════════════════════════════════════════════════════

// Sidebar Navigation — Config Settings with categorized groups

// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useCallback, useRef } from "react";

import Link from "next/link";

import { usePathname } from "next/navigation";

import { useSidebar } from "./SidebarContext";

import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Settings,
  Hammer,
  Power,
} from "lucide-react";

import { iconColorMap } from "@/lib/theme";
import {
  mainSections,
  configSettingsPinnedLinks,
  configGroups,
} from "./sidebar-config";

import type { SidebarLink, ConfigGroup } from "./sidebar-config";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";

  return pathname.startsWith(href);
}

function VersionFooter({ collapsed }: { collapsed: boolean }) {
  const [restarting, setRestarting] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  const handleRestart = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRestarting(true);
    setMessage("Restart requested (~/.hermes/logs/ch-restart.log)…");
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      if (!res.ok) {
        let msg = "Restart failed";
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      setMessage("Restarting server…");
      pollDeployStatus("restart");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Restart failed";
      setMessage(msg);
      setRestarting(false);
      busyRef.current = false;
    }
  };

  const doRebuild = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRebuilding(true);
    setMessage("Rebuild started…");
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rebuild" }),
      });
      if (!res.ok) {
        let msg = "Rebuild failed";
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      pollDeployStatus("rebuild");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Rebuild failed";
      setMessage(msg);
      setRebuilding(false);
      busyRef.current = false;
    }
  };

  const clearDeployBusy = () => {
    setRestarting(false);
    setRebuilding(false);
    busyRef.current = false;
  };

  const pollDeployStatus = (expectedAction: "rebuild" | "restart") => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    let attempts = 0;
    const maxAttempts = 450;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch("/api/update?deploy=1", {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return;
        const d = await res.json();
        const deploy = d.data?.deploy as {
          state?: string;
          action?: string;
          phase?: string;
          message?: string;
          logHint?: string;
        } | undefined;
        if (!deploy || !isMountedRef.current) return;

        if (deploy.state === "running") {
          const phaseLabel =
            deploy.phase === "build"
              ? "Building…"
              : deploy.phase === "install"
                ? "Installing dependencies…"
                : deploy.phase === "restart"
                  ? "Restarting server…"
                  : deploy.phase === "git"
                    ? "Updating code…"
                    : deploy.message || "Working…";
          setMessage(phaseLabel);
          return;
        }

        if (deploy.state === "success") {
          clearInterval(interval);
          pollIntervalRef.current = null;
          clearDeployBusy();
          const label =
            expectedAction === "rebuild"
              ? "Rebuild complete"
              : "Restart complete";
          setMessage(label);
          setTimeout(() => {
            if (isMountedRef.current) setMessage(null);
          }, 4000);
          return;
        }

        if (deploy.state === "failed") {
          clearInterval(interval);
          pollIntervalRef.current = null;
          clearDeployBusy();
          const hint = deploy.logHint ? ` — see Logs → ${deploy.logHint}` : "";
          setMessage((deploy.message || "Deploy failed") + hint);
        }
      } catch {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          pollIntervalRef.current = null;
          if (!isMountedRef.current) return;
          clearDeployBusy();
          setMessage("Timed out — check ch-restart.log in Logs");
        }
      }
    }, 2000);
    pollIntervalRef.current = interval;
  };

  const isBusy = restarting || rebuilding;

  // ── Collapsed view ───────────────────────────────────────────
  if (collapsed) {
    return (
      <>
        <div className="flex flex-col items-center gap-2 relative">
          {/* Rebuild */}
          <button
            onClick={() => doRebuild()}
            disabled={isBusy}
            className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
            title={message || "Rebuild App"}
          >
            <Hammer className={`w-3.5 h-3.5 flex-shrink-0 ${rebuilding ? "animate-spin" : ""}`} />
          </button>

          {/* Restart */}
          <button
            onClick={handleRestart}
            disabled={isBusy}
            className="p-1.5 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title={message || "Restart App"}
          >
            <Power className={`w-3.5 h-3.5 flex-shrink-0 ${restarting ? "animate-spin" : ""}`} />
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="relative">
      <div className="space-y-1.5">
        {message && (
          <div className="min-h-[1.25rem] px-1 text-[10px] font-mono text-white/50 text-center leading-tight">
            {message}
          </div>
        )}
        {/* Rebuild + Restart — side by side */}
        <div className="flex gap-1.5">
          <button
            type="button"
            title="npm run build + restart (current checkout)"
            onClick={() => doRebuild()}
            disabled={isBusy}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono transition-colors disabled:opacity-50 ${
              rebuilding
                ? "bg-neon-purple/20 border border-neon-purple/30 text-neon-purple/90"
                : "bg-neon-purple/10 border border-neon-purple/20 text-neon-purple hover:bg-neon-purple/20"
            }`}
          >
            <Hammer className={`w-3.5 h-3.5 flex-shrink-0 ${rebuilding ? "animate-spin" : ""}`} />
            Rebuild
          </button>

          <button
            type="button"
            title="Restart next-server only (no build)"
            onClick={handleRestart}
            disabled={isBusy}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono transition-colors disabled:opacity-50 ${
              restarting
                ? "bg-red-500/20 border border-red-500/30 text-red-300"
                : "bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"
            }`}
          >
            <Power className={`w-3.5 h-3.5 flex-shrink-0 ${restarting ? "animate-spin" : ""}`} />
            Restart
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigGroupSection({
  group,

  collapsed,

  renderLink,

  pathname,
}: {
  group: ConfigGroup;

  collapsed: boolean;

  renderLink: (link: SidebarLink) => React.ReactNode;

  pathname: string;
}) {
  const [open, setOpen] = useState(() => {
    // Lazy init: auto-expand if any link in this group is active
    return (
      group.defaultOpen ??
      group.links.some(
        (link) =>
          pathname === link.href ||
          (link.href !== "/" && pathname.startsWith(link.href)),
      )
    );
  });

  if (collapsed) {
    return <>{group.links.map((link) => renderLink(link))}</>;
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full text-[10px] font-mono text-white/30 uppercase tracking-widest px-3 mb-1 mt-3 first:mt-0 hover:text-white/50 transition-colors"
      >
        <ChevronDown
          className={`w-3 h-3 transition-transform ${open ? "" : "-rotate-90"}`}
        />

        {group.label}
      </button>

      {open && (
        <div className="space-y-0.5">
          {group.links.map((link) => renderLink(link))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();

  const [collapsed, setCollapsed] = useState(false);

  const { mobileOpen, setMobileOpen } = useSidebar();

  const closeMobile = useCallback(() => setMobileOpen(false), [setMobileOpen]);

  const renderLink = useCallback(
    (link: SidebarLink) => {
      const active = isActive(pathname, link.href);
      const showSubs = active && link.subLinks && !collapsed;

      return (
        <div key={link.href}>
          <Link
            href={link.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              active
                ? "bg-white/10 text-white"
                : "text-white/50 hover:bg-white/5 hover:text-white/80"
            }`}
            onClick={closeMobile}
          >
            <link.icon
              className={`w-4 h-4 flex-shrink-0 ${
                active ? iconColorMap[link.color] : ""
              }`}
            />
            {!collapsed && <span>{link.label}</span>}
          </Link>
          {showSubs && (
            <div className="ml-7 mt-1 space-y-0.5 border-l border-white/5 pl-3">
              {link.subLinks!.map((sub) => (
                <Link
                  key={sub.href}
                  href={sub.href}
                  className={`block py-1 text-xs transition-colors ${
                    pathname === sub.href
                      ? "text-white/80"
                      : "text-white/30 hover:text-white/60"
                  }`}
                  onClick={closeMobile}
                >
                  {sub.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      );
    },
    [pathname, collapsed, closeMobile],
  );

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo — min-height matches main app chrome (see --ch-shell-header-min-height) */}

      <div className="px-4 min-h-[var(--ch-shell-header-min-height)] flex items-center border-b border-white/10">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          {collapsed ? (
            <div className="w-8 h-8 rounded-lg animated-border p-[1.5px] flex-shrink-0">
              <div className="w-full h-full bg-dark-900 rounded-[5px] flex items-center justify-center">
                <span className="text-[10px] font-bold tracking-tight" style={{ color: "#4DD0F8" }}>SA</span>
              </div>
            </div>
          ) : (
            <img
              src="/spacearmour-logo.svg"
              alt="SpaceArmour"
              className="h-7 w-auto object-contain"
              draggable={false}
            />
          )}
        </Link>
      </div>

      {/* Main Nav */}

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {/* Main + Agent sections */}

        {mainSections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest px-3 mb-2 mt-4 first:mt-0">
                {section.label}
              </div>
            )}

            {section.links
              .map(renderLink)}
          </div>
        ))}

        {/* Config Settings section */}

        {!collapsed && (
          <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest px-3 mb-2 mt-4">
            Config Settings
          </div>
        )}

        {collapsed && <div className="my-2 border-t border-white/10" />}

        {configSettingsPinnedLinks.map((link) => renderLink(link))}

        {/* All Settings link */}

        {renderLink({
          icon: Settings,

          label: "All Settings",

          href: "/config",

          color: "purple",
        })}

        {/* Grouped config sections */}

        {configGroups.map((group) => (
          <ConfigGroupSection
            key={group.label}
            group={group}
            collapsed={collapsed}
            renderLink={renderLink}
            pathname={pathname}
          />
        ))}
      </nav>

      {/* Footer */}

      <div className="px-3 py-3 border-t border-white/10 space-y-2 flex-shrink-0">
        <VersionFooter collapsed={collapsed} />

        {/* Logout */}
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/login";
          }}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-white/30 hover:text-red-400 hover:bg-red-400/5 transition-colors font-mono"
          title="Sign out"
        >
          <Power className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors font-mono"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />

              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — desktop */}

      <aside
        className={`hidden lg:flex flex-col bg-dark-900/80 border-r border-white/10 backdrop-blur-xl transition-all duration-200 h-screen ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Sidebar — mobile drawer */}

      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-56 bg-dark-950 border-r border-white/10 transform transition-transform h-screen ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
