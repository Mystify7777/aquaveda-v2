import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../src/app.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { Knowledge } from "../src/models/Knowledge.js";
import { User } from "../src/models/User.js";
import { register } from "../src/services/auth.service.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * #90 — the complete authenticated Knowledge moderation journey over the
 * REAL app (createApp), with EXPERT authority acquired exclusively
 * through the real #91 lifecycle over HTTP:
 *
 *   USER --POST /expert-application--> pending
 *   ADMIN --POST /expert-application/:id/approve--> EXPERT
 *   author: create (draft) -> submit (pending_review)
 *   EXPERT: queue -> workflow detail -> approve | reject
 *
 * Lifecycle states are the locked ADR-0004 ones
 * (draft -> pending_review -> approved | rejected -> draft); none added.
 * ADMIN is a direct fixture write only because #89 owns ADMIN provisioning.
 */

let server;
let baseUrl;

before(async () => {
  await setupTestDb();
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardownTestDb();
});

beforeEach(clearCollections);

function request(method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = {};
    if (bodyStr !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }
    if (token) headers.Cookie = `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
    const req = http.request(`${baseUrl}${path}`, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          // non-JSON body
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

let seq = 0;
async function makeUser(name = `Person ${++seq}`) {
  const { user, accessToken } = await register({
    name,
    email: `p${seq}-${Date.now()}-${Math.random()}@example.com`,
    password: "correcthorsebatterystaple",
  });
  return { id: String(user.id), token: accessToken };
}

async function makeAdmin() {
  const u = await makeUser("Admin");
  await User.updateOne({ _id: u.id }, { $set: { role: "ADMIN" } });
  return u;
}

/** A genuine EXPERT: applies over HTTP, approved by an ADMIN over HTTP. */
async function makeExpertViaHttp(admin, name = "Expert") {
  const u = await makeUser(name);
  assert.equal((await request("POST", "/api/v1/expert-application", { token: u.token })).status, 201);
  const res = await request("POST", `/api/v1/expert-application/${u.id}/approve`, { token: admin.token });
  assert.equal(res.status, 200);
  return u;
}

const KN = "/api/v1/knowledge";

async function submitted(author, title = "Drip irrigation") {
  const created = await request("POST", KN, { token: author.token, body: { title, body: `Body of ${title}` } });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.status, "draft");
  const id = created.json.data._id;
  const sub = await request("POST", `${KN}/${id}/submit`, { token: author.token });
  assert.equal(sub.status, 200);
  assert.equal(sub.json.data.status, "pending_review");
  return id;
}

const publicIds = async () =>
  (await request("GET", KN)).json.data.items.map((i) => i._id);

describe("approval path", () => {
  it("USER -> draft -> pending_review -> EXPERT approves -> public; before approval it is invisible", async () => {
    const admin = await makeAdmin();
    const expert = await makeExpertViaHttp(admin);
    const author = await makeUser("Asha");
    const id = await submitted(author);

    // Not public while pending_review: list and detail (uniform 404).
    assert.ok(!(await publicIds()).includes(id));
    assert.equal((await request("GET", `${KN}/${id}`)).status, 404);

    // Own status retrieval.
    const mine = await request("GET", `${KN}/mine`, { token: author.token });
    assert.deepEqual(mine.json.data.items.map((i) => [i._id, i.status]), [[id, "pending_review"]]);

    // Reviewer queue + detail (EXPERT only).
    const queue = await request("GET", `${KN}/review-queue`, { token: expert.token });
    assert.deepEqual(queue.json.data.items.map((i) => i._id), [id]);
    const detail = await request("GET", `${KN}/${id}/workflow`, { token: expert.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.body, "Body of Drip irrigation");

    const approved = await request("POST", `${KN}/${id}/approve`, { token: expert.token });
    assert.equal(approved.status, 200);
    assert.equal(approved.json.data.status, "approved");

    // Public after approval, anonymously.
    assert.ok((await publicIds()).includes(id));
    const pub = await request("GET", `${KN}/${id}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.json.data.author.name, "Asha");

    // Leaves the queue.
    const after = await request("GET", `${KN}/review-queue`, { token: expert.token });
    assert.equal(after.json.data.total, 0);

    // Stored decision: reviewer is the real EXPERT, and not the author.
    const doc = await Knowledge.findById(id).lean();
    assert.equal(String(doc.reviewHistory.at(-1).reviewer), expert.id);
    assert.notEqual(expert.id, author.id);
  });
});

