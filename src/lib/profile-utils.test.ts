import { describe, expect, it } from "vitest";

import {
  ALL_GROUPS,
  UNGROUPED,
  acceptLangFor,
  appleChipCores,
  dataDirName,
  filterProfiles,
  formatUptime,
  groupOf,
  newProfileDraft,
  nextSeed,
  summarizeGroups,
} from "./profile-utils";
import type { Profile } from "./types";

function profile(overrides: Partial<Profile>): Profile {
  return { ...newProfileDraft([]), id: "0123456789abcdef", ...overrides };
}

const sample = [
  profile({ id: "a1", name: "alice@example.com", group: "mail", fingerprint: 1020 }),
  profile({ id: "b2", name: "bob", group: " ", fingerprint: 1018, proxy_server: "socks5://10.0.0.1:1080" }),
  profile({ id: "c3", name: "carol", group: "dev", fingerprint: 1030 }),
  profile({ id: "d4", name: "dave", group: "mail", fingerprint: 1019 }),
  profile({ id: "e5", name: "legacy", group: UNGROUPED, fingerprint: 999 }),
];

describe("分组", () => {
  it("空白分组归入未分组", () => {
    expect(groupOf({ group: "  " })).toBe(UNGROUPED);
    expect(groupOf({ group: " mail " })).toBe("mail");
  });

  it("按名称排序并把未分组置底", () => {
    expect(summarizeGroups(sample)).toEqual([
      { name: "dev", count: 1 },
      { name: "mail", count: 2 },
      { name: UNGROUPED, count: 2 },
    ]);
  });
});

describe("过滤", () => {
  it("按分组过滤，全部入口返回所有环境", () => {
    expect(filterProfiles(sample, "mail", "").map((p) => p.id)).toEqual(["a1", "d4"]);
    expect(filterProfiles(sample, ALL_GROUPS, "")).toHaveLength(5);
    expect(filterProfiles(sample, UNGROUPED, "").map((p) => p.id)).toEqual(["b2", "e5"]);
  });

  it("按名称、种子、代理搜索且忽略大小写", () => {
    expect(filterProfiles(sample, ALL_GROUPS, "ALICE").map((p) => p.id)).toEqual(["a1"]);
    expect(filterProfiles(sample, ALL_GROUPS, "1030").map((p) => p.id)).toEqual(["c3"]);
    expect(filterProfiles(sample, ALL_GROUPS, "socks5").map((p) => p.id)).toEqual(["b2"]);
    expect(filterProfiles(sample, "mail", "bob")).toEqual([]);
  });
});

describe("默认值与联动", () => {
  it("新建种子为最大值加一，无环境时为 1018", () => {
    expect(nextSeed(sample)).toBe(1031);
    expect(nextSeed([])).toBe(1018);
  });

  it("数据目录名取 id 前 8 位", () => {
    expect(dataDirName("f7c25865b20f6ba0")).toBe("chrome_f7c25865");
  });

  it("Apple 芯片核心数与旧版规则一致", () => {
    expect(appleChipCores("Apple M1")).toBe(8);
    expect(appleChipCores("Apple M1 Pro")).toBe(10);
    expect(appleChipCores("Apple M3 Max")).toBe(12);
    expect(appleChipCores("Apple M4")).toBe(10);
    expect(appleChipCores("Apple M5 Pro")).toBe(12);
    expect(appleChipCores("GeForce RTX 4090")).toBe(8);
  });

  it("语言联动 Accept-Language", () => {
    expect(acceptLangFor("zh-CN")).toBe("zh-CN,zh");
    expect(acceptLangFor("en-US")).toBe("en-US,en");
    expect(acceptLangFor("fr-FR")).toBeUndefined();
  });

  it("运行时长格式化", () => {
    expect(formatUptime(5)).toBe("5秒");
    expect(formatUptime(125)).toBe("2分 5秒");
    expect(formatUptime(3725)).toBe("1小时 2分");
  });
});
