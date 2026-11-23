import {
  getAddress,
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";

export const PASSHRASE_TESTNET = "Test SDF Network ; September 2015";

export type MotivoBilletera = "sin_extension" | "denegado" | "red" | "firma";

export class ErrorBilletera extends Error {
  constructor(
    readonly motivo: MotivoBilletera,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorBilletera";
  }
}

/** Freighter responde con un campo `error` en vez de lanzar; lo normalizamos. */
function fallo(r: { error?: { message?: string } }, motivo: MotivoBilletera, porDefecto: string) {
  return new ErrorBilletera(motivo, r.error?.message || porDefecto);
}

export async function disponible(): Promise<boolean> {
  try {
    const { isConnected: hay } = await isConnected();
    return hay;
  } catch {
    return false;
  }
}

/** Pide permiso y devuelve la dirección. Es el botón "Conectar". */
export async function conectar(): Promise<string> {
  if (!(await disponible())) {
    throw new ErrorBilletera(
      "sin_extension",
      "No encontramos la extensión Freighter en este navegador. Instálala desde freighter.app y recarga la página.",
    );
  }
  const r = await requestAccess();
  if (r.error) throw fallo(r, "denegado", "Freighter no autorizó el acceso.");
  return r.address;
}

/** Dirección ya autorizada en una visita anterior, sin abrir ventana. */
export async function cuentaAutorizada(): Promise<string | null> {
  try {
    const r = await getAddress();
    return r.error ? null : r.address || null;
  } catch {
    return null;
  }
}

/** Red configurada en la extensión. */
export async function redActual(): Promise<{ red: string; passphrase: string }> {
  const r = await getNetworkDetails();
  if (r.error) throw fallo(r, "red", "No pudimos leer la red de Freighter.");
  return { red: r.network, passphrase: r.networkPassphrase };
}

export async function exigirTestnet(): Promise<void> {
  const { passphrase, red } = await redActual();
  if (passphrase !== PASSHRASE_TESTNET) {
    throw new ErrorBilletera(
      "red",
      `Freighter está en "${red}". Cambia la red a TESTNET en la extensión: este contrato vive ahí y no en mainnet.`,
    );
  }
}

/** Firma el XDR y devuelve el sobre firmado. La llave nunca sale de Freighter. */
export async function firmar(xdr: string, direccion: string): Promise<string> {
  const r = await signTransaction(xdr, {
    networkPassphrase: PASSHRASE_TESTNET,
    address: direccion,
  });
  if (r.error) throw fallo(r, "firma", "Freighter no firmó la transacción.");
  return r.signedTxXdr;
}
