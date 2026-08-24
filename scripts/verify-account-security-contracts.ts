import assert from "node:assert/strict";
import { AccountClosureReadinessService } from "../lib/account/domain/closure.ts";
assert.equal((await new AccountClosureReadinessService([{ id: "billing", async inspect() { return []; } }]).inspect("owner")).ready, true);
const blocked = await new AccountClosureReadinessService([{ id: "grant", async inspect() { return [{ authority: "grant", code: "active_edit", message: "存在未完成修改" }]; } }]).inspect("owner");
assert.equal(blocked.ready, false); assert.equal(blocked.blockers[0]?.authority, "grant");
console.log("account security and closure contracts passed");
