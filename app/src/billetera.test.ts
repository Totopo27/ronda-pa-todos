import { beforeEach, describe, expect, it, vi } from "vitest";

const kit = vi.hoisted(() => ({
  init: vi.fn(),
  authModal: vi.fn(),
  getAddress: vi.fn(),
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
