import type { CSSProperties } from "react";

export type TimelineCategory = { name: string; color?: string | null };

/** White labels always retain a readable background, including custom colors. */
export function TimelineBadge({ category }: { category?: TimelineCategory | null }) {
  const color = category?.color;
  const valid = color && /^#[0-9a-f]{6}$/i.test(color);
  const channels = valid ? [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) : null;
  const luminance = channels ? channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 : 1;
  const style: CSSProperties = { backgroundColor: valid ? color : "hsl(var(--primary, 222 47% 11%))", backgroundImage: valid && luminance > .183 ? "linear-gradient(#0009, #0009)" : undefined };
  return <span style={style} className="inline-flex max-w-full items-center rounded-sm px-2 py-1 text-[10px] font-bold uppercase leading-tight tracking-wide text-white">{category?.name ?? "À classer"}</span>;
}
