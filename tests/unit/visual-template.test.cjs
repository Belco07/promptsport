const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/visual-template.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject,structuredClone,URL});
const {lockTemplate,validateTemplate}=exportsObject;
const document=()=>({width:1200,height:630,objects:[{type:'Textbox',text:'Titre',field:'title'},{type:'Group',objects:[{type:'Image',src:'https://example.test/logo.png'}]},{type:'Textbox',text:'Sujet',field:'subject'}]});
test('template : verrouillage récursif sans mutation de la mise en page',()=>{
  const original=document(),locked=lockTemplate(original);
  assert.equal(original.objects[0].selectable,undefined);
  assert.equal(locked.objects[0].editable,false);
  assert.equal(locked.objects[0].selectable,false);
  assert.equal(locked.objects[1].objects[0].lockMovementX,true);
  assert.equal(locked.objects[1].objects[0].evented,false);
});
test('template : limites de dimensions, éléments et URL dangereuses rejetées',()=>{
  assert.equal(validateTemplate(document()),true);
  assert.equal(validateTemplate({...document(),objects:[{type:'Image',src:'/promptsport-logo.webp'}]}),true);
  for(const value of [null,{...document(),width:5000},{...document(),objects:null},{...document(),objects:[{type:'Image',src:'javascript:alert(1)'}]}]) assert.equal(validateTemplate(value),false);
});
test('template : un journaliste ne peut pas enregistrer un template',async()=>{
  const actions={};let writes=0;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/studio/templates/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actions,require:name=>({
    '@/lib/auth':{auth:async()=>({user:{id:'journalist',role:'JOURNALIST'}})},
    '@/lib/prisma':{prisma:{visualTemplate:{upsert:async()=>{writes++;}}}},
    'next/cache':{revalidatePath:()=>{}},
    '@/lib/visual-template':exportsObject,
  })[name]});
  const result=await actions.saveVisualTemplate('Template',JSON.stringify(document()));
  assert.equal(result.ok,false);assert.equal(writes,0);
});
test('template : un admin enregistre uniquement un document validé et verrouillé',async()=>{
  const actions={};const writes=[];
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/studio/templates/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actions,require:name=>({
    '@/lib/auth':{auth:async()=>({user:{id:'admin',role:'ADMIN'}})},
    '@/lib/prisma':{prisma:{visualTemplate:{upsert:async data=>{writes.push(data);}}}},
    'next/cache':{revalidatePath:()=>{}},
    '@/lib/visual-template':exportsObject,
  })[name]});
  assert.equal((await actions.saveVisualTemplate('Template','{')).ok,false);
  assert.equal(writes.length,0);
  assert.equal((await actions.saveVisualTemplate('Template',JSON.stringify(document()))).ok,true);
  assert.equal(writes[0].create.document.objects[0].selectable,false);
  assert.equal(writes[0].create.document.objects[0].field,'title');
});

test('template par défaut : portrait, dégradé, logo et deux champs verrouillés',()=>{
  const doc=exportsObject.defaultVisualTemplate();
  assert.equal(doc.width,1080);assert.equal(doc.height,1350);
  assert.equal(validateTemplate(doc),true);
  assert.deepEqual(Array.from(doc.objects.filter(o=>o.field),o=>o.field),['title','subject']);
  assert.equal(doc.objects.some(o=>o.fill?.type==='linear'),true);
  assert.equal(doc.objects[0].fill.colorStops[0].color,'rgba(0,0,0,0)');
  assert.equal(doc.objects.find(o=>o.assetRole==='logo').filters[0].color,'#ffffff');
  assert.equal(doc.objects.some(o=>o.type==='Image'&&o.src==='/promptsport-logo.webp'&&o.left>800),true);
  assert.equal(doc.objects.every(o=>o.selectable===false&&o.lockMovementX===true),true);
  doc.objects[0].left=999;assert.equal(exportsObject.defaultVisualTemplate().objects[0].left,0);
});

test('bibliothèque : créer et modifier un modèle ne remplace pas les autres',async()=>{
  const actions={}, records=new Map();
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/studio/templates/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actions,crypto:require('node:crypto'),require:name=>({
    '@/lib/auth':{auth:async()=>({user:{id:'admin',role:'ADMIN'}})},
    '@/lib/prisma':{prisma:{visualTemplate:{upsert:async ({where,create,update})=>{records.set(where.id,records.has(where.id)?update:create);}}}},
    'next/cache':{revalidatePath:()=>{}},'@/lib/visual-template':exportsObject,
  })[name]});
  const first=await actions.saveVisualTemplate('Premier',JSON.stringify(document()),null);
  const second=await actions.saveVisualTemplate('Deuxième',JSON.stringify(document()),null);
  assert.equal(first.ok,true);assert.equal(second.ok,true);assert.notEqual(first.id,second.id);
  assert.equal(records.size,2);
  const savedSecond=JSON.stringify(records.get(second.id));
  assert.equal((await actions.saveVisualTemplate('Premier modifié',JSON.stringify(document()),first.id)).ok,true);
  assert.equal(records.get(first.id).name,'Premier modifié');
  assert.equal(JSON.stringify(records.get(second.id)),savedSecond);
  assert.equal(records.size,2);
});

test('dégradé du modèle : Fabric reçoit des couleurs avec transparence réelle',async()=>{
  const {Gradient}=require('fabric');
  const gradient=await Gradient.fromObject(exportsObject.defaultVisualTemplate().objects[0].fill);
  const stops=[];
  gradient.toLive({createLinearGradient:()=>({addColorStop:(offset,color)=>stops.push({offset,color})})});
  assert.equal(stops[0].color,'rgba(0,0,0,0)');
  assert.equal(stops[1].color,'rgba(0,0,0,.75)');
});
