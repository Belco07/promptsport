const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(file, dependencies={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>dependencies[name]});
  return exports;
}
test('typographie : seules les graisses réellement disponibles sont proposées',()=>{
  const {fontWeights,EDITOR_FONTS}=load('src/components/visual-studio/editor-fonts.ts');
  assert.deepEqual(Array.from(EDITOR_FONTS),['Inter','Sora','Oswald','Barlow Condensed']);
  assert.deepEqual(Array.from(fontWeights('Inter')),[100,200,300,400,500,600,700,800,900]);
  assert.deepEqual(Array.from(fontWeights('Sora')),[100,200,300,400,500,600,700,800]);
  assert.deepEqual(Array.from(fontWeights('Oswald')),[200,300,400,500,600,700]);
  assert.equal(fontWeights('Barlow Condensed').length,9);
});
test('fond : remplacer la photo conserve les autres éléments verrouillés et son ordre',()=>{
  const {installBackground,backgroundLayer}=load('src/components/visual-studio/background-layer.ts');
  const logo={selectable:false,left:800,top:40}; const title={selectable:false,text:'Titre'};
  const old={assetRole:'background'}; const objects=[old,logo,title];
  const canvas={backgroundImage:{},getObjects:()=>objects,remove:o=>objects.splice(objects.indexOf(o),1),insertAt:(i,o)=>objects.splice(i,0,o),requestRenderAll:()=>{}};
  const image={set(values){Object.assign(this,values)},setCoords(){}};
  installBackground(canvas,image);
  assert.equal(backgroundLayer(canvas),image);assert.equal(objects[0],image);
  assert.equal(image.selectable,true);assert.equal(image.lockMovementX,false);
  assert.equal(canvas.backgroundImage,undefined);
  assert.deepEqual(objects.slice(1),[logo,title]); assert.equal(logo.selectable,false);assert.equal(logo.left,800);
});
