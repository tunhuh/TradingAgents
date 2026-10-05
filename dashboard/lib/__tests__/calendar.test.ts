import { describe, expect, it } from "vitest";
import { monthGrid, monthLabel, parseDay, parseMonth, runsByDay, runsPerWeek, shiftMonth, weekStart } from "@/lib/calendar";

describe("month helpers", () => {
  it("parses, shifts and labels months", () => {
    expect(parseMonth("2026-10")).toBe("2026-10");
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthLabel("2026-10")).toBe("October 2026");
  });
});

describe("monthGrid", () => {
  it("builds Monday-first weeks covering the month", () => {
    const g = monthGrid("2026-10"); // 1 Oct 2026 is a Thursday
    expect(g[0].map((d) => d.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(g[0][2].inMonth).toBe(false);
    expect(g[0][3]).toEqual({ date: "2026-10-01", day: 1, inMonth: true });
    expect(g.at(-1)!.at(-1)!.date).toBe("2026-11-01");
    expect(g).toHaveLength(5);
  });
  it("crosses the year boundary", () => {
    expect(monthGrid("2027-01")[0][0].date).toBe("2026-12-28");
  });
});

describe("runsByDay / weeks", () => {
  it("groups runs by their local run date", () => {
    const m = runsByDay([{ runAt: "2026-10-04T22:04:13" }, { runAt: "2026-10-04T21:34:24" }, { runAt: "2026-10-05T09:13:24" }]);
    expect(m.get("2026-10-04")).toHaveLength(2);
    expect(m.get("2026-10-05")).toHaveLength(1);
  });
  it("counts runs per Monday-starting week, oldest first, including empty weeks", () => {
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
    expect(runsPerWeek(["2026-10-04", "2026-10-05", "2026-10-05", "2026-09-17"], 3, "2026-10-05")).toEqual([
      { week: "2026-09-21", count: 0 },
      { week: "2026-09-28", count: 1 },
      { week: "2026-10-05", count: 2 },
    ]);
  });
});

describe("parseDay", () => {
  it("accepts only real calendar dates", () => {
    expect(parseDay("2026-09-17")).toBe("2026-09-17");
    expect(parseDay("2026-13-45")).toBeNull();
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay(undefined)).toBeNull();
  });
});
