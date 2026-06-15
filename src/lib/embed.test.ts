import { describe, it, expect } from "vitest";
import { one } from "./embed";

describe("one", () => {
  it("returns a non-array embed unchanged", () => {
    const o = { email: "a@b.com" };
    expect(one(o)).toBe(o);
  });

  it("collapses an array embed to its first element", () => {
    expect(one([{ email: "a@b.com" }, { email: "c@d.com" }])).toEqual({
      email: "a@b.com",
    });
  });

  it("returns null for an empty array, null, or undefined", () => {
    expect(one([])).toBeNull();
    expect(one(null)).toBeNull();
    expect(one(undefined)).toBeNull();
  });
});