describe("rejection path", () => {
  it("reject -> non-public, author sees feedback; revise -> resubmit -> approve -> public WITHOUT old feedback", async () => {
    const admin = await makeAdmin();
    const expert = await makeExpertViaHttp(admin);
    const author = await makeUser("Asha");
    const id = await submitted(author);

    const rej = await request("POST", `${KN}/${id}/reject`, {
      token: expert.token,
      body: { feedback: "Cite a source for the flow rates." },
    });
    assert.equal(rej.status, 200);
    assert.equal(rej.json.data.status, "rejected");

    // Non-public: list, public detail.
    assert.ok(!(await publicIds()).includes(id));
    assert.equal((await request("GET", `${KN}/${id}`)).status, 404);
    // Author's own detail carries the feedback; an EXPERT cannot open a non-pending article.
    const own = await request("GET", `${KN}/${id}/workflow`, { token: author.token });
    assert.equal(own.json.data.reviewHistory.at(-1).feedback, "Cite a source for the flow rates.");
    assert.equal((await request("GET", `${KN}/${id}/workflow`, { token: expert.token })).status, 404);

    // rejected -> approved directly is illegal.
    const direct = await request("POST", `${KN}/${id}/approve`, { token: expert.token });
    assert.equal(direct.status, 409);
    assert.equal(direct.json.code, "INVALID_STATE");

    // Revise (rejected -> draft), resubmit, approve.
    const rev = await request("POST", `${KN}/${id}/revise`, {
      token: author.token,
      body: { body: "Revised, with citations." },
    });
    assert.equal(rev.status, 200);
    assert.equal(rev.json.data.status, "draft");
    assert.ok(!(await publicIds()).includes(id));
    assert.equal((await request("POST", `${KN}/${id}/submit`, { token: author.token })).status, 200);
    assert.equal((await request("POST", `${KN}/${id}/approve`, { token: expert.token })).status, 200);

    // Public, but earlier-cycle moderation feedback must never be public.
    const pub = await request("GET", `${KN}/${id}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.json.data.body, "Revised, with citations.");
    assert.deepEqual(pub.json.data.reviewHistory.map((e) => e.decision), ["rejected", "approved"]);
    for (const e of pub.json.data.reviewHistory) {
      assert.equal("feedback" in e, false);
      assert.equal(typeof e.reviewer, "string");
    }
    assert.ok(!JSON.stringify(pub.json).includes("Cite a source"));
    const list = await request("GET", KN);
    assert.ok(!JSON.stringify(list.json).includes("Cite a source"));
    assert.equal("__v" in pub.json.data, false);
  });
});

describe("authority", () => {
  it("USER, ADMIN, anonymous cannot review; an applicant who is only pending/rejected cannot either", async () => {
    const admin = await makeAdmin();
    const expert = await makeExpertViaHttp(admin);
    const author = await makeUser();
    const id = await submitted(author);

    const stranger = await makeUser();
    const pendingApplicant = await makeUser();
    await request("POST", "/api/v1/expert-application", { token: pendingApplicant.token });
    const rejectedApplicant = await makeUser();
    await request("POST", "/api/v1/expert-application", { token: rejectedApplicant.token });
    await request("POST", `/api/v1/expert-application/${rejectedApplicant.id}/reject`, {
      token: admin.token,
      body: { note: "not yet" },
    });

    for (const actor of [stranger, admin, pendingApplicant, rejectedApplicant]) {
      assert.equal((await request("POST", `${KN}/${id}/approve`, { token: actor.token })).status, 403);
      assert.equal(
        (await request("POST", `${KN}/${id}/reject`, { token: actor.token, body: { feedback: "x" } })).status,
        403,
      );
      assert.equal((await request("GET", `${KN}/review-queue`, { token: actor.token })).status, 403);
      assert.equal((await request("GET", `${KN}/${id}/workflow`, { token: actor.token })).status, 404);
    }
    for (const [m, p, b] of [
      ["POST", `${KN}/${id}/approve`],
      ["POST", `${KN}/${id}/reject`, { feedback: "x" }],
      ["GET", `${KN}/review-queue`],
    ]) {
      assert.equal((await request(m, p, { body: b })).status, 401, `${m} ${p}`);
    }

    // Nothing changed.
    assert.equal((await Knowledge.findById(id).lean()).status, "pending_review");
    assert.ok(!(await publicIds()).includes(id));
    // The genuine EXPERT still can.
    assert.equal((await request("POST", `${KN}/${id}/approve`, { token: expert.token })).status, 200);
  });

  it("ownership grants no review authority: an EXPERT cannot approve or reject their own submission", async () => {
    const admin = await makeAdmin();
    const expert = await makeExpertViaHttp(admin);
    const id = await submitted(expert, "Expert-authored");

    assert.equal((await request("POST", `${KN}/${id}/approve`, { token: expert.token })).status, 403);
    assert.equal(
      (await request("POST", `${KN}/${id}/reject`, { token: expert.token, body: { feedback: "x" } })).status,
      403,
    );
    // Their own article is absent from their own review queue.
    const q = await request("GET", `${KN}/review-queue`, { token: expert.token });
    assert.ok(!q.json.data.items.some((i) => i._id === id));
    assert.equal((await Knowledge.findById(id).lean()).status, "pending_review");

    // A different genuine EXPERT can review it.
    const other = await makeExpertViaHttp(admin, "Other Expert");
    assert.equal((await request("POST", `${KN}/${id}/approve`, { token: other.token })).status, 200);
  });

  it("an author's own role is irrelevant to authorship: USER cannot approve their own submission", async () => {
    const author = await makeUser();
    const id = await submitted(author);
    assert.equal((await request("POST", `${KN}/${id}/approve`, { token: author.token })).status, 403);
  });
});

describe("invalid transitions and races", () => {
  it("draft cannot be approved/rejected; approved cannot be re-decided; submit only from draft", async () => {
    const admin = await makeAdmin();
    const expert = await makeExpertViaHttp(admin);
    const author = await makeUser();

    const draft = (await request("POST", KN, { token: author.token, body: { title: "T", body: "B" } })).json.data;
    for (const [action, body] of [["approve"], ["reject", { feedback: "x" }]].map((a) => [a[0], a[1]])) {
      const res = await request("POST", `${KN}/${draft._id}/${action}`, { token: expert.token, body });
      assert.equal(res.status, 409, `draft ${action}`);
      assert.equal(res.json.code, "INVALID_STATE");
    }

    const id = await submitted(author);
    assert.equal((await request("POST", `${KN}/${id}/approve`, { token: expert.token })).status, 200);
    for (const [action, body] of [["approve"], ["reject", { feedback: "x" }]].map((a) => [a[0], a[1]])) {
      const res = await request("POST", `${KN}/${id}/${action}`, { token: expert.token, body });
      assert.equal(res.status, 409, `approved ${action}`);
    }
    assert.equal((await request("POST", `${KN}/${id}/submit`, { token: author.token })).status, 409);
    assert.equal((await Knowledge.findById(id).lean()).reviewHistory.length, 1);
  });

  it("two EXPERTS racing approve vs reject: exactly one decision is persisted", async () => {
    const admin = await makeAdmin();
    const e1 = await makeExpertViaHttp(admin, "E1");
    const e2 = await makeExpertViaHttp(admin, "E2");
    const author = await makeUser();
    const id = await submitted(author);

    const [a, r] = await Promise.all([
      request("POST", `${KN}/${id}/approve`, { token: e1.token }),
      request("POST", `${KN}/${id}/reject`, { token: e2.token, body: { feedback: "no" } }),
    ]);
    const statuses = [a.status, r.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const loser = a.status === 409 ? a : r;
    assert.ok(["STATE_RACE", "INVALID_STATE"].includes(loser.json.code));

    const doc = await Knowledge.findById(id).lean();
    assert.equal(doc.reviewHistory.length, 1);
    assert.equal(doc.status, doc.reviewHistory[0].decision);
    assert.equal((await publicIds()).includes(id), doc.status === "approved");
  });
});
