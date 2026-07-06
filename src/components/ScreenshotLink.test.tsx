import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScreenshotLink from "./ScreenshotLink";

const { createSignedUrl } = vi.hoisted(() => ({ createSignedUrl: vi.fn() }));

vi.mock("../lib/supabase", () => ({
  supabase: {
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl,
      }),
    },
  },
}));

describe("ScreenshotLink", () => {
  it("renders nothing when no screenshot path or legacy URL is provided", () => {
    const { container } = render(
      <ScreenshotLink path={null} legacyUrl={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a legacy URL as an external link", () => {
    render(
      <ScreenshotLink
        path={null}
        legacyUrl="https://example.com/shot.png"
      />
    );
    const link = screen.getByRole("link", { name: "screenshot" });
    expect(link).toHaveAttribute("href", "https://example.com/shot.png");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("signs a storage path on click and opens the signed URL", async () => {
    const signedUrl = "https://signed.example.com/shot.png";
    createSignedUrl.mockResolvedValue({
      data: { signedUrl, path: "uid/shot.png", token: "" },
      error: null,
    });
    const tab = { location: { href: "" } };
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(tab as unknown as Window);

    render(<ScreenshotLink path="uid/shot.png" legacyUrl={null} />);
    await userEvent.click(screen.getByRole("button", { name: "screenshot" }));

    expect(createSignedUrl).toHaveBeenCalledWith("uid/shot.png", 300);
    expect(tab.location.href).toBe(signedUrl);
    openSpy.mockRestore();
  });
});
