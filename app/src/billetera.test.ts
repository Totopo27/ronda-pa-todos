import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const freighter = vi.hoisted(() => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
}));

const wcClient = vi.hoisted(() => ({
  connect: vi.fn(),
  request: vi.fn(),
  on: vi.fn(),
  session: {
    getAll: vi.fn(),
  },
}));

const wcInit = vi.hoisted(() => vi.fn(async () => wcClient));

vi.mock("@stellar/freighter-api", () => freighter);
vi.mock("@walletconnect/sign-client", () => ({
  SignClient: { init: wcInit },
}));
vi.mock("uqr", () => ({
  encode: vi.fn(() => ({
    size: 2,
    data: [
      [true, false],
      [false, true],
    ],
  })),
}));

interface FakeNode {
  tag: string;
  className: string;
  textContent: string;
  type: string;
  open: boolean;
  children: FakeNode[];
  listeners: Record<string, Array<(evento: unknown) => void>>;
  setAttribute: (k: string, v: string) => void;
  append: (...nodes: FakeNode[]) => void;
  addEventListener: (ev: string, fn: (evento: unknown) => void) => void;
  showModal: () => void;
  close: () => void;
  remove: () => void;
}

function crearDomMinimo() {
  const dialogs: FakeNode[] = [];
  const hacerNodo = (tag: string): FakeNode => {
    const nodo: FakeNode = {
      tag,
      className: "",
      textContent: "",
      type: "",
      open: false,
      children: [],
      listeners: {},
      setAttribute: () => {},
      append(...nodes: FakeNode[]) {
        this.children.push(...nodes);
      },
      addEventListener(ev: string, fn: (evento: unknown) => void) {
        (this.listeners[ev] ??= []).push(fn);
      },
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
      remove() {},
    };
    return nodo;
  };

  const store = new Map<string, string>();
  const doc = {
    body: {
      append(...nodes: FakeNode[]) {
        dialogs.push(...nodes);
      },
    },
    createElement: (tag: string) => hacerNodo(tag),
    createElementNS: (_ns: string, tag: string) => hacerNodo(tag),
  };

  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  };

  const buscarBoton = (texto: string): FakeNode => {
    const recorrer = (n: FakeNode): FakeNode | undefined => {
      if (n.tag === "button" && n.textContent.includes(texto)) return n;
      for (const h of n.children) {
        const hallado = recorrer(h);
        if (hallado) return hallado;
      }
      return undefined;
    };
    for (let i = dialogs.length - 1; i >= 0; i--) {
      const hallado = recorrer(dialogs[i]);
      if (hallado) return hallado;
    }
    throw new Error(`Botón no encontrado: ${texto}`);
  };

  const pulsar = (texto: string) => {
    const boton = buscarBoton(texto);
    for (const fn of boton.listeners.click ?? []) fn({ target: boton });
  };

  vi.stubGlobal("document", doc);
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("location", { origin: "https://tanda.test", href: "https://tanda.test/" });

  return { dialogs, store, pulsar };
}

