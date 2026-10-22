"use client";
import { Circle, FabricObject, Group, Line, Polygon, Rect } from "fabric";
const origin = { originX: "left", originY: "top" } as const;
const shapes = [
  ["pill", "Pastille", "M12 10H88A10 10 0 0 1 88 30H12A10 10 0 0 1 12 10Z"],
  ["hex", "Badge hexagonal", "M15 5H85L98 20 85 35H15L2 20Z"],
  ["ribbon", "Ruban", "M2 8H98L88 20 98 32H2L12 20Z"],
  ["chevron", "Chevron", "M5 5H65L95 20 65 35H5L35 20Z"],
  ["star", "Étoile", "M50 1 62 13 88 13 70 24 77 39 50 30 23 39 30 24 12 13 38 13Z"],
  ["bubble", "Bulle", "M5 5H95V28H35L20 38V28H5Z"],
] as const;
const strokes = ["Trait fin", "Trait épais", "Tirets", "Pointillés", "Double trait", "Flèche longue", "Séparateur central", "Séparateur diagonal"];
export default function ShapePalette({ color, onAdd }: { color: string; onAdd: (object: FabricObject) => void }) {
  function shape(kind: string) {
    const points: Record<string, number[][]> = {
      hex: [[35,0],[265,0],[300,60],[265,120],[35,120],[0,60]],
      ribbon: [[0,0],[300,0],[270,60],[300,120],[0,120],[30,60]],
      chevron: [[0,0],[210,0],[300,60],[210,120],[0,120],[90,60]],
      bubble: [[0,0],[300,0],[300,100],[100,100],[55,140],[55,100],[0,100]],
      star: Array.from({length:10}, (_, index) => { const angle = index * Math.PI / 5 - Math.PI / 2; const radius = index % 2 ? 55 : 120; return [120 + Math.cos(angle) * radius, 120 + Math.sin(angle) * radius]; }),
    };
    onAdd(kind === "pill" ? new Rect({ ...origin, left:80,top:80,width:300,height:100,rx:50,ry:50,fill:color }) : new Polygon(points[kind].map(([x,y]) => ({x,y})), { ...origin,left:80,top:80,fill:color }));
  }
  function stroke(index: number) {
    const line = (coords: [number,number,number,number], width = 4) => new Line(coords, { ...origin, stroke: color, strokeWidth: width, strokeLineCap: "round" });
    let object: FabricObject;
    if (index === 4) object = new Group([line([0,0,300,0]),line([0,14,300,14])], origin);
    else if (index === 5) object = new Group([line([0,20,285,20],6),new Polygon([{x:270,y:0},{x:300,y:20},{x:270,y:40}],{...origin,fill:color})],origin);
    else if (index === 6) object = new Group([line([0,12,130,12]),line([170,12,300,12]),new Circle({...origin,left:140,top:2,radius:10,fill:color})],origin);
    else if (index === 7) object = new Group(Array.from({length:8},(_,i)=>line([i*35,30,i*35+20,0],6)),origin);
    else object = new Line([0,0,300,0], {...origin,stroke:color,strokeWidth:index===1?12:index===3?6:4,strokeDashArray:index===2?[20,12]:index===3?[1,13]:undefined,strokeLineCap:"round"});
    object.set({left:80,top:80}); onAdd(object);
  }
  return <div className="space-y-3"><p className="text-xs font-bold text-muted-foreground">Badges et formes</p><div className="grid grid-cols-3 gap-2">{shapes.map(([id,name,path]) => <button key={id} type="button" aria-label={`Ajouter ${name}`} title={name} onClick={() => shape(id)} className="rounded-lg border border-border p-2 text-foreground hover:bg-muted"><svg viewBox="0 0 100 40" className="h-8 w-full" aria-hidden="true"><path d={path} fill="currentColor" /></svg><span className="text-xs">{name}</span></button>)}</div><p className="text-xs font-bold text-muted-foreground">Traits et séparateurs</p><div className="grid grid-cols-2 gap-2">{strokes.map((name,index) => <button key={name} type="button" aria-label={`Ajouter ${name}`} onClick={() => stroke(index)} className="rounded-lg border border-border p-2 text-foreground hover:bg-muted"><svg viewBox="0 0 100 30" className="h-7 w-full" aria-hidden="true">{index===7 ? [10,30,50,70,90].map(x=><path key={x} d={`M${x-5} 23l10-16`} stroke="currentColor" strokeWidth="3" />) : <><path d={index===6?"M5 15H40M60 15H95":"M5 15H95"} stroke="currentColor" strokeWidth={index===1?6:2} strokeDasharray={index===2?"10 5":index===3?"1 6":undefined} strokeLinecap="round" />{index===4&&<path d="M5 23H95" stroke="currentColor" strokeWidth="2"/>}{index===5&&<path d="M85 7l10 8-10 8" fill="none" stroke="currentColor" strokeWidth="2"/>}{index===6&&<circle cx="50" cy="15" r="4" fill="currentColor"/>}</>}</svg><span className="text-xs">{name}</span></button>)}</div></div>;
}
