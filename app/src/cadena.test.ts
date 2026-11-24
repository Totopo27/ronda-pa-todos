import { afterEach, describe, expect, it, vi } from "vitest";

const DIRECCION = "GCOLRMYZREQF76K5JO4ON62LWC6OY4VJABDNTOOLEFP7GVHP573E2NWH";

describe("cadena: fondos de la cuenta", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dice que no está fondeada cuando Horizon responde 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    const { cuentaFondeada } = await import("./cadena");
    await expect(cuentaFondeada(DIRECCION)).resolves.toBe(false);
  });

  it("dice que sí está fondeada cuando Horizon devuelve la cuenta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const { cuentaFondeada } = await import("./cadena");
    await expect(cuentaFondeada(DIRECCION)).resolves.toBe(true);
  });

  it("no afirma nada si Horizon no responde", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("red caída");
      }),
    );
    const { cuentaFondeada } = await import("./cadena");
    await expect(cuentaFondeada(DIRECCION)).resolves.toBeNull();
  });
});
