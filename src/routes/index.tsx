import { createFileRoute } from "@tanstack/react-router";
import { BridgeApp } from "@/components/bridge/BridgeApp";
import { I18nProvider } from "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Native Stablecoin Bridge — USDC & EURC burn-and-mint" },
      { name: "description", content: "Move USDC and EURC natively between chains with CCTP burn-and-mint. No wrapped tokens, no pools, no extra fees." },
      { property: "og:title", content: "Native Stablecoin Bridge" },
      { property: "og:description", content: "Native USDC and EURC transfers across chains with burn-and-mint. Independent, client-side interface." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <I18nProvider>
      <TooltipProvider delayDuration={150}>
        <BridgeApp />
      </TooltipProvider>
    </I18nProvider>
  );
}
