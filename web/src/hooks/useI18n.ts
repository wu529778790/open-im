import { useCallback, useMemo } from "react";
import { PAGE_TEXTS } from "@open-im/i18n";

export type Lang = "zh";

export function useI18n(_lang: Lang) {
  const t = useCallback(
    (key: string, params: Record<string, string | number> = {}) => {
      const template = (PAGE_TEXTS as Record<string, string>)[key] ?? key;
      return Object.keys(params).reduce(
        (acc, name) => acc.replaceAll(`{${name}}`, String(params[name])),
        template,
      );
    },
    [],
  );

  const html = useCallback(
    (key: string) => {
      return (PAGE_TEXTS as Record<string, string>)[key] ?? "";
    },
    [],
  );

  return useMemo(() => ({ t, html }), [t, html]);
}
