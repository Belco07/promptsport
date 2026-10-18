"use client";
import { useEffect, useState } from "react";
export function MatchLocalTime({ date, timeOnly = false }: { date: string; timeOnly?: boolean }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => { const value = new Date(date); setLabel(value.toLocaleString("fr-FR", timeOnly ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })); }, [date, timeOnly]);
  return <time dateTime={date} title="Heure dans votre fuseau horaire">{label ?? "…"}</time>;
}
