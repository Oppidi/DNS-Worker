import React, { useState, useRef, useEffect } from "react";
import { Button, Intent, Callout, InputGroup, Tag } from "@blueprintjs/core";
import { Search, ShieldOff } from "lucide-react";
import type { TFunction } from "i18next";
import { checkDomainAgainstList, type ListCheckResult } from "../../../../services";
import type { FilterList } from "../../types";

export interface ListDomainCheckerProps {
  profileId: string;
  selectedList: FilterList | null;
  resetSignal: number;
  onAllowDomain: (domain: string) => Promise<void>;
  t: TFunction;
}

/**
 * Interactive domain lookup box that checks whether a queried domain matches a filter list
 * and lets the user create a targeted ALLOW override rule when blocked.
 */
export const ListDomainChecker: React.FC<ListDomainCheckerProps> = ({
  profileId,
  selectedList,
  resetSignal,
  onAllowDomain,
  t,
}) => {
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ListCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowing, setAllowing] = useState(false);
  const [allowed, setAllowed] = useState(false);
  /** Monotonic id of the newest check, so stale responses can be discarded. */
  const checkToken = useRef(0);

  useEffect(() => {
    // Invalidate any in-flight check so its response cannot land after closing or switching lists.
    // Clearing `checking` here prevents the Check button from staying locked on late promises.
    checkToken.current++;
    setChecking(false);
    setQuery("");
    setResult(null);
    setError(null);
    setAllowed(false);
  }, [resetSignal, selectedList?.id]);

  const runCheck = async (): Promise<void> => {
    let domain = query.trim().toLowerCase();
    if (!domain || !selectedList) return;

    // Clean user input: strip protocol (http:// or https://), path, port, and trailing dots
    domain = domain.replace(/^https?:\/\//, "").split("/")[0].split(":")[0].replace(/\.+$/, "");
    if (!domain) return;
    setQuery(domain);

    // Tag this request so closing and reopening on another list cannot paint stale results.
    const token = ++checkToken.current;
    const listId = selectedList.id;
    setChecking(true);
    setError(null);
    setResult(null);
    setAllowed(false);
    try {
      const res = await checkDomainAgainstList(profileId, listId, domain);
      if (checkToken.current === token) setResult(res);
    } catch (err) {
      if (checkToken.current === token) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (checkToken.current === token) setChecking(false);
    }
  };

  const handleAllow = async (): Promise<void> => {
    if (!result?.matchedEntry) return;
    setAllowing(true);
    try {
      // Scope the exception to what was asked about rather than un-blocking parent wildcard siblings.
      await onAllowDomain(result.domain);
      setAllowed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAllowing(false);
    }
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-3">
      <div>
        <div className="text-sm font-bold">{t("filtering.checkDomain", "Check a domain")}</div>
        <div className="text-xs opacity-60">
          {t(
            "filtering.checkDomainHint",
            "Lists are stored as compact filters, so their entries cannot be browsed. You can test any domain against this list instantly."
          )}
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <InputGroup
          fill
          className="flex-1 min-w-0"
          placeholder="example.com"
          value={query}
          disabled={checking}
          leftIcon="globe-network"
          onChange={(e) => {
            setQuery(e.target.value);
            // Drop the previous verdict so "Allow anyway" always matches the current input.
            setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runCheck();
          }}
        />
        <Button
          className="shrink-0 whitespace-nowrap min-w-fit w-auto"
          icon={<Search size={14} />}
          text={t("filtering.check", "Check")}
          loading={checking}
          disabled={!query.trim()}
          onClick={() => void runCheck()}
        />
      </div>

      {error && (
        <Callout intent={Intent.DANGER} className="text-xs">
          {error}
        </Callout>
      )}

      {result && !result.synced && (
        <Callout intent={Intent.WARNING} className="text-xs">
          {t(
            "filtering.checkNotSynced",
            "This list has not finished syncing yet, so there is nothing to check against."
          )}
        </Callout>
      )}

      {result?.synced && result.enabled === false && (
        <Callout intent={Intent.NONE} className="text-xs">
          {t(
            "filtering.checkListDisabled",
            "This list is currently disabled, so it is not filtering anything right now."
          )}
        </Callout>
      )}

      {result?.synced && (
        <Callout
          intent={result.blocked ? Intent.WARNING : Intent.SUCCESS}
          className="text-xs"
          icon={result.blocked ? "ban-circle" : "tick-circle"}
        >
          {result.blocked ? (
            <div className="space-y-2">
              <div>
                {t("filtering.checkBlocked", "Blocked by this list")}
                {result.matchedEntry && result.matchedEntry !== result.domain && (
                  <>
                    {" "}
                    <Tag minimal className="font-mono">
                      {result.matchedEntry}
                    </Tag>{" "}
                    {result.matchedEntry.includes("*") || result.matchedEntry.startsWith("/")
                      ? t("filtering.checkViaPattern", "(匹配到通配规则)")
                      : t("filtering.checkViaParent", "(matched a parent domain)")}
                  </>
                )}
              </div>
              {allowed ? (
                <Tag intent={Intent.SUCCESS} minimal>
                  {t("filtering.checkAllowed", "Exception added - this domain now resolves")}
                </Tag>
              ) : (
                <Button
                  small
                  icon={<ShieldOff size={12} />}
                  intent={Intent.PRIMARY}
                  loading={allowing}
                  text={t("filtering.checkAllowAction", "Allow anyway")}
                  onClick={() => void handleAllow()}
                />
              )}
            </div>
          ) : result.whitelisted ? (
            <div className="space-y-1">
              <div className="font-medium text-emerald-700 dark:text-emerald-400">
                {t("filtering.checkWhitelisted", "被该列表放行")}
                {result.matchedEntry && (
                  <>
                    {" "}
                    <Tag minimal intent={Intent.SUCCESS} className="font-mono">
                      {result.matchedEntry}
                    </Tag>
                  </>
                )}
              </div>
              <div className="opacity-75">
                {t(
                  "filtering.checkWhitelistedDesc",
                  "命中该订阅列表中的白名单/例外规则 (@@)，即使被其他黑名单规则命中也会优先放行。"
                )}
              </div>
            </div>
          ) : (
            t("filtering.checkNotBlocked", "Not blocked by this list")
          )}
        </Callout>
      )}
    </div>
  );
};
