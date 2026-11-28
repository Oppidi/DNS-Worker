import React from "react";
import {
  Button,
  Menu,
  MenuItem,
  PopoverNext,
  Intent,
  type OverlayToaster,
} from "@blueprintjs/core";
import {
  Edit3,
  BarChart3,
  Clock,
  Download,
  MonitorSmartphone,
  LayoutGrid,
  ListFilter,
  Settings,
  User as UserIcon,
  LogOut,
  Server,
} from "lucide-react";
import { clsx } from "clsx";
import type { TFunction } from "i18next";
import type { Profile, UserInfo } from "../../types/auth";
import { createSpaLinkClickHandler } from "../../utils/navigation";

export interface SidebarNavMenuProps {
  showText: boolean;
  isMobile: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  closeMobileSidebar?: () => void;
  isProfileActive: boolean;
  activeId: string | undefined;
  profiles: Profile[];
  setSelectedProfile: (p: Profile) => void;
  location: { pathname: string };
  navigate: (path: string) => void;
  handleLogout: () => void;
  currentUser: UserInfo | null;
  toasterRef?: React.RefObject<OverlayToaster | null>;
  hasUpdate: boolean;
  latestTag: string | null;
  appVersion: string;
  gitTag: string;
  gitCommit: string;
  t: TFunction;
}

/**
 * Renders the 3-group navigation menu (`Access Points`, `Profiles`, `Preferences`)
 * and upstream release version badge inside the sidebar scroll region.
 */
