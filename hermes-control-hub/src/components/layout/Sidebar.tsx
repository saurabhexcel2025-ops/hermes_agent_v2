// ═══════════════════════════════════════════════════════════════

// Sidebar Navigation — Config Settings with categorized groups

// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useCallback } from "react";

import Link from "next/link";

import { usePathname } from "next/navigation";

import { useSidebar } from "./SidebarContext";

import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Settings,
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
