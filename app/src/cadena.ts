import { contract } from "@stellar/stellar-sdk";
import { normalizarResumen, type Accion, type Resumen } from "./logica";

export const RPC_TESTNET = "https://soroban-testnet.stellar.org";
export const PASSHRASE_TESTNET = "Test SDF Network ; September 2015";

export type Firmador = (xdr: string) => Promise<string>;

/** Nombres de los errores del contrato, para que el SDK los pueda resolver. */
const ERRORES: Record<number, { message: string }> = {
  1: { message: "CupoInvalido" },
  2: { message: "AporteInvalido" },
  3: { message: "DuracionInvalida" },
  4: { message: "NoEsMiembro" },
  5: { message: "YaInscrito" },
  6: { message: "InscripcionCerrada" },
  7: { message: "NoActiva" },
  8: { message: "YaPago" },
  9: { message: "TandaTerminada" },
  10: { message: "PlazoVigente" },
  11: { message: "NoHaPagado" },
  12: { message: "YaDevuelto" },
  13: { message: "NoConfigurado" },
};

/** Las funciones del contrato, tal como las genera el SDK en runtime. */
interface ContratoTanda {
  resumen(args: { miembro?: string }): Promise<contract.AssembledTransaction<unknown>>;
  unirse(args: { miembro: string }): Promise<contract.AssembledTransaction<unknown>>;
  aportar(args: { miembro: string }): Promise<contract.AssembledTransaction<unknown>>;
  reclamar(args: { miembro: string }): Promise<contract.AssembledTransaction<unknown>>;
}

/** Lo mínimo del token (un SAC de XLM expone estas dos). */
interface ContratoToken {
  decimals(): Promise<contract.AssembledTransaction<number>>;
  symbol(): Promise<contract.AssembledTransaction<string>>;
}

type Cliente<T> = contract.Client & T;

const cache = new Map<string, Promise<contract.Client & object>>();

/**
 * El `Client` del SDK baja el spec del Wasm on-chain y arma los métodos solo.
 * Se cachea porque cada instancia implica una descarga del spec.
 */
function cliente<T extends object>(
  contratoId: string,
  publicKey?: string,
  firmar?: Firmador,
): Promise<Cliente<T>> {
  const clave = `${contratoId}:${publicKey ?? "-"}:${firmar ? "firma" : "lectura"}`;
  let pendiente = cache.get(clave);
  if (!pendiente) {
    const creada = contract.Client.from<T>({
      contractId: contratoId,
      rpcUrl: RPC_TESTNET,
      networkPassphrase: PASSHRASE_TESTNET,
      publicKey,
      errorTypes: ERRORES,
      signTransaction: firmar
        ? async (xdr: string) => ({
            signedTxXdr: await firmar(xdr),
            signerAddress: publicKey,
          })
        : undefined,
    });
    cache.set(clave, creada);
    creada.catch(() => cache.delete(clave));
    pendiente = creada;
  }
  return pendiente as Promise<Cliente<T>>;
}

export interface Token {
  decimales: number;
  simbolo: string;
}

const tokens = new Map<string, Promise<Token>>();

/** Los decimales y el símbolo se leen del propio token, no se asumen. */
export function leerToken(tokenId: string): Promise<Token> {
  let pendiente = tokens.get(tokenId);
  if (!pendiente) {
    const creada = (async () => {
      const c = await cliente<ContratoToken>(tokenId);
      const [decimales, simbolo] = await Promise.all([c.decimals(), c.symbol()]);
      const bruto = String(simbolo.result ?? "");
      return {
        decimales: Number(decimales.result ?? 7),
        simbolo: bruto === "native" || bruto === "" ? "XLM" : bruto,
      };
    })();
    tokens.set(tokenId, creada);
    creada.catch(() => tokens.delete(tokenId));
    pendiente = creada;
  }
  return pendiente;
}

/**
 * Una sola lectura para todo el panel. Siempre con el objeto de argumentos:
 * `resumen()` sin argumento revienta en el host con `UnexpectedSize`.
 */
export async function leerResumen(contratoId: string, yo: string | null): Promise<Resumen> {
  const c = await cliente<ContratoTanda>(contratoId);
  const tx = await c.resumen({ miembro: yo ?? undefined });
  return normalizarResumen(tx.result);
}

export interface Envio {
  hash: string | null;
  resultado: unknown;
}

export async function ejecutar(
  accion: Accion,
  contratoId: string,
  yo: string,
  firmar: Firmador,
): Promise<Envio> {
  const c = await cliente<ContratoTanda>(contratoId, yo, firmar);
  const tx =
    accion === "unirse"
      ? await c.unirse({ miembro: yo })
      : accion === "aportar"
        ? await c.aportar({ miembro: yo })
        : await c.reclamar({ miembro: yo });

  const enviada = await tx.signAndSend();
  return {
    hash: enviada.sendTransactionResponse?.hash ?? null,
    resultado: enviada.result,
  };
}

export function enlaceContrato(contratoId: string): string {
  return `https://stellar.expert/explorer/testnet/contract/${contratoId}`;
}

export function enlaceTransaccion(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
