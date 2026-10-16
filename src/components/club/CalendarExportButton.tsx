export function CalendarExportButton({ slug }: { slug: string }) {
  return <a href={`/api/club/${encodeURIComponent(slug)}/calendar.ics`} className="inline-flex rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-secondary">Ajouter à mon calendrier</a>;
}
