import React from "react";
import {
  Button,
  Tag,
  type OverlayToaster,
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { Menu as MenuIcon, X } from "lucide-react";
import { clsx } from "clsx";
import LogoIcon from "../assets/dns_worker_cat_eye_logo.svg";
import type { Profile, UserInfo } from "../types/auth";
import { useUpstreamUpdate } from "../hooks/useUpstreamUpdate";
import { useDeploymentMode, getDisplayHost } from "../hooks/useDeploymentMode";
import { useSidebarSwipeGestures } from "./sidebar/useSidebarSwipeGestures";
import { SidebarNavMenu } from "./sidebar/SidebarNavMenu";

/**
 * Properties for the DesktopSidebar component.
 */
interface DesktopSidebarProps {
  /** True if sidebar is expanded. */
  isSidebarOpen: boolean;
  /** Callback to set expanded/collapsed state. */
  setIsSidebarOpen: (open: boolean) => void;
  /** True if active screen viewport is mobile. */
  isMobile?: boolean;
  /** True if there is a selected/active profile. */
  isProfileActive: boolean;
  /** Active profile ID, if any. */
  activeId: string | undefined;
  /** Available profiles list for single-profile auto-selection. */
  profiles: Profile[];
  /** Callback to select a profile directly. */
  setSelectedProfile: (p: Profile) => void;
  /** Router location object. */
  location: { pathname: string };
  /** Router navigation function. */
  navigate: (path: string) => void;
  /** Callback to handle user logout action. */
  handleLogout: () => void;
  /** Current logged in user info. */
  currentUser: UserInfo | null;
  /** Shared OverlayToaster ref for global notifications. */
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

/**
 * Renders the 3-section sidebar navigation (`Access Points`, `Profiles`, `Preferences`)
 * on desktop and mobile screens.
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  isSidebarOpen,
  setIsSidebarOpen,
  isMobile = false,
  isProfileActive,
  activeId,
  profiles,
  setSelectedProfile,
  location,
  navigate,
  handleLogout,
  currentUser,
  toasterRef,
}) => {
  const { t } = useTranslation();
  const { isDemoMode, demoDomain } = useDeploymentMode();
  const displayHost = getDisplayHost(isDemoMode, demoDomain);
  const { hasUpdate, latestTag, appVersion, gitTag, gitCommit } = useUpstreamUpdate();

  const {
    dragOffset,
    dragOpenOffset,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
  } = useSidebarSwipeGestures({
    isMobile,
    isSidebarOpen,
    setIsSidebarOpen,
  });

  const showText = isMobile ? true : isSidebarOpen;
  const closeMobileSidebar = isMobile ? () => setIsSidebarOpen(false) : undefined;

  return (
    <>
      {isMobile && (isSidebarOpen || dragOpenOffset !== null) && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 transition-opacity md:hidden!"
          onClick={() => setIsSidebarOpen(false)}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          style={
            dragOffset !== null
              ? {
                  opacity: Math.max(0, 1 - Math.abs(dragOffset) / 256),
                  transition: "none",
                }
              : dragOpenOffset !== null
              ? {
                  opacity: Math.max(0, Math.min(1, (256 + dragOpenOffset) / 256)),
                  transition: "none",
                }
              : undefined
          }
          aria-hidden="true"
        />
      )}

      <aside
        className={clsx(
          "flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900",
          isMobile
            ? clsx(
                "fixed inset-y-0 left-0 z-50 w-64 shadow-2xl transform select-none",
                isSidebarOpen || dragOpenOffset !== null
                  ? "translate-x-0"
                  : "-translate-x-full pointer-events-none"
              )
            : clsx(
                "relative z-20 shrink-0",
                isSidebarOpen ? "w-64" : "w-16"
              ),
          dragOffset === null && dragOpenOffset === null && "transition-all duration-300"
        )}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        style={
          isMobile && isSidebarOpen && dragOffset !== null
            ? {
                transform: `translateX(${dragOffset}px)`,
                transition: "none",
              }
            : isMobile && dragOpenOffset !== null
            ? {
                transform: `translateX(${dragOpenOffset}px)`,
                transition: "none",
              }
            : undefined
        }
      >
        <div className="h-14 flex items-center pl-3.5 pr-2 shrink-0 justify-between">
          <div className="flex items-center min-w-0">
            <img
              src={LogoIcon}
              alt="DNS Worker"
              className="w-8 h-8 object-contain shrink-0"
            />
            {showText && (
              <div className="ml-2.5 flex flex-col justify-center min-w-0 flex-1">
                <span className="font-bold text-base leading-tight dark:text-white truncate">
                  DNS Worker
                </span>
                <span
                  className="text-xs text-gray-500 dark:text-gray-400 font-mono leading-tight mt-0.5 truncate select-all"
                  title={displayHost}
                >
                  {displayHost}
                </span>
              </div>
            )}
          </div>
          {isMobile && (
            <Button
              variant="minimal"
              icon={<X size={18} />}
              onClick={() => setIsSidebarOpen(false)}
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
              aria-label={t("common.close", "关闭")}
            />
          )}
        </div>

        <SidebarNavMenu
          showText={showText}
          isMobile={isMobile}
          setIsSidebarOpen={setIsSidebarOpen}
          closeMobileSidebar={closeMobileSidebar}
          isProfileActive={isProfileActive}
          activeId={activeId}
          profiles={profiles}
          setSelectedProfile={setSelectedProfile}
          location={location}
          navigate={navigate}
          handleLogout={handleLogout}
          currentUser={currentUser}
          toasterRef={toasterRef}
          hasUpdate={hasUpdate}
          latestTag={latestTag}
          appVersion={appVersion}
          gitTag={gitTag}
          gitCommit={gitCommit}
          t={t}
        />

        <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          {!isMobile && (
            <Button
              variant="minimal"
              icon={<MenuIcon size={18} />}
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            />
          )}
          {showText && (
            <Tag minimal round>
              {currentUser?.username.toUpperCase() || "USER"}
            </Tag>
          )}
        </div>
      </aside>
    </>
  );
};
