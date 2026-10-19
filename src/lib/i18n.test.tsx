import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useT } from "./i18n";

function LanguageProbe() {
  const { lang, setLang } = useT();
  return <><output aria-label="active language">{lang}</output><button onClick={() => setLang("uk")}>choose Ukrainian</button></>;
}
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("hydrates the Ukrainian browser choice and updates html lang", () => {
  vi.spyOn(navigator, "language", "get").mockReturnValue("uk-UA");
  render(<I18nProvider><LanguageProbe /></I18nProvider>);
  expect(screen.getByLabelText("active language").textContent).toBe("uk");
  expect(document.documentElement.lang).toBe("uk");
});
it("persists a user choice and restores it before browser preference", () => {
  vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
  const view = render(<I18nProvider><LanguageProbe /></I18nProvider>);
  fireEvent.click(screen.getByRole("button"));
  expect(localStorage.getItem("nsb.lang")).toBe("uk");
  view.unmount();
  render(<I18nProvider><LanguageProbe /></I18nProvider>);
  expect(screen.getByLabelText("active language").textContent).toBe("uk");
  expect(document.documentElement.lang).toBe("uk");
});