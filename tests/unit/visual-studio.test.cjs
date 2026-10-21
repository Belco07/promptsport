const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(file, imports, env={}) {
  const exports={};
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,URL,File,process:{env},require:name=>imports[name]??{}});
  return exports;
}
test('retour image : seuls les exports locaux et Blob autorisés sont acceptés',()=>{
  const {isVisualImageUrl:valid}=load('src/components/visual-studio/VisualStudioButton.tsx',{});
  for(const value of ['/uploads/example.png','/uploads/example.webp','https://store.public.blob.vercel-storage.com/uploads/example.png']) assert.equal(valid(value),true);
  for(const value of ['//evil.test/a.png','javascript:alert(1)','https://evil.test/a.png','http://store.public.blob.vercel-storage.com/uploads/a.png','https://user:pass@store.public.blob.vercel-storage.com/uploads/a.png','/uploads/../a.png','/uploads/a.svg',null]) assert.equal(valid(value),false);
});
test('enregistrement : contrôle des droits et absence de stockage production signalée',async()=>{
  for(const role of ['READER',null,'EDITOR']) {
    let called=false;
    const actions=load('src/app/studio/visual-studio/actions.ts',{
      '@/lib/auth':{auth:async()=>role?{user:{id:'fixture',role}}:null},
      '@/lib/roles':{canAccessStudio:role=>role==='EDITOR'},
      '@/app/studio/articles/actions':{uploadImage:async()=>{called=true;return {ok:true,url:'unused'};}},
    },{NODE_ENV:'production'});
    const result=await actions.saveVisualImage(new FormData());
    assert.equal(result.ok,false);assert.equal(called,false);
  }
});
test('enregistrement : PNG et WebP délèguent la validation et l’upload existants',async()=>{
  let called=0;
  const actions=load('src/app/studio/visual-studio/actions.ts',{
    '@/lib/auth':{auth:async()=>({user:{id:'fixture',role:'EDITOR'}})},
    '@/lib/roles':{canAccessStudio:()=>true},
    '@/app/studio/articles/actions':{uploadImage:async()=>{called++;return {ok:true,url:'/uploads/image.png'};}},
  },{NODE_ENV:'production',BLOB_READ_WRITE_TOKEN:'fixture'});
  for(const type of ['image/png','image/webp']){const data=new FormData();data.set('file',new File(['fixture'],'image',{type}));assert.equal((await actions.saveVisualImage(data)).ok,true);}
  const data=new FormData();data.set('file',new File(['svg'],'image.svg',{type:'image/svg+xml'}));assert.equal((await actions.saveVisualImage(data)).ok,false);assert.equal(called,2);
});
