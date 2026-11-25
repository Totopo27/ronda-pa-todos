import {
  Address,
  Asset,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  contract,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import {
  normalizarResumen,
  type Accion,
  type ParametrosNuevaRonda,
  type Resumen,
} from "./logica";

export const RPC_TESTNET = "https://soroban-testnet.stellar.org";
export const PASSHRASE_TESTNET = "Test SDF Network ; September 2015";
export const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
export const WASM_HASH_RONDA =
  "d5b58239363a6e99819f93053975ec262cbccf11f2b39c39b4289ef8bdeb6523";

export type Firmador = (xdr: string) => Promise<string>;

/**
 * ¿La cuenta ya existe en testnet? Friendbot solo fondea cuentas que no llegan
 * al saldo inicial, así que el enlace solo tiene sentido cuando no existe.
 * `null` = no se pudo averiguar (red o Horizon caídos): mejor no afirmar nada.
 */
export async function cuentaFondeada(direccion: string): Promise<boolean | null> {
  try {
    const respuesta = await fetch(
      `${HORIZON_TESTNET}/accounts/${encodeURIComponent(direccion)}`,
    );
    if (respuesta.status === 404) return false;
    return respuesta.ok ? true : null;
  } catch {
    return null;
  }
}

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
  14: { message: "AportesPorTurnoInvalido" },
  15: { message: "EsperaInvalida" },
  16: { message: "AporteAunNoAbierto" },
};

/** Las funciones del contrato, tal como las genera el SDK en runtime. */
interface ContratoTanda {
  resumen(args: { miembro?: string }): Promise<contract.AssembledTransaction<unknown>>;
  ha_pagado(args: { miembro: string }): Promise<contract.AssembledTransaction<boolean>>;
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
}const tokens = new Map<string, Promise<Token>>();

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

/** Devuelve qué miembros ya aportaron la ronda en curso usando el cliente cacheado. */
export async function leerPagadosRonda(
  contratoId: string,
  miembros: string[],
): Promise<Set<string>> {
  if (miembros.length === 0) return new Set();
  const c = await cliente<ContratoTanda>(contratoId);
  const resultados = await Promise.all(
    miembros.map(async (miembro) => {
      const tx = await c.ha_pagado({ miembro });
      return [miembro, tx.result === true] as const;
    }),
  );
  return new Set(resultados.filter(([, pagado]) => pagado).map(([miembro]) => miembro));
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

export interface RondaCreada {
  contratoId: string;
  hash: string;
}

function hexABytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Despliega una ronda nueva y vacía en testnet usando el Wasm ya publicado. */
export async function crearRonda(
  datos: ParametrosNuevaRonda,
  yo: string,
  firmar: Firmador,
): Promise<RondaCreada> {
  const servidor = new rpc.Server(RPC_TESTNET);
  let cuenta;
  try {
    cuenta = await servidor.getAccount(yo);
  } catch (fallo) {
    const texto = String((fallo as Error)?.message ?? fallo);
    if (/404|not found/i.test(texto)) {
      throw new Error(
        "Tu cuenta todavía no existe en testnet. Fondéala con Friendbot arriba y vuelve a intentar.",
      );
    }
    throw fallo;
  }

  const tokenSac = Asset.native().contractId(PASSHRASE_TESTNET);
  const tx = new TransactionBuilder(cuenta, {
    fee: BASE_FEE,
    networkPassphrase: PASSHRASE_TESTNET,
  })
    .addOperation(
      Operation.createCustomContract({
        address: new Address(yo),
        wasmHash: hexABytes(WASM_HASH_RONDA),
        constructorArgs: [
          new Address(tokenSac).toScVal(),
          nativeToScVal(datos.aporte, { type: "i128" }),
          nativeToScVal(datos.duracion, { type: "u64" }),
          nativeToScVal(datos.cupo, { type: "u32" }),
          nativeToScVal(datos.aportesPorTurno, { type: "u32" }),
          nativeToScVal(datos.espera, { type: "u64" }),
        ],
      }),
    )
    .setTimeout(60)
    .build();

  const sim = await servidor.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error);
  }
  if (rpc.Api.isSimulationRestore(sim)) {
    throw new Error("El código del contrato en testnet expiró y necesita restaurarse.");
  }
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error("No se pudo simular la creación de la ronda.");
  }

  const idSimulado = Address.fromScVal(sim.result.retval).toString();
  const preparada = rpc.assembleTransaction(tx, sim).build();
  const xdrFirmado = await firmar(preparada.toXDR());
  const firmada = TransactionBuilder.fromXDR(xdrFirmado, PASSHRASE_TESTNET);

  const envio = await servidor.sendTransaction(firmada);
  if (envio.status === "ERROR") {
    throw new Error("La red rechazó la transacción al crear la ronda.");
  }

  const final = await servidor.pollTransaction(envio.hash, { attempts: 30 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error("No se pudo confirmar la creación de la ronda en testnet.");
  }

  const contratoId = final.returnValue
    ? Address.fromScVal(final.returnValue).toString()
    : idSimulado;

  return { contratoId, hash: envio.hash };
}

export function enlaceContrato(contratoId: string): string {
  return `https://stellar.expert/explorer/testnet/contract/${contratoId}`;
}

export function enlaceTransaccion(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
