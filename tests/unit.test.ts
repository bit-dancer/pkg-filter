import { expect, test, describe } from "bun:test";
import { compareVersions } from "../src/utils/debian-version";
import { parseDependencies } from "../src/utils/dependency-parser";
import { applyInclude, applyExclude, applyVersionKeep } from "../src/filter";

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
    expect(deps[0].orGroup).toBe(1);
    expect(deps[1].orGroup).toBe(1);
  });
});

describe("Filter Logic", () => {
  const mockPackages = [
    { Package: "redis-server", Version: "6.2.1", Priority: "optional" },
    { Package: "redis-server", Version: "6.2.2", Priority: "optional" },
    { Package: "redis-server", Version: "7.0.0", Priority: "optional" },
    { Package: "redis-doc", Version: "1.0", Priority: "extra" },
    { Package: "libredis-dev", Version: "1.0", Priority: "extra" },
  ];

  test("should exclude by priority and name", () => {
    const excludeRules = [
      { priority: ["extra"] },
      { name: ".*-dev$" }
    ];
    let result = applyExclude(mockPackages, excludeRules);
    expect(result).toHaveLength(3); // Only redis-server packages
    expect(result.some(p => p.Package.includes("doc"))).toBeFalse();
  });

  test("should keep specific versions", () => {
    const versionKeepRules = [{ name: "redis-server", 'version-keep': 2 }];
    let result = applyVersionKeep(mockPackages, versionKeepRules);
    // Should keep 7.0.0 and 6.2.2 (last 2)
    result = result.filter(p => p.Package === "redis-server");
    expect(result).toHaveLength(2);
    expect(result.map(p => p.Version)).toContain("7.0.0");
    expect(result.map(p => p.Version)).toContain("6.2.2");
    expect(result.map(p => p.Version)).not.toContain("6.2.1");
  });
});