import { useCallback, useMemo } from "react";
import { PAGE_TEXTS } from "@open-im/i18n";

export type Lang = "en" | "zh";

export function useI18n(lang: Lang) {
  const t = useCallback(
    (key: string, params: Record<string, string | number> = {}) => {
      const source = PAGE_TEXTS[lang] ?? PAGE_TEXTS.en;
      const en = PAGE_TEXTS.en;
      const template = (source as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
      return Object.keys(params).reduce(
        (acc, name) => acc.replaceAll(`{${name}}`, String(params[name])),
        template,
      );
    },
    [lang],
  );

  const html = useCallback(
    (key: string) => {
      const source = PAGE_TEXTS[lang] ?? PAGE_TEXTS.en;
      const en = PAGE_TEXTS.en;
      return (source as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? "";
    },
    [lang],
  );

  return useMemo(() => ({ t, html }), [t, html]);
}