export const SidebarNavMenu: React.FC<SidebarNavMenuProps> = ({
  showText,
  isMobile,
  setIsSidebarOpen,
  closeMobileSidebar,
  isProfileActive,
  activeId,
  profiles,
  setSelectedProfile,
  location,
  navigate,
  handleLogout,
  currentUser,
  toasterRef,
  hasUpdate,
  latestTag,
  appVersion,
  gitTag,
  gitCommit,
  t,
}) => {
  /**
   * Resolves target href for Profile-scoped sections (`Analytics`..`Settings`).
   * Auto-selects the sole Profile when only 1 exists; otherwise directs to Collections (`/dash?next=section`).
   */
  const resolveProfileSectionHref = (section: string): string => {
    if (isProfileActive && activeId) {
      return `/dash/${activeId}/${section}`;
    }
    if (profiles.length === 1) {
      return `/dash/${profiles[0].id}/${section}`;
    }
    return `/dash?next=${encodeURIComponent(section)}`;
  };

  const handleProfileSectionClick = (section: string) => (e: React.MouseEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    if (isProfileActive && activeId) {
      navigate(`/dash/${activeId}/${section}`);
    } else if (profiles.length === 1) {
      setSelectedProfile(profiles[0]);
      navigate(`/dash/${profiles[0].id}/${section}`);
    } else {
      toasterRef?.current?.show({
        message: t("nav.selectProfileFirst", "Please select a profile first"),
        intent: Intent.WARNING,
      });
      navigate(`/dash?next=${encodeURIComponent(section)}`);
    }
    closeMobileSidebar?.();
  };

  const profileMenuItems: Array<{ id: string; label: string; icon: React.JSX.Element }> = [
    { id: "stats", label: t("nav.stats"), icon: <BarChart3 size={18} /> },
    { id: "logs", label: t("nav.logs"), icon: <Clock size={18} /> },
    { id: "rules", label: t("nav.rules"), icon: <Edit3 size={18} /> },
    { id: "filter", label: t("nav.filter"), icon: <ListFilter size={18} /> },
    { id: "settings", label: t("nav.settings"), icon: <Settings size={18} /> },
  ];

  const renderGroupHeader = (label: string, isFirst = false, badge?: string | null) =>
    showText ? (
      <li
        className={clsx(
          "px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 select-none flex items-center justify-between gap-2",
          isFirst ? "pt-1" : "pt-4"
        )}
      >
        <span className="shrink-0">{label}</span>
        {badge && (
          <span
            className="truncate max-w-28 rounded px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/50"
            title={badge}
          >
            {badge}
          </span>
        )}
      </li>
    ) : !isFirst ? (
      <li className="my-2 border-t border-gray-100 dark:border-gray-800" />
    ) : null;

  return (
    <div className="flex-1 py-3 px-2 overflow-y-auto overflow-x-hidden">
      <Menu className="bg-transparent p-0">
        {/* Group 1: Access Points */}
        {renderGroupHeader(t("nav.groupAccessPoints", "Access Points"), true)}
        <MenuItem
          href="/access-points/manage"
          icon={<MonitorSmartphone size={18} />}
          text={showText ? t("nav.manage", "Manage") : ""}
          active={location.pathname.startsWith("/access-points/manage")}
          onClick={createSpaLinkClickHandler("/access-points/manage", navigate, closeMobileSidebar)}
        />
        <MenuItem
          href="/access-points/setup"
          icon={<Download size={18} />}
          text={showText ? t("nav.setup") : ""}
          active={location.pathname.startsWith("/access-points/setup")}
          onClick={createSpaLinkClickHandler("/access-points/setup", navigate, closeMobileSidebar)}
        />

        {/* Group 2: Profiles */}
        {renderGroupHeader(
          t("nav.groupProfiles", "Profiles"),
          false,
          (activeId ? profiles.find((p) => p.id === activeId) : undefined)?.name
        )}
        <MenuItem
          href="/dash"
          icon={<LayoutGrid size={18} />}
          text={showText ? t("nav.collections", "Collections") : ""}
          active={location.pathname === "/dash"}
          onClick={createSpaLinkClickHandler("/dash", navigate, closeMobileSidebar)}
        />
        {profileMenuItems.map((item) => {
          const targetHref = resolveProfileSectionHref(item.id);
          const isSectionActive = isProfileActive && location.pathname.endsWith(`/${item.id}`);
          return (
            <MenuItem
              key={item.id}
              href={targetHref}
              icon={item.icon}
              text={showText ? item.label : ""}
              className={clsx(
                !isProfileActive &&
                  profiles.length !== 1 &&
                  "opacity-60 hover:opacity-90 transition-opacity cursor-pointer"
              )}
              title={
                !isProfileActive && profiles.length !== 1
                  ? t("nav.noActiveProfileHint", "未选择配置，点击前往配置列表")
                  : undefined
              }
              active={isSectionActive}
              onClick={handleProfileSectionClick(item.id)}
            />
          );
        })}

        {/* Group 3: Preferences */}
        {renderGroupHeader(t("nav.groupPreferences", "Preferences"))}
        <MenuItem
          href="/account"
          icon={<UserIcon size={18} />}
          text={showText ? t("common.account") : ""}
          active={location.pathname === "/account"}
          onClick={createSpaLinkClickHandler("/account", navigate, closeMobileSidebar)}
        />
        {currentUser?.role === "admin" && (
          <MenuItem
            href="/system"
            icon={<Server size={18} />}
            text={showText ? t("common.system") : ""}
            active={location.pathname === "/system"}
            onClick={createSpaLinkClickHandler("/system", navigate, closeMobileSidebar)}
          />
        )}
        <PopoverNext
          className="w-full"
          placement="right-end"
          content={
            <div className="p-4 space-y-3">
              <div className="font-bold text-sm">{t("common.confirmLogout")}</div>
              <Button
                fill
                intent={Intent.DANGER}
                text={t("common.logout")}
                onClick={() => {
                  if (isMobile) setIsSidebarOpen(false);
                  handleLogout();
                }}
              />
            </div>
          }
        >
          <MenuItem
            icon={<LogOut size={18} />}
            text={showText ? t("common.logout") : ""}
            intent={Intent.DANGER}
            shouldDismissPopover={false}
          />
        </PopoverNext>
      </Menu>
      {showText && (
        <div className="mt-2.5 px-3 flex items-center justify-center">
          <span
            className="text-xs text-gray-500 dark:text-gray-400 font-mono leading-tight truncate inline-flex items-center"
            title={
              hasUpdate
                ? latestTag
                  ? `New version available: ${latestTag}`
                  : "Update available"
                : appVersion
            }
          >
            {hasUpdate ? (
              <a
                href="https://github.com/Oppidi/DNS-Worker/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-500 dark:text-amber-400 hover:underline transition-colors"
              >
                {gitTag}
              </a>
            ) : (
              <span>{gitTag}</span>
            )}
            {gitCommit ? `-${gitCommit}` : ""}
          </span>
        </div>
      )}
    </div>
  );
};
