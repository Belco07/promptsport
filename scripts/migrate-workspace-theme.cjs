// One-off migration of legacy editorial UI colors to existing semantic tokens.
const fs = require('node:fs');
const path = require('node:path');
const replacements = {
  'bg-neutral-50':'bg-muted','bg-neutral-100':'bg-muted','bg-neutral-200':'bg-muted',
  'text-neutral-400':'text-muted-foreground','text-neutral-500':'text-muted-foreground','text-neutral-600':'text-muted-foreground','text-neutral-700':'text-foreground','text-neutral-800':'text-foreground','text-neutral-900':'text-foreground',
  'border-neutral-100':'border-border','border-neutral-200':'border-border','border-neutral-300':'border-border','divide-neutral-200':'divide-border',
  'text-blue-900':'text-editorial-link','text-red-900':'text-status-error-foreground','border-blue-600':'border-editorial-link','border-blue-700':'border-editorial-link',
  'bg-white': 'bg-card', 'bg-gray-50':'bg-muted', 'bg-gray-100':'bg-muted', 'bg-gray-200':'bg-muted',
  'text-gray-400':'text-muted-foreground', 'text-gray-500':'text-muted-foreground', 'text-gray-600':'text-muted-foreground',
  'text-gray-700':'text-foreground', 'text-gray-800':'text-foreground', 'text-gray-900':'text-foreground',
  'border-gray-100':'border-border','border-gray-200':'border-border','border-gray-300':'border-border', 'divide-gray-100':'divide-border','divide-gray-200':'divide-border',
  'bg-blue-600':'bg-primary','bg-blue-700':'bg-primary','bg-blue-800':'bg-primary-hover',
  'text-blue-600':'text-editorial-link','text-blue-700':'text-editorial-link','text-blue-800':'text-editorial-link',
  'bg-blue-50':'bg-status-info','bg-blue-100':'bg-status-info','border-blue-200':'border-status-info-border',
  'bg-red-50':'bg-status-error','bg-red-100':'bg-status-error','text-red-600':'text-status-error-foreground','text-red-700':'text-status-error-foreground','text-red-800':'text-status-error-foreground','border-red-200':'border-status-error-border',
  'bg-red-600':'bg-destructive','bg-red-700':'bg-destructive',
  'bg-green-50':'bg-status-success','bg-green-100':'bg-status-success','text-green-600':'text-status-success-foreground','text-green-700':'text-status-success-foreground','text-green-800':'text-status-success-foreground','border-green-200':'border-status-success-border',
  'bg-yellow-50':'bg-status-warning','bg-yellow-100':'bg-status-warning','text-yellow-700':'text-status-warning-foreground','text-yellow-800':'text-status-warning-foreground','border-yellow-200':'border-status-warning-border',
  'bg-amber-50':'bg-status-warning','bg-amber-100':'bg-status-warning','text-amber-700':'text-status-warning-foreground','text-amber-800':'text-status-warning-foreground','border-amber-200':'border-status-warning-border',
};
let changed = 0;
function visit(dir) {
 for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
  const file=path.join(dir,entry.name);
  if(entry.isDirectory()) visit(file);
  else if(file.endsWith('.tsx')) {
   const before=fs.readFileSync(file,'utf8');
   const after=before.replace(/(?<![\w-])(bg|text|border|divide)-(white|gray-\d+|neutral-\d+|blue-\d+|red-\d+|green-\d+|yellow-\d+|amber-\d+)(?![\w/-])/g, token=>replacements[token]??token);
   if(before!==after) {fs.writeFileSync(file,after);changed++;}
  }
 }
}
visit('src/app/studio'); visit('src/app/backoffice');
for (const file of ['src/components/ImageUpload.tsx','src/components/AnalyticsChart.tsx','src/lib/roles.ts','src/lib/articleStatus.ts']) {
 const before=fs.readFileSync(file,'utf8');
 const after=before.replace(/(?<![\w-])(bg|text|border|divide)-(white|gray-\d+|neutral-\d+|blue-\d+|red-\d+|green-\d+|yellow-\d+|amber-\d+)(?![\w/-])/g, token=>replacements[token]??token);
 if(before!==after) {fs.writeFileSync(file,after);changed++;}
}
console.log(`${changed} composants migrés vers les couleurs du thème`);
