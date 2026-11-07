import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../../lib/db/src/index.ts";
import { maintainProject } from "../../artifacts/api-server/src/lib/project-store.ts";

await test("retention archives without deleting; baseline survives; expired empty recording is incomplete", async () => {
  const id=randomUUID(), j=randomUUID(), owner="retention-fixture-"+randomUUID();
  const baseline=randomUUID(), old=randomUUID(), expired=randomUUID();
  try {
    await pool.query("INSERT INTO tl_journeys(id,owner,name) VALUES($1,$2,'Retention fixture')",[j,owner]);
    await pool.query(`INSERT INTO tl_projects(id,public_id,owner,name,url,origins,workflow_name,steps,retention_days,journey_id)
      VALUES($1,$2,$3,'Retention fixture','https://fixture.invalid','[\"https://fixture.invalid\"]','Retention','[]',1,$4)`,[id,"tl_"+id,owner,j]);
    for(const [runId,status] of [[baseline,"passed"],[old,"failed"],[expired,"recording"]]) {
      await pool.query(`INSERT INTO tl_runs(id,journey_id,owner,project_id,name,variant,status,created_at)
        VALUES($1,$2,$3,$4,'Retention fixture','external',$5,now()-interval '10 days')`,[runId,j,owner,id,status]);
    }
    await pool.query("UPDATE tl_journeys SET baseline_id=$2 WHERE id=$1",[j,baseline]);
    await pool.query(`INSERT INTO tl_sessions(id,project_id,run_id,token_hash,origin,purpose,expires_at)
      VALUES($1,$2,$3,$4,'https://fixture.invalid','record',now()-interval '1 hour')`,[randomUUID(),id,expired,"unused-expired-fixture-"+randomUUID()]);
    await maintainProject(id);
    const rows=(await pool.query("SELECT id,status,archived_at,finished_at FROM tl_runs WHERE project_id=$1",[id])).rows;
    assert.equal(rows.length,3,"Retention must not delete recordings");
    assert.ok(rows.find(r=>r.id===old).archived_at);
    assert.equal(rows.find(r=>r.id===baseline).archived_at,null);
    assert.equal(rows.find(r=>r.id===expired).status,"incomplete");
    assert.ok(rows.find(r=>r.id===expired).finished_at);
    await pool.query("UPDATE tl_runs SET archived_at=NULL WHERE id=$1",[old]);
    assert.equal((await pool.query("SELECT archived_at FROM tl_runs WHERE id=$1",[old])).rows[0].archived_at,null);
  } finally {
    await pool.query("UPDATE tl_projects SET archived_at=now() WHERE id=$1",[id]);
    await pool.end();
  }
});
