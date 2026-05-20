import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { spawn } from "child_process";

describe("E2E Tests", () => {
  let server: any;

  beforeAll(async () => {
    // Start server in test mode
    server = spawn("bun", ["run", "src/index.ts"], {
      env: { ...process.env, CONFIG_PATH: "./config/test" },
      detached: true
    });
    await new Promise(r => setTimeout(r, 2000)); // Wait for start
  });

  afterAll(() => {
    if (server) server.kill();
  });

  test("should health check", async () => {
    const res = await fetch("http://localhost:3000/health");
    expect(res.status).toBe(200);
  });

  test("should sync repo", async () => {
    const res = await fetch("http://localhost:3000/r/test-repo/sync");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Sync completed");
  });

  test("should list packages", async () => {
    const res = await fetch("http://localhost:3000/r/test-repo/packages/list");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBeTrue();
  });
});