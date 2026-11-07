import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { randomUUID, createHash, randomBytes, webcrypto } from "node:crypto";
import pg from "../../lib/db/node_modules/pg/lib/index.js";
import { projectJourney, compareJourneySteps } from "../../artifacts/tracelens/src/lib/journey.ts";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const base = "http://localhost:80", origin = "http://localhost:4321", collector = base + "/api/collector";
const steps = [{id:"prepare",label:"Review options",outcome:"ready"},{id:"submit",label:"Submit request",outcome:"created"},{id:"confirmation",label:"Confirmation",outcome:"shown"}];
const owner = "script-fixture-" + randomUUID(), project = randomUUID(), journey = randomUUID(), publicId = "tl_" + randomUUID();
const hash = s => createHash("sha256").update(s).digest("hex");
let sdk;
async function grant(options = {}) {
  const secret = randomBytes(32).toString("base64url"), runId = randomUUID(), id = randomUUID();
  await db.query("INSERT INTO tl_runs(id,journey_id,owner,name,variant,project_id,expected_steps) VALUES($1,$2,$3,'Separate-app test','external',$4,$5)",[runId,journey,owner,project,JSON.stringify(steps)]);
  await db.query("INSERT INTO tl_sessions(id,project_id,run_id,token_hash,origin,purpose,expires_at,revoked_at) VALUES($1,$2,$3,$4,$5,'record',$6,$7)",
    [id,project,runId,hash(secret),options.origin || origin,new Date(Date.now()+(options.expired?-1000:1200000)),options.revoked?new Date():null]);
  return {secret,runId,id};
}
function post(path, grant, body = {}, o = origin) {
  return fetch(collector + path, {method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+grant.secret,...(o?{Origin:o}:{})},body:JSON.stringify({projectId:publicId,...body})});
}
async function events(runId) {
  const r = await db.query("SELECT * FROM tl_events WHERE run_id=$1 ORDER BY sequence",[runId]);
  return r.rows.map(e=>({...e.payload,id:e.id,runId,source:e.source,sequence:Number(e.sequence),createdAt:e.created_at.toISOString()}));
}
function browser(g, storage = new Map(), faults = {}) {
  const listeners = new Map(), location = {href:origin+"/"};
  const nativeFetch = async (input, init = {}) => {
    const url = new URL(typeof input==="string"?input:input.url,location.href);
    if (url.origin === new URL(collector).origin && faults.offline && url.pathname.endsWith("/events")) throw new TypeError("Network interrupted");
    if (faults.requests) faults.requests.push(url.pathname);
    const response = await fetch(url, {...init,headers:{...init.headers,Origin:origin}});
    if (url.pathname.endsWith("/events") && faults.loseAck) { faults.loseAck=false;throw new TypeError("Acknowledgement interrupted"); }
    return response;
  };
  const sandbox = {
    URL, Request, Response, Headers, AbortController, performance, crypto:webcrypto, location,
    fetch:nativeFetch, setTimeout, clearTimeout, setInterval:(fn,delay)=>{const t=setInterval(fn,delay);t.unref();return t;}, clearInterval, queueMicrotask,
    CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},
    dispatchEvent:()=>{},addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:(k)=>listeners.delete(k),
    document:{addEventListener(){},removeEventListener(){}},
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    history:{pushState(_state,_title,url){location.href=new URL(url,location.href).href;},replaceState(){}},
  };
  sandbox.window=sandbox;
  vm.runInNewContext(sdk,sandbox);
  return {sandbox,nativeFetch,storage,connect:(extra={})=>sandbox.TraceLens.connect({collectorUrl:collector,projectId:publicId,session:g.secret,consent:true,...extra})};
}
async function execute(rec, mode="working") {
  await rec.step("prepare",async ctx=>{
    const rs=await Promise.all([ctx.fetch(origin+"/api/options?token=secret-never-store"),ctx.fetch(origin+"/api/availability")]);
    const [options,availability]=await Promise.all(rs.map(r=>r.json()));
    assert.ok(rs.every(r=>r.ok)&&Array.isArray(options.categories)&&options.categories.length>0&&availability.accepting===true);
    if(mode!=="unknown")ctx.outcome("ready","Ready to submit");
  });
  let created=false;
  await rec.step("submit",async ctx=>{
    const body=JSON.stringify({title:mode==="missing"?"":"private-input-never-store",actionId:ctx.actionId,transient:mode==="retry"});
    const opts={method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer application-secret-never-store"},body};
    let r=await ctx.fetch(origin+"/api/requests?secret=never-store",opts);
    if(mode==="retry"&&r.status===503)r=await ctx.fetch(origin+"/api/requests",opts);
    const result=await r.json();created=r.ok&&result.status==="created"&&typeof result.id==="string"&&result.id.length>0;
    assert.ok(result);
    if(mode!=="unknown"&&created)ctx.outcome("created","Request created");
    else if(mode!=="unknown"&&r.status===422&&result.outcome==="title_required")ctx.outcome("title_required","Title required");
  });
  if(created)await rec.step("confirmation",async ctx=>{if(mode!=="unknown")ctx.outcome("shown","Confirmation shown");});
}
try {
  sdk = await (await fetch(base+"/api/sdk.js")).text();
  assert.ok(sdk.includes('version:"2.0.0"'),"Test the actual distributable SDK, not an alternate implementation");
  await db.query("INSERT INTO tl_journeys(id,owner,name) VALUES($1,$2,'Separate app workflow')",[journey,owner]);
  await db.query("INSERT INTO tl_projects(id,public_id,owner,name,url,origins,workflow_name,steps,journey_id) VALUES($1,$2,$3,'Test fixture',$4,$5,'Request workflow',$6,$7)",
    [project,publicId,owner,origin,JSON.stringify([origin]),JSON.stringify(steps),journey]);
  await test("dashboard reads/writes/exports require managed auth; no test-header bypass",async()=>{
    for(const path of ["/api/projects","/api/projects/"+project,"/api/projects/"+project+"/runs/unknown/export"]) {
      const r=await fetch(base+path,{headers:{"x-test-owner":owner}});
      assert.equal(r.status,401,path);
    }
    assert.equal((await fetch(base+"/api/projects",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).status,401);
    assert.equal((await fetch(base+"/api/readyz")).status,200);
  });
  await test("scoped sessions reject invalid/expired/revoked tokens and wrong origins/projects/runs",async()=>{
    const g=await grant();
    assert.equal((await post("/connect",g)).status,200);
    assert.equal((await post("/connect",{...g,secret:"x".repeat(43)})).status,403);
    assert.equal((await post("/connect",await grant({expired:true}))).status,403);
    assert.equal((await post("/connect",await grant({revoked:true}))).status,403);
    assert.equal((await post("/connect",g,{},"https://not-allowed.invalid")).status,403);
    assert.equal((await post("/connect",g,{projectId:"wrong-project"})).status,403);
    assert.equal((await post("/connect",g,{},null)).status,403);
    assert.equal((await post("/events",g,{runId:randomUUID(),events:[{eventId:randomUUID(),actionId:"a",stepId:"submit",kind:"click",label:"Submit"}]})).status,403);
    const preflight=await fetch(collector+"/events",{method:"OPTIONS",headers:{Origin:origin,"Access-Control-Request-Headers":"authorization,content-type","Access-Control-Request-Method":"POST"}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get("access-control-allow-origin"),origin);
    assert.equal(preflight.headers.get("access-control-allow-credentials"),null,"Collector never relies on ambient cookies");
  });
  let workingEvents;
  await test("separate app action -> real API -> distributable SDK -> persisted business outcomes; fetch restored",async()=>{
    const calls=[], g=await grant(), b=browser(g,new Map(),{requests:calls}), rec=await b.connect();
    const again=await b.connect();assert.equal(again,rec,"Install once");
    const before=await (await fetch(origin+"/api/metrics")).json();
    await execute(rec);const [result, duplicateStop]=await Promise.all([rec.stop(),rec.stop()]);
    assert.equal(result.status,"passed");assert.deepEqual(duplicateStop,result);
    assert.equal(calls.filter(p=>p.endsWith("/finish")).length,1);
    assert.equal(calls.filter(p=>p.endsWith("/disconnect")).length,0,"A successful finish already revokes the session");
    assert.equal(b.sandbox.fetch,b.nativeFetch,"stop cleanly unpatches");
    const after=await (await fetch(origin+"/api/metrics")).json();assert.equal(after.writes-before.writes,1);
    workingEvents=await events(g.runId);
    assert.ok(workingEvents.some(e=>e.kind==="api"&&e.status===201));
    assert.ok(workingEvents.every(e=>!e.path||!/[?#]/.test(e.path)));
    assert.ok(!JSON.stringify(workingEvents).includes("private-input-never-store"));
    assert.ok(!JSON.stringify(workingEvents).includes("application-secret-never-store"));
    const a=workingEvents.find(e=>e.path==="/api/options"), c=workingEvents.find(e=>e.path==="/api/availability");
    assert.equal(a.parentId,c.parentId);assert.equal(a.actionId,c.actionId);
    assert.ok(Date.parse(a.createdAt)>Date.parse(c.createdAt)-c.durationMs,"Actual parallel request intervals overlap");
    const projected=projectJourney(workingEvents,{variant:"external",status:"passed"},steps);
    assert.ok(projected.every(s=>s.status==="passed"));
  });
  await test("changed real behavior aligns the submit failure and untouched confirmation",async()=>{
    const g=await grant(), rec=await browser(g).connect();await execute(rec,"missing");
    assert.equal((await rec.stop()).status,"failed");
    const es=await events(g.runId), logical=projectJourney(es,{variant:"external",status:"failed"},steps);
    assert.equal(logical.find(s=>s.id==="submit").outcome,"Title required");
    assert.equal(logical.find(s=>s.id==="confirmation").status,"not_reached");
    const rows=compareJourneySteps(projectJourney(workingEvents,{variant:"external",status:"passed"},steps),logical);
    assert.equal(rows.find(r=>r.changed).id,"submit");
  });
  await test("transient retry makes one real write; failed attempt retained; lost acknowledgement deduplicated",async()=>{
    const g=await grant(), b=browser(g,new Map(),{loseAck:true}), rec=await b.connect();
    const before=await (await fetch(origin+"/api/metrics")).json();
    await execute(rec,"retry");assert.equal((await rec.stop()).status,"passed");
    const es=await events(g.runId), apis=es.filter(e=>e.kind==="api"&&e.stepId==="submit");
    assert.deepEqual(apis.map(e=>e.status),[503,201]);assert.equal(apis[0].actionId,apis[1].actionId);
    assert.equal(new Set(es.map(e=>e.eventId)).size,es.length);
    assert.equal((await (await fetch(origin+"/api/metrics")).json()).writes-before.writes,1);
    assert.equal(projectJourney(es,{variant:"external",status:"passed"},steps).find(s=>s.id==="submit").status,"recovered");
  });
  await test("2xx without explicit expected outcomes is unknown; no-event conclusion is incomplete",async()=>{
    const g=await grant(), rec=await browser(g).connect();await execute(rec,"unknown");
    assert.equal((await rec.stop()).status,"unknown");
    const logical=projectJourney(await events(g.runId),{variant:"external",status:"unknown"},steps);
    assert.ok(logical.every(s=>s.status!=="passed"));
    const empty=await browser(await grant()).connect();assert.equal((await empty.stop()).status,"incomplete");
  });
  await test("network interruption leaves queue recoverable; explicit resume delivers same ids",async()=>{
    const g=await grant(), store=new Map(), faults={offline:true}, b=browser(g,store,faults), rec=await b.connect();
    await execute(rec);assert.equal(await rec.flush(),false);assert.ok(rec.state().pending>0);
    rec.detach();faults.offline=false;
    // Detach explicitly closes its heartbeat; allow delivery microtasks before the new runtime.
    await new Promise(r=>setTimeout(r,50));
    const resumed=await browser(g,store).connect();assert.ok(await resumed.flush());
    assert.equal(resumed.state().pending,0);
    const result=await resumed.stop();assert.equal(result.status,"passed");
    const es=await events(g.runId);assert.equal(new Set(es.map(e=>e.eventId)).size,es.length);
  });
  await test("multiple live tabs cannot silently conclude each other's run",async()=>{
    const g=await grant(), a=await browser(g).connect(), b=await browser(g).connect();
    await execute(a);await assert.rejects(a.stop(),/409/);
    b.detach();await new Promise(r=>setTimeout(r,50));
    const c=await browser(g).connect();assert.equal((await c.stop()).status,"passed");
  });
  await test("collector rejects payload values, spoofed internals, unknown keys; metadata stays redacted",async()=>{
    const g=await grant(), event={eventId:randomUUID(),actionId:"a",stepId:"submit",kind:"api",label:"Submit",method:"POST",status:422,path:"/api/requests?secret=value#private"};
    assert.equal((await post("/events",g,{runId:g.runId,events:[{...event,request:{title:"private"}}]})).status,400);
    assert.equal((await post("/events",g,{runId:g.runId,events:[{...event,kind:"internal"}]})).status,403);
    const fields={address:{present:true,empty:true,type:"string",redacted:true}};
    assert.equal((await post("/events",g,{runId:g.runId,events:[{...event,request:{fields}}]})).status,200);
    const es=await events(g.runId);assert.deepEqual(es[0].request.fields.address,fields.address);assert.equal(es[0].path,"/api/requests");
  });
  await test("SDK opt-in schema captures only field metadata; bounded overflow warns and concludes incomplete",async()=>{
    const g=await grant(), rec=await browser(g).connect({payloadSchema:{request:{address:true}}});
    await rec.step("submit",ctx=>ctx.fetch(origin+"/api/requests",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({address:"",title:"private-opt-in-never-store",actionId:ctx.actionId})}));
    await rec.stop();
    const es=await events(g.runId), api=es.find(e=>e.kind==="api");
    assert.deepEqual(api.request.fields.address,{present:true,empty:true,type:"string",redacted:true});
    assert.ok(!JSON.stringify(es).includes("private-opt-in-never-store"));
    const other=await grant(), faults={offline:true}, b=browser(other,new Map(),faults), q=await b.connect({maxQueue:25});
    for(let i=0;i<40;i++)await q.step("submit",async ctx=>ctx.outcome("created","Request created"));
    assert.ok(q.state().dropped>0);assert.ok(q.state().warnings.some(w=>w.includes("queue is full")));
    faults.offline=false;
    assert.equal((await q.stop()).status,"incomplete");
  });
  await test("trusted server keys hashed/scoped/revocable; browser origin cannot use them",async()=>{
    const g=await grant(), secret=randomBytes(32).toString("base64url"), id=randomUUID();
    await db.query("INSERT INTO tl_credentials(id,project_id,token_hash,name,expires_at) VALUES($1,$2,$3,'test',now()+interval '1 hour')",[id,project,hash(secret)]);
    const body={projectId:publicId,runId:g.runId,event:{eventId:randomUUID(),actionId:"trusted",stepId:"submit",kind:"internal",label:"Request accepted",response:{outcome:"created",message:"Request created"}}};
    const send=(data=body,extra={})=>fetch(collector+"/server",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+secret,...extra},body:JSON.stringify(data)});
    assert.equal((await send()).status,200);assert.equal((await send()).status,200);
    assert.equal((await events(g.runId)).length,1);
    assert.equal((await send(body,{Origin:origin})).status,403);
    assert.equal((await send({...body,projectId:"wrong"})).status,403);
    assert.equal((await send({...body,runId:randomUUID()})).status,409);
    await db.query("UPDATE tl_credentials SET revoked_at=now() WHERE id=$1",[id]);assert.equal((await send()).status,403);
    const row=(await db.query("SELECT token_hash FROM tl_credentials WHERE id=$1",[id])).rows[0];assert.notEqual(row.token_hash,secret);
  });
} finally {
  // Reversibly isolate test data; never delete user/example recordings.
  await db.query("UPDATE tl_projects SET archived_at=now() WHERE id=$1",[project]);
  await db.query("UPDATE tl_sessions SET revoked_at=now() WHERE project_id=$1 AND revoked_at IS NULL",[project]);
  await db.end();
}
