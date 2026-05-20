import { expect, test, describe } from "bun:test";
import { compareVersions } from "../src/utils/debian-version";
import { parseDependencies } from "../src/utils/dependency-parser";
import { filterPackages } from "../src/filter";

describe("Debian Version Comparison", () => {
  test("should compare simple versions", () => {
    expect(compareVersions("1.0", "1.0")).toBe(0);
    expect(compareVersions("1.1", "1.0")).toBe(1);
    expect(compareVersions("1.0", "1.1")).toBe(-1);
  });

  test("should handle tildes", () => {
    expect(compareVersions("1.0~rc1", "1.0")).toBe(-1);
    expect(compareVersions("1.0~rc1", "1.0~beta")).toBe(1);
  });

  test("should handle epochs", () => {
    expect(compareVersions("1:1.0", "2.0")).toBe(1);
  });
});

describe("Dependency Parser", () => {
  test("should parse simple depends", () => {
    const deps = parseDependencies("libc6 (>= 2.31), libssl1.1");
    expect(deps).toHaveLength(2);
    expect(deps[0].name).toBe("libc6");
    expect(deps[0].versionOp).toBe(">=");
    expect(deps[0].version).toBe("2.31");
  });

  test("should parse OR dependencies", () => {
    const deps = parseDependencies("pkg1 | pkg2");
    expect(deps).toHaveLength(2);
    expect(deps[0].orGroup).toBe(0);
    expect(deps[1].orGroup).toBe(0);
  });
});

describe("Filter Logic", () => {
  const mockPackages = [
    { name: "redis-server", version: "6.2.1", priority: "optional" },
    { name: "redis-server", version: "6.2.2", priority: "optional" },
    { name: "redis-server", version: "7.0.0", priority: "optional" },
    { name: "redis-doc", version: "1.0", priority: "extra" },
    { name: "libredis-dev", version: "1.0", priority: "extra" },
  ];

  test("should exclude by priority and name", () => {
    const rules = [
      { priority: ["extra"] },
      { name: ".*-dev$" }
    ];
    const result = filterPackages(mockPackages, [], rules);
    expect(result).toHaveLength(3); // Only redis-server packages
    expect(result.some(p => p.name.includes("doc"))).toBeFalse();
  });

  test("should keep specific versions", () => {
    const include = [{ name: "redis-server", versionKeep: 2 }];
    const result = filterPackages(mockPackages, include, []);
    // Should keep 7.0.0 and 6.2.2 (last 2)
    expect(result).toHaveLength(2);
    expect(result.map(p => p.version)).toContain("7.0.0");
    expect(result.map(p => p.version)).toContain("6.2.2");
    expect(result.map(p => p.version)).not.toContain("6.2.1");
  });
});