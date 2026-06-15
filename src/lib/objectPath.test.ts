import { describe, it, expect } from "vitest";
import { safeExt, randomId } from "./objectPath";

describe("safeExt", () => {
  it("prefers the (bucket-validated) MIME type over the filename", () => {
    expect(safeExt({ name: "totally.exe", type: "image/png" })).toBe("png");
    expect(safeExt({ name: "noext", type: "image/jpeg" })).toBe("jpg");
    expect(safeExt({ name: "x.gif", type: "image/webp" })).toBe("webp");
  });

  it("falls back to the filename extension, lowercased", () => {
    expect(safeExt({ name: "photo.PNG", type: "" })).toBe("png");
    expect(safeExt({ name: "archive.tar.gz", type: "" })).toBe("gz");
  });

  it("never lets raw filename chars into the path (no slashes, length-capped)", () => {
    expect(safeExt({ name: "a.png/../../evil", type: "" })).not.toContain("/");
    expect(safeExt({ name: "x.JPEG2000extra", type: "" })).toBe("jpeg2000");
  });

  it("falls back to png when there's no usable extension", () => {
    expect(safeExt({ name: "nodot", type: "" })).toBe("png");
    expect(safeExt({ name: "x.@@@", type: "" })).toBe("png");
  });
});

describe("randomId", () => {
  it("returns a uuid-shaped string", () => {
    expect(randomId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("is collision-free across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomId()));
    expect(ids.size).toBe(1000);
  });
});
