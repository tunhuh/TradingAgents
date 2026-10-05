import { describe, expect, it } from "vitest";
import { formatDay, formatWhen } from "@/lib/format";

describe("formatWhen / formatDay", () => {
  it("formats local wall-clock times without locale dependence", () => {
    expect(formatWhen("2026-10-04T22:04:13")).toBe("4 Oct 2026, 22:04");
    expect(formatWhen("2026-01-09T07:05:00")).toBe("9 Jan 2026, 07:05");
    expect(formatDay("2026-10-04T22:04:13")).toBe("4 Oct");
  });
});
