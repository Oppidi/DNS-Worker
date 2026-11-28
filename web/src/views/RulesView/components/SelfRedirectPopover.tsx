import React from "react";
import { Button, Intent, PopoverNext, Tag } from "@blueprintjs/core";
import type { TFunction } from "i18next";

export interface SelfRedirectPopoverProps {
  isOpen: boolean;
  onInteraction: (nextOpenState: boolean) => void;
  onApply: () => void;
  t: TFunction;
}

/**
 * Interactive popover tag offering to prefill a self-redirect CNAME rule
 * pointing at the current dashboard host.
 */
export const SelfRedirectPopover: React.FC<SelfRedirectPopoverProps> = ({
  isOpen,
  onInteraction,
  onApply,
  t,
}) => (
  <PopoverNext
    isOpen={isOpen}
    onInteraction={onInteraction}
    placement="bottom-end"
    portalClassName="z-20000"
    content={
      <div className="p-4 w-72 sm:w-80 space-y-3 text-sm">
        <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed m-0">
          {t(
            "rules.addSelfRedirectPrompt",
            "是否增加指向本站的 CNAME 规则，用于地区网络优化（中国大陆用户推荐）？"
          )}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button
            size="small"
            variant="minimal"
            text={t("common.no", "否")}
            onClick={() => onInteraction(false)}
          />
          <Button
            size="small"
            intent={Intent.PRIMARY}
            text={t("common.yes", "是")}
            onClick={onApply}
          />
        </div>
      </div>
    }
  >
    <Tag minimal interactive intent={Intent.PRIMARY} className="cursor-pointer select-none font-medium">
      {t("rules.addSelfRedirectTag", "增加本站重定向？")}
    </Tag>
  </PopoverNext>
);