describe("billetera: Varial / Freighter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("VITE_WALLETCONNECT_PROJECT_ID", "");
    freighter.isConnected.mockResolvedValue({ isConnected: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("falla si la extensión no está disponible", async () => {
    freighter.isConnected.mockResolvedValueOnce({ isConnected: false });
    const { conectar } = await import("./billetera");
    await expect(conectar()).rejects.toThrow(/No encontramos la extensión/);
  });

  it("muestra el mensaje de la wallet y no [object Object] al rechazar", async () => {
    freighter.requestAccess.mockResolvedValueOnce({
      address: "",
      error: { code: -1, message: "User declined access" },
    });
    const { conectar } = await import("./billetera");
    await expect(conectar()).rejects.toThrow("User declined access");
  });

  it("conecta con la extensión cuando no hay Project ID de WalletConnect", async () => {
    freighter.requestAccess.mockResolvedValueOnce({ address: "GALICE123" });
    const { conectar } = await import("./billetera");
    await expect(conectar()).resolves.toBe("GALICE123");
    expect(wcInit).not.toHaveBeenCalled();
  });

  it("cuentaAutorizada lee la dirección sin abrir requestAccess", async () => {
    freighter.getAddress.mockResolvedValueOnce({ address: "GALICE123" });
    const { cuentaAutorizada } = await import("./billetera");
    await expect(cuentaAutorizada()).resolves.toBe("GALICE123");
    expect(freighter.requestAccess).not.toHaveBeenCalled();
  });

  it("refrescarDireccion vuelve a consultar la dirección activa o devuelve null", async () => {
    freighter.getAddress
      .mockResolvedValueOnce({ address: "GNUEVA" })
      .mockResolvedValueOnce({ address: "", error: { code: -1, message: "Locked" } });
    const { refrescarDireccion } = await import("./billetera");
    await expect(refrescarDireccion()).resolves.toBe("GNUEVA");
    await expect(refrescarDireccion()).resolves.toBeNull();
  });

  it("exigirTestnet acepta TESTNET y rechaza mainnet", async () => {
    const { exigirTestnet, PASSHRASE_TESTNET } = await import("./billetera");
    freighter.getNetwork.mockResolvedValueOnce({
      network: "TESTNET",
      networkPassphrase: PASSHRASE_TESTNET,
    });
    await expect(exigirTestnet()).resolves.toBeUndefined();

    freighter.getNetwork.mockResolvedValueOnce({
      network: "PUBLIC",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    await expect(exigirTestnet()).rejects.toThrow(/TESTNET/);
  });

  it("firmar envía passphrase de testnet y mapea errores de firma", async () => {
    const { firmar, PASSHRASE_TESTNET } = await import("./billetera");
    freighter.signTransaction.mockResolvedValueOnce({
      signedTxXdr: "AAAA_SIGNED",
      signerAddress: "GALICE123",
    });
    await expect(firmar("AAAA_TX", "GALICE123")).resolves.toBe("AAAA_SIGNED");
    expect(freighter.signTransaction).toHaveBeenCalledWith("AAAA_TX", {
      networkPassphrase: PASSHRASE_TESTNET,
      address: "GALICE123",
    });

    freighter.signTransaction.mockResolvedValueOnce({
      signedTxXdr: "",
      signerAddress: "",
      error: { code: -4, message: "User declined signature" },
    });
    await expect(firmar("AAAA_TX", "GALICE123")).rejects.toThrow("User declined signature");
  });
});

describe("billetera: WalletConnect", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("VITE_WALLETCONNECT_PROJECT_ID", "wc-test-project");
    wcClient.session.getAll.mockReturnValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("conecta por QR, omite getNetwork, firma por stellar_signXDR y fuerza reconexión al cambiar", async () => {
    const { pulsar } = crearDomMinimo();
    const sesion = {
      topic: "topic-1",
      namespaces: {
        stellar: {
          accounts: ["stellar:testnet:GWCUSER123"],
          methods: ["stellar_signXDR"],
          events: [],
        },
      },
    };
    wcClient.connect.mockResolvedValueOnce({
      uri: "wc:abc@2?relay-protocol=irn",
      approval: async () => sesion,
    });
    wcClient.session.getAll.mockReturnValue([sesion]);
    wcClient.request.mockResolvedValueOnce({ signedXDR: "AAAA_WC_SIGNED" });

    const { conectar, exigirTestnet, firmar, refrescarDireccion } = await import("./billetera");

    const promesa = conectar();
    await new Promise((r) => setTimeout(r, 0));
    pulsar("WalletConnect");

    await expect(promesa).resolves.toBe("GWCUSER123");
    await expect(exigirTestnet()).resolves.toBeUndefined();
    expect(freighter.getNetwork).not.toHaveBeenCalled();

    await expect(firmar("AAAA_TX", "GWCUSER123")).resolves.toBe("AAAA_WC_SIGNED");
    expect(wcClient.request).toHaveBeenCalledWith({
      topic: "topic-1",
      chainId: "stellar:testnet",
      request: {
        method: "stellar_signXDR",
        params: { xdr: "AAAA_TX" },
      },
    });

    await expect(refrescarDireccion()).resolves.toBeNull();
  });

  it("restaura la sesión guardada en cuentaAutorizada sin pedir QR", async () => {
    const { store } = crearDomMinimo();
    store.set("ronda:billetera", "walletconnect");
    wcClient.session.getAll.mockReturnValue([
      {
        topic: "topic-saved",
        namespaces: {
          stellar: {
            accounts: ["stellar:testnet:GSAVEDWC"],
            methods: ["stellar_signXDR"],
            events: [],
          },
        },
      },
    ]);

    const { cuentaAutorizada, exigirTestnet } = await import("./billetera");
    await expect(cuentaAutorizada()).resolves.toBe("GSAVEDWC");
    await expect(exigirTestnet()).resolves.toBeUndefined();
    expect(freighter.getAddress).not.toHaveBeenCalled();
  });

  it("cancela conectar inmediatamente si el usuario cierra el modal QR", async () => {
    const { pulsar } = crearDomMinimo();
    wcClient.connect.mockResolvedValueOnce({
      uri: "wc:pending@2?relay-protocol=irn",
      approval: () => new Promise(() => {}),
    });

    const { conectar } = await import("./billetera");
    const promesa = conectar();
    await new Promise((r) => setTimeout(r, 0));
    pulsar("WalletConnect");
    await new Promise((r) => setTimeout(r, 10));
    pulsar("Cancelar");

    await expect(promesa).rejects.toThrow("Conexión cancelada.");
  });
});
