export type Lang = "en" | "ru" | "uk";
export const languageLocale = (lang: Lang) => ({ en: "en-US", ru: "ru-RU", uk: "uk-UA" })[lang];

/** Explicit saved choices take priority over browser detection. */
export function initialLanguage(saved: string | null, browserLanguage: string): Lang {
  if (saved === "en" || saved === "ru" || saved === "uk") return saved;
  const primary = browserLanguage.toLowerCase().split(/[-_]/)[0];
  return primary === "uk" || primary === "ru" ? primary : "en";
}