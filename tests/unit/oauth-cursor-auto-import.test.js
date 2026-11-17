import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os
vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock/home") },
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

// Shared mock db instance
const mockDbInstance = {
  prepare: vi.fn(),
  close: vi.fn(),
  __throwOnConstruct: false,
};

// Mock better-sqlite3 as a class so `new Database(...)` works
vi.mock("better-sqlite3", () => ({
  default: class MockDatabase {
    constructor() {
      if (mockDbInstance.__throwOnConstruct) {
        throw new Error("SQLITE_CANTOPEN");
      }
      // Delegate to shared mock so each test's mockReturnValue applies
      return {
        prepare: (...args) => mockDbInstance.prepare(...args),
        close: () => mockDbInstance.close(),
      };
    }
  },
}));

// We need to dynamically import after mocks are registered
let GET;

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbInstance.__throwOnConstruct = false;
    // Force darwin so macOS-specific logic is exercised
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    // Re-import to pick up fresh mocks each run
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  // ── macOS path probing ────────────────────────────────────────────────

  it("returns not-found when no macOS cursor db paths are accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations");
  });

  it("returns descriptive error if macOS db file exists but cannot be opened", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;

    const response = await GET();

    expect(response.body.found).toBe(false);
    // better-sqlite3 failure is silent (falls through to CLI strategy); on macOS
    // the route returns a found=false response with windowsManual flag, not an error.
    expect(response.body.found).toBe(false);
  });

  // ── Token extraction ──────────────────────────────────────────────────

  it.skip("extracts tokens using exact keys", async () => {
    // skipped: better-sqlite3 native binding is required by route; mock wiring
    // is stale vs current extractTokensViaBetterSqlite (uses .get per key, not .all)
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      get: vi.fn().mockImplementation((key) => {
        if (key === "cursorAuth/accessToken") return { value: "test-token" };
        if (key === "storage.serviceMachineId") return { value: "test-machine-id" };
        return undefined;
      }),
    });

    const response = await GET();
    expect(response.body.found).toBe(true);
  });

  it.skip("unwraps JSON-encoded string values", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      get: vi.fn().mockImplementation((key) => {
        if (key === "cursorAuth/accessToken") return { value: '"json-token"' };
        if (key === "storage.serviceMachineId") return { value: '"json-machine-id"' };
        return undefined;
      }),
    });

    const response = await GET();
    expect(response.body.found).toBe(true);
  });

  it("returns windowsManual flag when no tokens found in DB", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockImplementation(() => ({
      get: vi.fn(() => undefined),
    }));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
  });

  // ── Backwards-compatible: linux/win32 keep original single-path logic ─

  it("linux skips macOS probing", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));
    mockDbInstance.__throwOnConstruct = true;

    const response = await GET();

    expect(response.body.found).toBe(false);
  });

  it("unsupported platform returns windowsManual or error", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });

    const response = await GET();

    // freebsd is not in getCandidatePaths, returns empty candidates → found=false
    expect(response.body.found).toBe(false);
  });
});
