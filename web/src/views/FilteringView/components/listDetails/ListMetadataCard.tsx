import React from "react";
import { Intent, Tag } from "@blueprintjs/core";
import { BarChart3 } from "lucide-react";
import type { TFunction } from "i18next";
import { formatDateTime } from "../../../../utils/date";
import { formatBytes } from "../../../../utils/formatBytes";
import type { FilterList } from "../../types";

export interface ListMetadataCardProps {
  selectedList: FilterList | null;
  t: TFunction;
}

/**
 * Displays compiled rule counts, file size, upstream HTTP metadata (`last_modified`, `etag`),
 * and truncation indicators for a subscribed filter list.
 */
export const ListMetadataCard: React.FC<ListMetadataCardProps> = ({ selectedList, t }) => (
  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-3">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-sm font-bold">
        <BarChart3 size={15} className="text-blue-500" />
        <span>{t("filtering.listMetadata", "列表元数据")}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap justify-end">
        {selectedList?.metadata && (
          <Tag minimal intent={Intent.PRIMARY} className="font-mono text-xs">
            {t("filtering.metaTotalRules", "有效规则: {{count}}", {
              count: selectedList.metadata.total_rules,
            })}
          </Tag>
        )}
        {selectedList?.metadata?.truncated && (
          <Tag minimal intent={Intent.WARNING} className="text-xs">
            {t("filtering.metaTruncated", "已截断")}
          </Tag>
        )}
      </div>
    </div>

    {selectedList?.metadata ? (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            {
              label: t("filtering.metaExactRules", "全匹配"),
              value: selectedList.metadata.exact_rules,
            },
            {
              label: t("filtering.metaSubdomainRules", "通配子域名"),
              value: selectedList.metadata.subdomain_rules,
            },
            {
              label: t("filtering.metaWildcardRules", "通配符"),
              value: selectedList.metadata.wildcard_rules,
            },
            {
              label: t("filtering.metaRegexRules", "正则表达式"),
              value: selectedList.metadata.regex_rules,
            },
            {
              label: t("filtering.metaExceptionRules", "放行规则"),
              value: selectedList.metadata.exception_rules,
            },
            {
              label: t("filtering.metaRewriteRules", "重定向规则"),
              value: selectedList.metadata.rewrite_rules,
            },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-gray-50 dark:bg-gray-800/70 rounded px-2.5 py-2 border border-gray-100 dark:border-gray-800"
            >
              <div className="text-[11px] opacity-60 truncate">{item.label}</div>
              <div className="text-sm font-semibold font-mono mt-0.5">
                {item.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] opacity-70 pt-1 border-t border-gray-100 dark:border-gray-800">
          <span>
            {t("filtering.metaCommentLines", "注释行")}:{" "}
            <strong className="font-mono">
              {selectedList.metadata.comment_lines.toLocaleString()}
            </strong>
          </span>
          <span>
            {t("filtering.metaUnsupportedLines", "忽略/非 DNS 行")}:{" "}
            <strong className="font-mono">
              {selectedList.metadata.unsupported_lines.toLocaleString()}
            </strong>
          </span>
          {typeof selectedList.metadata.total_bytes === "number" && (
            <span>
              {t("filtering.metaFileSize", "体积")}:{" "}
              <strong className="font-mono">
                {formatBytes(selectedList.metadata.total_bytes)}
              </strong>
            </span>
          )}
          {selectedList.last_modified && (
            <span>
              {t("filtering.metaLastModified", "上游更新")}:{" "}
              <strong className="font-mono">
                {formatDateTime(new Date(selectedList.last_modified * 1000))}
              </strong>
            </span>
          )}
          {selectedList.etag && (
            <span className="inline-flex items-center gap-1 max-w-full min-w-0" title={selectedList.etag}>
              <span className="shrink-0">ETag:</span>
              <strong className="font-mono truncate">{selectedList.etag}</strong>
            </span>
          )}
        </div>
      </>
    ) : (
      <div className="space-y-1.5 text-xs opacity-65">
        <div>
          {t("filtering.metaPendingHint", "暂无规则明细统计，点击「立即同步」后将自动生成。")}
        </div>
        {(selectedList?.last_modified || selectedList?.etag) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] pt-1">
            {selectedList.last_modified && (
              <span>
                {t("filtering.metaLastModified", "上游更新")}:{" "}
                <strong className="font-mono">
                  {formatDateTime(new Date(selectedList.last_modified * 1000))}
                </strong>
              </span>
            )}
            {selectedList.etag && (
              <span className="inline-flex items-center gap-1 max-w-full min-w-0" title={selectedList.etag}>
                <span className="shrink-0">ETag:</span>
                <strong className="font-mono truncate">{selectedList.etag}</strong>
              </span>
            )}
          </div>
        )}
      </div>
    )}
  </div>
);
