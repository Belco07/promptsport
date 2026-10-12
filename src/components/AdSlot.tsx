import Image from "next/image";

/** Reserved ad space. AdSlotGate continues to hide it for premium readers. */
const FORMATS = {
  leaderboard: { ratio: "h-[100px] max-w-[320px] min-[768px]:h-[90px] min-[768px]:max-w-[728px] min-[1024px]:max-w-[970px] mx-auto", marker: "leaderboard" },
  banner: { ratio: "aspect-[1838/340]", marker: "banner" },
  rectangle: { ratio: "aspect-[6/5]", marker: "rectangle" },
  skyscraper: { ratio: "aspect-[1/2]", marker: "skyscraper" },
} as const;
export type AdFormat = keyof typeof FORMATS;

export function AdSlot({ format = "banner", label = "Publicité", className = "" }: {
  format?: AdFormat;
  label?: string;
  className?: string;
}) {
  const { ratio, marker } = FORMATS[format];
  return (
    <aside aria-label="Emplacement publicitaire" className={`w-full ${className}`}>
      <p className="mb-2 text-center text-[10px] font-normal uppercase tracking-wider text-muted-foreground">{label}</p>
      <div data-ad-slot={marker} className={`flex ${ratio} w-full items-center justify-center overflow-hidden bg-muted`}>
        <div className={format === "banner" || format === "leaderboard" ? "w-1/3 max-w-60" : "w-3/5 max-w-48"}>
          <Image src="/promptsport-logo.webp" alt="PromptSport" width={900} height={198} sizes="240px" loading="lazy" className="h-auto w-full grayscale opacity-60 mix-blend-multiply dark:hidden" />
          <Image src="/promptsport-logo-night.png" alt="PromptSport" width={4739} height={1044} sizes="240px" loading="lazy" className="hidden h-auto w-full opacity-40 dark:block" />
        </div>
      </div>
    </aside>
  );
}
