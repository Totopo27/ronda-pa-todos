import { beforeEach, describe, expect, it, vi } from "vitest";

const kit = vi.hoisted(() => ({
  init: vi.fn(),
  authModal: vi.fn(),
  getAddress: vi.fn(),
  fetchAddress: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock("@creit.tech/stellar-wallets-kit/sdk", () => ({ StellarWalletsKit: kit }));
vi.mock("@creit.tech/stellar-wallets-kit/modules/varial", () => ({
  VarialModule: class VarialModule {},
}));
vi.mock("@creit.tech/stellar-wallets-kit/types", () => ({
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
}));

const CIERRE_MODAL = { code: -1, message: "The user closed the modal." };
const SIN_RED_WC = {
  code: -3,
  message: 'WalletConnect does not support the "getNetwork" function',
};

describe("billetera: errores de la wallet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("muestra el mensaje de la wallet y no [object Object]", async () => {
    const { conectar } = await import("./billetera");
    kit.authModal.mockRejectedValueOnce(CIERRE_MODAL);
    await expect(conectar()).rejects.toThrow("The user closed the modal.");
  });

  it("no bloquea la acción cuando WalletConnect no reporta su red", async () => {
    const { exigirTestnet } = await import("./billetera");
    kit.getNetwork.mockRejectedValueOnce(SIN_RED_WC);
    await expect(exigirTestnet()).resolves.toBeUndefined();
  });
});

describe("billetera: cambiar de dirección", () => {
  beforeEach(() => vi.clearAllMocks());

  it("vuelve a preguntar la dirección a la wallet en vez de la guardada", async () => {
    const { refrescarDireccion } = await import("./billetera");
    kit.getAddress.mockResolvedValue({ address: "GVIEJA" });
    kit.fetchAddress.mockResolvedValueOnce({ address: "GNUEVA" });
    await expect(refrescarDireccion()).resolves.toBe("GNUEVA");
    expect(kit.fetchAddress).toHaveBeenCalledTimes(1);
    expect(kit.getAddress).not.toHaveBeenCalled();
  });

  it("devuelve null si la wallet no responde sin abrir su ventana", async () => {
    const { refrescarDireccion } = await import("./billetera");
    kit.fetchAddress.mockRejectedValueOnce({ code: -1, message: "No wallet has been connected." });
    await expect(refrescarDireccion()).resolves.toBeNull();
  });
});
