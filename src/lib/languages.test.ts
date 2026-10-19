import { expect, it } from "vitest";
import { initialLanguage, languageLocale } from "./languages";
it("detects Ukrainian browser locales on a first visit", () => {
  expect(initialLanguage(null, "uk-UA")).toBe("uk");
  expect(initialLanguage(null, "uk")).toBe("uk");
});
it("detects Russian and defaults all other browser locales to English", () => {
  expect(initialLanguage(null, "ru-RU")).toBe("ru");
  expect(initialLanguage(null, "fr-FR")).toBe("en");
});
it("preserves explicit language choices over browser preferences", () => {
  expect(initialLanguage("en", "uk-UA")).toBe("en");
  expect(initialLanguage("uk", "ru-RU")).toBe("uk");
  expect(initialLanguage("invalid", "uk-UA")).toBe("uk");
});
it("uses Ukrainian number/date formatting locale", () => {
  expect(languageLocale("uk")).toBe("uk-UA");
  expect(languageLocale("ru")).toBe("ru-RU");
  expect(languageLocale("en")).toBe("en-US");
});