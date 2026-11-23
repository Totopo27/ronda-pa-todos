import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { VarialModule } from "@creit.tech/stellar-wallets-kit/modules/varial";
import { Networks } from "@creit.tech/stellar-wallets-kit/types";

export const PASSHRASE_TESTNET = "Test SDF Network ; September 2015";

export type MotivoBilletera = "denegado" | "red" | "firma";

export class ErrorBilletera extends Error {
  constructor(
    readonly motivo: MotivoBilletera,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorBilletera";
  }
}

function mensaje(fallo: unknown): string {
  if (fallo instanceof Error) return fallo.message;
  if (fallo && typeof fallo === "object" && "message" in fallo) {
    return String(fallo.message);
  }
  return String(fallo);
}

function walletSinConsultaDeRed(fallo: unknown): boolean {
  return (
    fallo !== null &&
    typeof fallo === "object" &&
    "code" in fallo &&
    fallo.code === -3 &&
    "message" in fallo &&
    /does not support.*getNetwork/i.test(String(fallo.message))
  );
}

const projectIdWalletConnect = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();

StellarWalletsKit.init({ modules: [new VarialModule()], network: Networks.TESTNET });

async function activarWalletConnect(): Promise<void> {
  const projectId = projectIdWalletConnect;
  if (!projectId) return;

  const { WalletConnectModule, WalletConnectTargetChain } = await import(
    "@creit.tech/stellar-wallets-kit/modules/wallet-connect"
  );
  StellarWalletsKit.init({
    network: Networks.TESTNET,
    modules: [
      new VarialModule(),
      new WalletConnectModule({
        projectId,
        allowedChains: [WalletConnectTargetChain.TESTNET],
        metadata: {
          name: "RondaPa' Todos",
          description: "Tanda de ahorro circular sobre Stellar testnet",
          url: location.origin,
          icons: [new URL(`${import.meta.env.BASE_URL}favicon.svg`, location.href).href],
        },
      }),
    ],
  });
}

const billeteraLista = activarWalletConnect();

/** Abre el selector de wallets y devuelve la dirección autorizada. */
export async function conectar(): Promise<string> {
  try {
    await billeteraLista;
    const { address } = await StellarWalletsKit.authModal();
    return address;
  } catch (fallo) {
    throw new ErrorBilletera("denegado", mensaje(fallo) || "La wallet no autorizó el acceso.");
  }
}

/** Dirección ya autorizada en una visita anterior, sin abrir ventana. */
export async function cuentaAutorizada(): Promise<string | null> {
  try {
    await billeteraLista;
    const { address } = await StellarWalletsKit.getAddress();
    return address || null;
  } catch {
    return null;
  }
}

/** Red configurada en la wallet elegida. */
export async function redActual(): Promise<{ red: string; passphrase: string }> {
  try {
    await billeteraLista;
    const { network, networkPassphrase } = await StellarWalletsKit.getNetwork();
    return { red: network, passphrase: networkPassphrase };
  } catch (fallo) {
    // WalletConnect firma contra la red fijada al inicializar el kit, pero su
    // módulo no implementa getNetwork(). Ese límite no debe bloquear la firma.
    if (walletSinConsultaDeRed(fallo)) {
      return { red: "TESTNET", passphrase: PASSHRASE_TESTNET };
    }
    throw new ErrorBilletera("red", mensaje(fallo) || "No pudimos leer la red de la wallet.");
  }
}

export async function exigirTestnet(): Promise<void> {
  const { passphrase, red } = await redActual();
  if (passphrase !== PASSHRASE_TESTNET) {
    throw new ErrorBilletera(
      "red",
      `La wallet está en "${red}". Cámbiala a TESTNET: este contrato vive ahí y no en mainnet.`,
    );
  }
}

/** Firma el XDR y devuelve el sobre firmado. La llave nunca sale de la wallet. */
export async function firmar(xdr: string, direccion: string): Promise<string> {
  try {
    await billeteraLista;
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase: PASSHRASE_TESTNET,
      address: direccion,
    });
    return signedTxXdr;
  } catch (fallo) {
    throw new ErrorBilletera("firma", mensaje(fallo) || "La wallet no firmó la transacción.");
  }
}
