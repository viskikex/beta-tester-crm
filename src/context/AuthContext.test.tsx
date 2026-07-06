import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";

const { mockSession, mockProfile } = vi.hoisted(() => ({
  mockSession: {
    user: { id: "user-123", email: "test@example.com" },
    access_token: "token",
    refresh_token: "token",
    expires_at: 1234567890,
  },
  mockProfile: {
    id: "user-123",
    email: "test@example.com",
    is_admin: true,
    created_at: "2024-01-01",
  },
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: mockSession },
        error: null,
      }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: mockProfile,
        error: null,
      }),
    }),
  },
}));

function Consumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{auth.loading ? "loading" : "ready"}</span>
      <span data-testid="email">{auth.user?.email ?? "none"}</span>
      <span data-testid="admin">{auth.isAdmin ? "admin" : "not-admin"}</span>
    </div>
  );
}

describe("AuthProvider", () => {
  it("starts loading and then resolves to the mocked session", async () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("loading").textContent).toBe("loading");
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("ready")
    );
    await waitFor(() =>
      expect(screen.getByTestId("email").textContent).toBe("test@example.com")
    );
    await waitFor(() =>
      expect(screen.getByTestId("admin").textContent).toBe("admin")
    );
  });
});
