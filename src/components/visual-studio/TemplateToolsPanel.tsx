"use client";

import { useId, useState, type ReactNode } from "react";

export default function TemplateToolsPanel({ disabled, groups }: {
  disabled: boolean;
  groups: { id: string; title: string; description: string; content: ReactNode }[];
}) {
  const [active, setActive] = useState("model");
  const prefix = useId();
  return <div>
    <p className="mb-3 text-xs text-muted-foreground">Réglez la mise en page par étapes. Tous les éléments seront verrouillés pour les journalistes.</p>
    {groups.map((group,index) => <section key={group.id} className="border-t border-border">
      <h2><button type="button" aria-expanded={active === group.id} aria-controls={`${prefix}-${group.id}`} onClick={() => setActive(active === group.id ? "" : group.id)} className="flex w-full items-center gap-3 py-3 text-left text-sm font-bold text-foreground focus-visible:outline-2 focus-visible:outline-editorial-link">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">{index+1}</span>
        <span className="flex-1">{group.title}</span><span aria-hidden="true">{active === group.id ? "−" : "+"}</span>
      </button></h2>
      <div id={`${prefix}-${group.id}`} hidden={active !== group.id}>
        <p className="mb-3 text-xs text-muted-foreground">{group.description}</p>
        <fieldset disabled={disabled} className="space-y-3 pb-4 disabled:opacity-60">{group.content}</fieldset>
      </div>
    </section>)}
  </div>;
}
