const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,deps={},env={}) {const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{if(!(name in deps))throw Error('Unexpected import '+name);return deps[name]},URL,Buffer,Response,Date,console,process:{env}});return exports;}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const next={NextResponse:{json:(value,opts={})=>json(value,opts.status)},after:()=>{}};
const data={title:'Annonce officielle',excerpt:'Un fait confirmé.',content:'Une information sportive confirmée par la source. '.repeat(20)};
test('IA : les trois formats sont conservés et le prompt adapte les longueurs',async()=>{
  for(const format of ['FLASH','NEWS','ANALYSIS']) {
    let prompt;
    class OpenAI {constructor(){this.chat={completions:{create:async request=>{prompt=request.messages[0].content;return {choices:[{message:{content:JSON.stringify({...data,format})}}]}}}}}}
    const ai=load('src/lib/ai.ts',{openai:{default:OpenAI}},{DEEPSEEK_API_KEY:'fixture'});
    const result=await ai.generateArticleFromAlert({title:'Titre',sourceName:'Source',url:'https://example.test/source'});
    assert.equal(result.format,format);assert.match(prompt,/60 à 140 mots/);assert.match(prompt,/ANALYSIS/);
  }
});
test('IA : une analyse utilise uniquement les données fournies et refuse un texte trop court',async()=>{
  let request;
  let content='mot '.repeat(800);
  class OpenAI {constructor(){this.chat={completions:{create:async value=>{request=value;return {choices:[{message:{content:JSON.stringify({...data,format:'ANALYSIS',content})}}]}}}}}}
  const ai=load('src/lib/ai.ts',{openai:{default:OpenAI}},{DEEPSEEK_API_KEY:'fixture'});
  const result=await ai.generateMatchAnalysis({id:'match-1',homeTeam:'A',awayTeam:'B',homeScore:3,awayScore:2,competition:'Ligue',scheduledAt:new Date().toISOString(),statistics:[],events:[]});
  assert.equal(result.format,'ANALYSIS');assert.match(request.messages[0].content,/N'invente aucune composition/);assert.match(request.messages[1].content,/"homeScore":3/);assert.match(result.content,/\/match\/match-1/);
  content='Un texte trop court. '.repeat(20);
  await assert.rejects(ai.generateMatchAnalysis({id:'match',homeTeam:'A',awayTeam:'B',homeScore:1,awayScore:0,statistics:[],events:[]}),/trop courte/);
});
function push(prisma,send=async()=>{},env={VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private'}) {return load('src/lib/push.ts',{'web-push':{default:{sendNotification:send}},'next/server':next,'@/lib/prisma':{prisma}},env);}
test('Push : seules les destinations HTTPS des fournisseurs sont acceptées',()=>{
  const api=push({});
  for(const value of ['http://fcm.googleapis.com/x','https://localhost/x','https://127.0.0.1/x','https://fcm.googleapis.com.evil.test/x','https://user:password@fcm.googleapis.com/x','https://fcm.googleapis.com:444/x'])assert.equal(api.isPushEndpoint(value),false);
  assert.equal(api.isPushEndpoint('https://fcm.googleapis.com/fcm/send/example'),true);
  assert.equal(api.isPushEndpoint('https://web.push.apple.com/example'),true);
});
test('Push : aucun envoi ni marquage pour DRAFT, NEWS ou clés absentes',async()=>{
  for(const article of [{status:'DRAFT',format:'FLASH'},{status:'PUBLISHED',format:'NEWS'}]) {
    const api=push({article:{findUnique:async()=>article,updateMany:()=>assert.fail('No write')}} ,()=>assert.fail('No push'));
    assert.equal((await api.sendFlashPush('article')).skipped,true);
  }
  assert.equal((await push({},()=>assert.fail('No push'),{}).sendFlashPush('article')).skipped,true);
});
test('Push : une seule diffusion par Flash et suppression des endpoints expirés',async()=>{
  let claimed=false,sends=0,deleted=0,batches=0;
  const prisma={article:{findUnique:async()=>({status:'PUBLISHED',format:'FLASH',title:'Flash',slug:'flash',excerpt:'Résumé'}),updateMany:async()=>({count:claimed?0:(claimed=true,1)})},pushSubscription:{findMany:async()=>batches++?[]:[{id:'1',endpoint:'https://fcm.googleapis.com/live',p256dh:'key',auth:'auth'},{id:'2',endpoint:'https://fcm.googleapis.com/expired',p256dh:'key',auth:'auth'}],deleteMany:async()=>{deleted++;}}};
  const api=push(prisma,async(sub,payload)=>{sends++;assert.equal(JSON.parse(payload).url,'/article/flash');if(sub.endpoint.endsWith('/expired'))throw {statusCode:410};});
  const result=await api.sendFlashPush('article');assert.equal(result.sent,1);assert.equal(result.expired,1);assert.equal(deleted,1);
  assert.equal((await api.sendFlashPush('article')).skipped,true);assert.equal(sends,2);
});
test('Abonnements : le compte vient exclusivement de la session, jamais du formulaire',async()=>{
  let saved,removed;
  const endpoint='https://fcm.googleapis.com/fcm/send/test';
  const api=load('src/app/api/push/subscriptions/route.ts',{'next/server':next,'@/lib/auth':{auth:async()=>({user:{id:'reader'}})},'@/lib/prisma':{prisma:{pushSubscription:{findUnique:async()=>null,upsert:async value=>{saved=value},deleteMany:async value=>{removed=value}}}},'@/lib/push':{isPushEndpoint:push({}).isPushEndpoint,pushPublicKey:()=> 'fixture'}});
  const keys={p256dh:require('node:crypto').createECDH('prime256v1').generateKeys().toString('base64url'),auth:require('node:crypto').randomBytes(16).toString('base64url')};
  const request=new Request('https://www.promptsport.net/api/push/subscriptions',{method:'POST',body:JSON.stringify({endpoint,keys,readerId:'victim'})});
  assert.equal((await api.POST(request)).status,200);assert.equal(saved.create.readerId,'reader');
  assert.equal((await api.DELETE(new Request(request.url,{method:'DELETE',body:JSON.stringify({endpoint,readerId:'victim'})}))).status,200);
  assert.equal(removed.where.readerId,'reader');
  assert.equal((await api.POST(new Request(request.url,{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}))).status,403);
});
test('Abonnements : une requête anonyme est refusée avant Prisma',async()=>{
  const api=load('src/app/api/push/subscriptions/route.ts',{'next/server':next,'@/lib/auth':{auth:async()=>null},'@/lib/prisma':{prisma:{}},'@/lib/push':{}});
  assert.equal((await api.GET()).status,401);
  assert.equal((await api.POST(new Request('https://www.promptsport.net/api/push/subscriptions',{method:'POST'}))).status,401);
});
function cron(prisma,generate=async()=>data,env={CRON_SECRET:'secret'}) {return load('src/app/api/cron/auto-analysis/route.ts',{'node:crypto':require('node:crypto'),'next/server':next,'@/lib/prisma':{prisma},'@/lib/ai':{generateMatchAnalysis:generate},'next/cache':{revalidatePath:()=>{}}},env);}
test('Cron : refuse les tokens URL ou invalides avant tout accès Prisma',async()=>{
  const api=cron({});
  assert.equal((await api.GET(new Request('http://localhost/api/cron/auto-analysis?token=secret'))).status,401);
  assert.equal((await api.GET(new Request('http://localhost/api/cron/auto-analysis',{headers:{Authorization:'Bearer invalid'}}))).status,401);
});
test('Cron : aucun appel IA sans match majeur ou avant 48 heures',async()=>{
  const request=new Request('http://localhost/api/cron/auto-analysis',{headers:{Authorization:'Bearer secret'}});
  let api=cron({article:{findFirst:async()=>null},match:{findMany:async()=>[]}},()=>assert.fail('No AI'));
  assert.equal((await (await api.GET(request)).json()).reason,'no_major_match');
  api=cron({article:{findFirst:async()=>({id:'previous'})}},()=>assert.fail('No AI'));
  assert.equal((await (await api.GET(request)).json()).reason,'already_generated');
});
test('Cron : choisit le match le plus documenté et conserve DRAFT par défaut',async()=>{
  const match=(id,score,statistics)=>({id,homeScore:score,awayScore:0,homeTeamId:'home',awayTeamId:'away',homeTeam:{name:'A'},awayTeam:{name:'B'},competition:{name:'Ligue'},scheduledAt:new Date(),statistics,events:[]});
  const stats={teamId:'home',possession:60,shots:20,shotsOnTarget:8,corners:8,fouls:2,yellowCards:1,redCards:0};
  let created;
  const api=cron({article:{findFirst:async()=>null,create:async value=>{created=value.data;return{id:'analysis'}}},match:{findMany:async()=>[match('goals',4,[]),match('documented',2,[stats,{...stats,teamId:'away'}])]},author:{findFirst:async()=>({id:'editor'})},category:{findUnique:async()=>({id:'football'})},theme:{findFirst:async()=>null}},async value=>{assert.equal(value.id,'documented');return data;});
  const result=await (await api.GET(new Request('http://localhost/api/cron/auto-analysis',{headers:{Authorization:'Bearer secret'}}))).json();
  assert.equal(result.generated,true);assert.equal(created.status,'DRAFT');assert.equal(created.format,'ANALYSIS');assert.equal(created.matchId,'documented');assert.equal(created.publishedAt,null);assert.match(created.autoAnalysisKey,/^period-/);
});
test('Service Worker : notification sûre avec cache public et sans navigation externe',async()=>{
  const handlers={};let displayed,opened;
  const scope={location:{origin:'https://www.promptsport.net'},addEventListener:(event,handler)=>handlers[event]=handler,registration:{showNotification:async(title,options)=>{displayed={title,...options}}},clients:{matchAll:async()=>[],openWindow:async url=>{opened=url}}};
  vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),{self:scope,URL});
  assert.equal(typeof handlers.fetch,"function");
  let pending;handlers.push({data:{json:()=>({title:'Flash',body:'Résumé',url:'https://evil.test'})},waitUntil:promise=>pending=promise});await pending;assert.equal(displayed.data.url,'/');
  handlers.push({data:{json:()=>null},waitUntil:promise=>pending=promise});await pending;assert.equal(displayed.title,'PromptSport');
  handlers.notificationclick({notification:{close:()=>{},data:{url:'https://evil.test'}},waitUntil:promise=>pending=promise});await pending;assert.equal(opened,'https://www.promptsport.net/');
});
