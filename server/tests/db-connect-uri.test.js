import { describe, it, mock, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { connectDB } from "../src/config/db.js";

/**
 * #89 — connectDB({ uri }) connects to exactly the supplied string and
 * never consults the environment. No MongoDB needed: mongoose.connect is
 * stubbed. Kept in its own file (own process) because connectDB memoizes
 * its connection promise per process.
 */
describe("connectDB({ uri })", () => {
  const saved = process.env.MONGO_URI;
  after(() => {
    if (saved === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = saved;
  });

  it("uses the explicit URI even when MONGO_URI points somewhere else", async () => {
    process.env.MONGO_URI = "mongodb://db.example.com:27017/some_remote_db";
    const connect = mock.method(mongoose, "connect", async () => ({ connection: { name: "stub" } }));
    const explicit = "mongodb://127.0.0.1:27017/aquaveda_v2_dev";

    await connectDB({ uri: explicit });

    assert.equal(connect.mock.callCount(), 1);
    assert.deepEqual(connect.mock.calls[0].arguments, [explicit]);
  });
});
