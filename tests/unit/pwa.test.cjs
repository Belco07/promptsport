const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function worker(network=async()=>new Response('<html>public</html>',{headers:{'Content-Type':'text/html'}})) {
  const handlers={},stores=new Map();
  const caches={open:async name=>{if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {put:async(k,v)=>store.set(typeof k==='string'?k:k.url,v.clone()),match:async k=>store.get(typeof k==='string'?k:k.url)?.clone(),keys:async()=>[...store.keys()].map(url=>({url})),delete:async k=>store.delete(k.url||k),addAll:async()=>{}}},keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),match:async()=>new Response('fallback')};
  vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),{self:{location:{origin:'https://www.promptsport.net'},addEventListener:(name,fn)=>handlers[name]=fn},fetch:network,caches,URL,Response,Headers,Date});
  return {handlers,stores};
}
test('PWA : manifeste et icônes Android/iOS cohérents',()=>{
  const manifest=JSON.parse(fs.readFileSync('public/manifest.json','utf8'));
  assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');
  for(const size of [192,512]){const icon=manifest.icons.find(i=>i.sizes===`${size}x${size}`&&i.purpose==='any');assert.ok(icon);const png=fs.readFileSync('public'+icon.src);assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);}
});
test('PWA : les sauvegardes ne transmettent jamais la session',async()=>{
  let options;const {handlers,stores}=worker(async(url,opts)=>{options=opts;return new Response('public preview',{headers:{'Content-Type':'text/html'}})});
  let pending;handlers.message({data:{type:'CACHE_PUBLIC_PAGE',pathname:'/article/example'},waitUntil:p=>pending=p});await pending;
  assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');
  assert.equal(await stores.get('promptsport-pages-v1').get('https://www.promptsport.net/article/example').text(),'public preview');
});
test('PWA : compte, API, RSC et recherche ne sont jamais mis en cache',async()=>{
  const {handlers,stores}=worker();
  for(const pathname of ['/mon-compte','/api/search','/studio','/login']) {
    let called=false;handlers.fetch({request:{method:'GET',mode:'navigate',url:'https://www.promptsport.net'+pathname},respondWith:()=>called=true});assert.equal(called,false);
    handlers.message({data:{type:'CACHE_PUBLIC_PAGE',pathname},waitUntil:p=>p});
  }
  let called=false;handlers.fetch({request:{method:'GET',mode:'cors',url:'https://www.promptsport.net/article/test?_rsc=abc'},respondWith:()=>called=true});assert.equal(called,false);assert.equal(stores.size,0);
});
test('PWA : document public disponible hors ligne, aucun repli sur le compte',async()=>{
  let offline=false;const {handlers}=worker(async()=>{if(offline)throw Error('offline');return new Response('saved article',{headers:{'Content-Type':'text/html'}})});
  let pending;handlers.message({data:{type:'CACHE_PUBLIC_PAGE',pathname:'/article/example'},waitUntil:p=>pending=p});await pending;offline=true;
  let result;handlers.fetch({request:{method:'GET',mode:'navigate',url:'https://www.promptsport.net/article/example'},respondWith:p=>result=p});assert.equal(await (await result).text(),'saved article');
});
