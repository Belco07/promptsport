"use client";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted,setMounted]=useState(false);
  useEffect(()=>setMounted(true),[]);
  if(!mounted)return <span aria-hidden="true" className="inline-block h-7 w-14"/>;
  return <div role="group" aria-label="Thème du site" className="inline-flex h-7 items-center rounded-full bg-muted p-0.5">
    {[{value:"light",label:"Jour",Icon:Sun},{value:"dark",label:"Nuit",Icon:Moon}].map(({value,label,Icon})=><button key={value} type="button" aria-label={label} aria-pressed={resolvedTheme===value} onClick={()=>setTheme(value)} className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors focus-visible:outline-2 ${resolvedTheme===value?"bg-background text-foreground shadow-sm":"text-muted-foreground hover:text-foreground"}`}><Icon aria-hidden="true" size={15}/></button>)}
  </div>;
}
