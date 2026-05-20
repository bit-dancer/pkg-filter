import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { spawn } from "child_process";

describe("E2E Tests", () => {
  let server: any;

  beforeAll(async () => {
    // Start server in test mode with mock config (skip initial sync by using empty config)
    const testConfig = {
      "test-repo": {
        "upstream": "http://archive.ubuntu.com/ubuntu",
        "dist": "focal",
        "components": ["main"],
        "arch": ["amd64"],
        "include": [{ name: "bash" }], // Only include one small package for fast test
        "exclude": [],
        "deps": {
          "follow-recommends": false,
          "follow-suggests": false
        },
        "allow-unresolved": true
      }
    };
    
    // Write temp config
    await Bun.write("./config/test/e2e-config.json", JSON.stringify(testConfig));
    
    server = spawn("bun", ["run", "src/index.ts"], {
      env: { ...process.env, CONFIG_PATH: "./config/test/e2e-config.json", PORT: "3000" },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // Wait for server to start
    await new Promise(r => setTimeout(r, 3000));
  }, 60000);

  afterAll(() => {
    if (server) {
      server.kill();
    }
  });

  test("should health check", async () => {
    const res = await fetch("http://localhost:3000/health");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
  });

  test("should list packages", async () => {
    const res = await fetch("http://localhost:3000/r/test-repo/packages/list");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBeTrue();
  });
});