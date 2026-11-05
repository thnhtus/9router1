"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import useSettingsStore from "@/store/settingsStore";
import Button from "./Button";
import { ConfirmModal } from "./Modal";
import {
  Sidebar as UISidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt", "systemone"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

// Unlayered `.material-symbols-outlined { font-size:24px }` in globals.css outranks Tailwind utilities, hence `!`.
const ICON = "material-symbols-outlined text-[18px]! leading-none";
// Dark: brightness carries state (muted → full ink); light: neutral pill. Colour stays on data, not chrome.
const ROW = "h-8 gap-2.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] data-active:bg-black/[0.06] dark:data-active:bg-white/[0.07] text-sidebar-foreground/60 hover:text-sidebar-foreground data-active:text-sidebar-foreground [&>.material-symbols-outlined]:text-sidebar-foreground/45 hover:[&>.material-symbols-outlined]:text-sidebar-foreground/80 data-active:[&>.material-symbols-outlined]:text-sidebar-foreground";

const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  // { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }, // Hidden
  { href: "/dashboard/combos", label: "Combo & Vision Adapter", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  // { href: "/dashboard/agents", label: "Agents", icon: "smart_toy" }, // Hidden
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
  { href: "/dashboard/jev-router", label: "Jev Router", icon: "psychology" },
  { href: "/dashboard/model-stats", label: "Model Stats", icon: "leaderboard" },
  // { href: "/dashboard/pxpipe", label: "PXPIPE", icon: "image" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "receipt_long" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
  { href: "/dashboard/memory", label: "Agent Memory", icon: "memory" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobile = () => isMobile && setOpenMobile(false);
  const [mediaOpen, setMediaOpen] = useState(() => pathname.startsWith("/dashboard/media-providers"));
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const { copied, copy } = useCopyToClipboard(2000);

  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;

  useEffect(() => {
    useSettingsStore.getState().fetchSettings().then((data) => {
      if (data?.enableTranslator) setEnableTranslator(true);
    });
  }, []);

  // Lazy check for new npm version in background after initial render
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/version")
        .then(res => res.json())
        .then(data => { if (data.hasUpdate) setUpdateInfo(data); })
        .catch(() => {});
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  // Open manual update panel (no countdown yet — user must click Copy to trigger shutdown)
  const handleUpdate = () => {
    setShowUpdateModal(false);
    setIsUpdating(true);
  };

  // Triggered by Copy button inside ManualUpdatePanel: copy + countdown + shutdown
  const handleCopyAndShutdown = async () => {
    try { await navigator.clipboard.writeText(INSTALL_CMD); } catch { /* clipboard blocked */ }
    copy(INSTALL_CMD);
    let remaining = UPDATER_CONFIG.shutdownCountdownSec;
    setShutdownCountdown(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      setShutdownCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        fetch("/api/version/shutdown", { method: "POST" }).catch(() => {});
        setIsDisconnected(true);
      }
    }, 1000);
  };

  const handleCancelUpdate = () => {
    setIsUpdating(false);
    setShutdownCountdown(0);
  };

  // Note: legacy updater poll removed. New flow: copy install cmd + shutdown server,
  // user runs the command manually in another terminal.


  const item = (href, label, icon, { active = isActive(href), external = false, badge } = {}) => (
    <SidebarMenuItem key={href}>
      <SidebarMenuButton
        isActive={active}
        tooltip={label}
        className={cn(ROW, "group/link")}
        render={external ? <a href={href} target="_blank" rel="noreferrer" /> : <Link href={href} onClick={closeMobile} />}
      >
        <span className={cn(ICON, active && "fill-1")}>{icon}</span>
        <span>{label}</span>
        {external && !badge && (
          <span aria-hidden="true" className={cn(ICON, "ml-auto text-[14px]! opacity-0 transition-opacity group-hover/link:opacity-60")}>arrow_outward</span>
        )}
      </SidebarMenuButton>
      {badge && (
        <SidebarMenuBadge className="h-4 rounded px-1 text-[10px] font-semibold tracking-wide text-orange-500 bg-orange-500/10 dark:text-orange-300">
          {badge}
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
  const mediaActive = pathname.startsWith("/dashboard/media-providers");
  const mediaItems = [
    ...MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((k) => ({ ...k, href: `/dashboard/media-providers/${k.id}` })),
    COMBINED_WEB_ITEM,
  ];

  return (
    <>
      <UISidebar collapsible="icon">
        <SidebarHeader className="gap-3 px-3 pt-4">
          <div className="flex items-center gap-2 px-2 group-data-[collapsible=icon]:hidden" aria-hidden="true">
            <div className="size-3 rounded-full bg-[#FF5F56]" />
            <div className="size-3 rounded-full bg-[#FFBD2E]" />
            <div className="size-3 rounded-full bg-[#27C93F]" />
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip={APP_CONFIG.name} render={<Link href="/dashboard" onClick={closeMobile} />}>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
                  <span className={ICON}>hub</span>
                </div>
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-[15px] font-semibold tracking-tight">{APP_CONFIG.name}</span>
                  <span className="text-[11px] tabular-nums text-sidebar-foreground/45">v{APP_CONFIG.version}</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {updateInfo && (
            <div className="flex flex-col gap-1.5 px-2 group-data-[collapsible=icon]:hidden">
              <span className="text-xs font-semibold text-green-600 dark:text-amber-500">
                ↑ New version available: v{updateInfo.latestVersion}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowUpdateModal(true)}
                  className="px-2 py-1 rounded bg-green-600 hover:bg-green-700 dark:bg-amber-500 dark:hover:bg-amber-600 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Update now
                </button>
                <button
                  onClick={() => copy(INSTALL_CMD)}
                  title="Copy install command"
                  className="flex-1 text-left hover:opacity-80 transition-opacity cursor-pointer min-w-0"
                >
                  <code className="block text-[10px] text-green-600/80 dark:text-amber-400/70 font-mono truncate">
                    {copied ? "✓ copied!" : INSTALL_CMD}
                  </code>
                </button>
              </div>
            </div>
          )}
        </SidebarHeader>

        <SidebarContent className="[scrollbar-width:none]!">
          <SidebarGroup>
            <SidebarMenu>{navItems.map((i) => item(i.href, i.label, i.icon))}</SidebarMenu>
          </SidebarGroup>

          <SidebarGroup className="pt-4">
            <SidebarGroupLabel className="h-7 text-[12px] font-normal text-sidebar-foreground/40">System</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={mediaActive && !mediaOpen}
                  tooltip="Media Providers"
                  aria-expanded={mediaOpen}
                  className={cn(ROW, mediaActive && "text-sidebar-foreground")}
                  onClick={() => setMediaOpen((v) => !v)}
                >
                  <span className={cn(ICON, mediaActive && "fill-1")}>perm_media</span>
                  <span>Media Providers</span>
                  <span aria-hidden="true" className={cn(ICON, "ml-auto text-[16px]! transition-transform duration-200", mediaOpen && "rotate-180")}>expand_more</span>
                </SidebarMenuButton>
                {mediaOpen && (
                  <SidebarMenuSub>
                    {mediaItems.map((k) => (
                      <SidebarMenuSubItem key={k.id}>
                        <SidebarMenuSubButton
                          isActive={pathname.startsWith(k.href)}
                          className="text-sidebar-foreground/55 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-sidebar-foreground data-active:bg-black/[0.06] dark:data-active:bg-white/[0.07] data-active:font-medium data-active:text-sidebar-foreground [&>.material-symbols-outlined]:text-current!"
                          render={<Link href={k.href} onClick={closeMobile} />}
                        >
                          <span className={cn(ICON, "text-[16px]!")}>{k.icon}</span>
                          <span>{k.label}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>
              {systemItems.map((i) => item(i.href, i.label, i.icon))}
              {debugItems
                .filter((i) => i.href !== "/dashboard/translator" || enableTranslator)
                .map((i) => item(i.href, i.label, i.icon))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border/60 pb-3">
          <SidebarMenu>
            {item("https://9remote.cc", "9Remote", "computer", { active: false, external: true, badge: "HOT" })}
            {item("https://9english.net/", "9English", "translate", { active: false, external: true })}
            {item("/dashboard/profile", "Settings", "settings")}
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </UISidebar>

      {/* Update Confirmation Modal */}
      <ConfirmModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onConfirm={handleUpdate}
        title="Update 9Router"
        message={`Show install command for v${updateInfo?.latestVersion || ""}? You can copy it and shutdown to install manually.`}
        confirmText="Show Command"
        cancelText="Cancel"
        variant="primary"
      />

      {/* Disconnected / Updating Overlay */}
      {(isDisconnected || isUpdating) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          {isUpdating ? (
            <ManualUpdatePanel
              latestVersion={updateInfo?.latestVersion}
              installCmd={INSTALL_CMD}
              copied={copied}
              onCopyAndShutdown={handleCopyAndShutdown}
              onCancel={handleCancelUpdate}
              countdown={shutdownCountdown}
              isDisconnected={isDisconnected}
            />
          ) : (
            <div className="text-center p-8">
              <div className="flex items-center justify-center size-16 rounded-full bg-red-500/20 text-red-500 mx-auto mb-4">
                <span className="material-symbols-outlined text-[32px]">power_off</span>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">Server Disconnected</h2>
              <p className="text-muted-foreground mb-6">The proxy server has been stopped.</p>
              <Button variant="secondary" onClick={() => globalThis.location.reload()}>
                Reload Page
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ManualUpdatePanel({ latestVersion, installCmd, copied, onCopyAndShutdown, onCancel, countdown, isDisconnected }) {
  const isCountingDown = countdown > 0;
  return (
    <div className="w-full max-w-lg rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center size-11 rounded-full bg-amber-500/20 text-amber-400">
          <span className="material-symbols-outlined text-[24px]">content_copy</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">Update 9Router{latestVersion ? ` to v${latestVersion}` : ""}</h2>
          <p className="text-xs text-white/60">
            {isDisconnected
              ? "Server stopped. Paste the command into a terminal to install."
              : isCountingDown
                ? `Command copied. Server will stop in ${countdown}s...`
                : "Click the button below to copy the install command and shutdown."}
          </p>
        </div>
      </div>

      <p className="text-sm text-white/80 mb-2">Install command:</p>
      <div className="w-full px-3 py-2 rounded bg-white/5 mb-4">
        <code className="text-xs font-mono text-amber-400 break-all">{installCmd}</code>
      </div>

      <ol className="text-xs text-white/70 space-y-1 list-decimal list-inside mb-4">
        <li>Click <strong>Copy & Shutdown</strong> below.</li>
        <li>Paste the command into your terminal and press Enter.</li>
        <li>Run <code className="px-1 rounded bg-white/10 text-green-400">9router</code> again after install.</li>
      </ol>

      {isDisconnected ? (
        <Button variant="secondary" fullWidth onClick={() => globalThis.location.reload()}>
          Reload Page
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={isCountingDown}>
            Cancel
          </Button>
          <Button variant="primary" fullWidth onClick={onCopyAndShutdown} disabled={isCountingDown}>
            {copied ? "✓ Copied — shutting down..." : isCountingDown ? `Shutting down in ${countdown}s` : "Copy & Shutdown"}
          </Button>
        </div>
      )}
    </div>
  );
}

ManualUpdatePanel.propTypes = {
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  copied: PropTypes.bool,
  onCopyAndShutdown: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  countdown: PropTypes.number,
  isDisconnected: PropTypes.bool,
};
