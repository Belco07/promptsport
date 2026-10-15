"use client";

import Image from "next/image";
import { Trophy } from "lucide-react";
import { useState } from "react";

// Image identifiers are independent of the sports data provider's tournament IDs.
const logos: Record<string, number> = {
  "ligue-1": 61,
  "premier-league": 39,
  liga: 140,
  "serie-a": 135,
  bundesliga: 78,
  "uefa-champions-league": 2,
  "uefa-europa-league": 3,
  "uefa-conference-league": 848,
};

export function CompetitionLogo({ slug }: { slug: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = logos[slug] ? `https://media.api-sports.io/football/leagues/${logos[slug]}.png` : null;

  return <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-white p-1.5">
    {source && failedSource !== source ? <Image src={source} alt="" width={36} height={36} sizes="36px" className="h-9 w-9 object-contain" onError={() => setFailedSource(source)} /> : <Trophy size={28} className="text-slate-500" />}
  </span>;
}
