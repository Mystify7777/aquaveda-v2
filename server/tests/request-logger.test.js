import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../src/app.js";

function request(app, path) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
                res.resume();
                res.on("end", () => server.close(() => resolve(res.statusCode)));
            });
            req.on("error", (error) => server.close(() => reject(error)));
        });
        server.on("error", reject);
    });
}

describe("request logging middleware", () => {
    it("logs method, query-free path, final status, and duration after the response finishes", async () => {
        const logs = [];
        const originalLog = console.log;
        console.log = (message) => logs.push(message);

        try {
            const status = await request(createApp(), "/api/v1/does-not-exist?secret=do-not-log");

            assert.equal(status, 404);
            assert.equal(logs.length, 1);

            const entry = JSON.parse(logs[0]);
            assert.deepEqual(Object.keys(entry).sort(), ["durationMs", "method", "path", "status"]);
            assert.equal(entry.method, "GET");
            assert.equal(entry.path, "/api/v1/does-not-exist");
            assert.equal(entry.status, 404);
            assert.equal(typeof entry.durationMs, "number");
            assert.ok(entry.durationMs >= 0);
            assert.equal(logs[0].includes("secret"), false);
        } finally {
            console.log = originalLog;
        }
    });
});