import { expect, it } from "vitest";
import { weeklyCounts } from "../src/analytics";
import { type Session } from "../src/model";
const session = (date: string, status = "completed") =>
  ({ date, status }) as Session;
it("八周全零保持八个周一边界；单周非零排除草稿与未完成", () => {
  expect(weeklyCounts([], "2027-01-03").map((w) => w.count)).toEqual(
    Array(8).fill(0),
  );
  const w = weeklyCounts(
    [
      session("2026-12-28"),
      session("2027-01-03"),
      session("2027-01-03", "draft"),
      session("2027-01-03", "incomplete"),
      session("2027-01-04"),
    ],
    "2027-01-03",
  );
  expect(w.at(-1)).toEqual({ from: "2026-12-28", count: 2 });
  expect(w.slice(0, -1).every((x) => x.count === 0)).toBe(true);
});
it("跨月跨年、多周、大次数且窗口外历史不被删除", () => {
  const sessions = [
    ...Array.from({ length: 99 }, () => session("2026-12-31")),
    session("2027-01-04"),
    session("2026-12-01"),
    session("2020-01-01"),
  ];
  const w = weeklyCounts(sessions, "2027-01-05");
  expect(w.at(-1)?.count).toBe(1);
  expect(w.at(-2)?.count).toBe(99);
  expect(w.reduce((a, b) => a + b.count, 0)).toBe(101);
  expect(sessions).toHaveLength(102);
});
