import { describe, it, expect } from "vitest";
import { safeUrl } from "./safeUrl";

describe("safeUrl", () => {
  it("passes http and https through unchanged", () => {
    expect(safeUrl("http://example.com/a.png")).toBe("http://example.com/a.png");
    expect(safeUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
  });

  it("rejects dangerous schemes (the stored-XSS surface)", () => {
    expect(safeUrl("javascript:alert(document.cookie)")).toBeUndefined();
    expect(safeUrl("data:text/html,<script>x</script>")).toBeUndefined();
    expect(safeUrl("vbscript:msgbox(1)")).toBeUndefined();
    expect(safeUrl("blob:https://example.com/uuid")).toBeUndefined();
  });

  it("rejects empty/nullish/unparseable input", () => {
    expect(safeUrl(null)).toBeUndefined();
    expect(safeUrl(undefined)).toBeUndefined();
    expect(safeUrl("")).toBeUndefined();
    expect(safeUrl("not a url")).toBeUndefined();
  });
});
