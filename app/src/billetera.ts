import {
  getAddress,
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import type ClientWC from "@walletconnect/sign-client";

export const PASSHRASE_TESTNET = "Test SDF Network ; September 2015";

const CLAVE_PROVEEDOR = "ronda:billetera";
const PROJECT_ID_WC = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim() || "";
const WC_CHAIN_TESTNET = "stellar:testnet";
const WC_METODO_FIRMA = "stellar_signXDR";
const SVG_NS = "http://www.w3.org/2000/svg";

type Proveedor = "varial" | "walletconnect";
type SesionWC = ReturnType<ClientWC["session"]["getAll"]>[number];

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

let proveedorActivo: Proveedor | null = null;
let clienteWCPromesa: Promise<ClientWC> | null = null;
let sesionWC: { topic: string; address: string } | null = null;

function mensaje(fallo: unknown): string {
  if (fallo instanceof Error) return fallo.message;
  if (fallo && typeof fallo === "object" && "message" in fallo) {
    return String(fallo.message);
  }
  return String(fallo);
}

function leerProveedorGuardado(): Proveedor | null {
  if (typeof document === "undefined" || typeof localStorage === "undefined") return null;
  try {
    const valor = localStorage.getItem(CLAVE_PROVEEDOR);
    return valor === "varial" || valor === "walletconnect" ? valor : null;
  } catch {
    return null;
  }
}

function guardarProveedor(proveedor: Proveedor): void {
  if (typeof document === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CLAVE_PROVEEDOR, proveedor);
  } catch {
    // El almacenamiento puede estar deshabilitado en modo privado o sandbox.
  }
}

// --- Extensión Varial / Freighter -----------------------------------------

function esWrapperMovil(): boolean {
  if (typeof window === "undefined") return false;
  const stellar = (window as { stellar?: { provider?: string; platform?: string } }).stellar;
  return (
    stellar?.platform === "mobile" &&
    (stellar.provider === "freighter" || stellar.provider === "varial")
  );
}

async function extensionDisponible(): Promise<boolean> {
  if (esWrapperMovil()) return false;
  try {
    const respuesta = await isConnected();
    return !respuesta.error && Boolean(respuesta.isConnected);
  } catch {
    return false;
  }
}

async function conectarVarial(): Promise<string> {
  if (!(await extensionDisponible())) {
    throw new ErrorBilletera(
      "denegado",
      "No encontramos la extensión Varial/Freighter en este navegador. Instálala y recarga la página.",
    );
  }
  try {
    const acceso = await requestAccess();
    if (acceso.error) {
      throw new ErrorBilletera(
        "denegado",
        mensaje(acceso.error) || "La wallet no autorizó el acceso.",
      );
    }
    let direccion = acceso.address;
    if (!direccion) {
      const res = await getAddress();
      if (res.error || !res.address) {
        throw new ErrorBilletera(
          "denegado",
          mensaje(res.error) || "La wallet no entregó una dirección.",
        );
      }
      direccion = res.address;
    }
    proveedorActivo = "varial";
    guardarProveedor("varial");
    return direccion;
  } catch (fallo) {
    if (fallo instanceof ErrorBilletera) throw fallo;
    throw new ErrorBilletera("denegado", mensaje(fallo) || "La wallet no autorizó el acceso.");
  }
}

async function direccionVarial(): Promise<string | null> {
  if (!(await extensionDisponible())) return null;
  try {
    const { address, error } = await getAddress();
    return !error && address ? address : null;
  } catch {
    return null;
  }
}

async function redVarial(): Promise<{ red: string; passphrase: string }> {
  try {
    const { network, networkPassphrase, error } = await getNetwork();
    if (error) {
      throw new ErrorBilletera("red", mensaje(error) || "No pudimos leer la red de la wallet.");
    }
    return { red: network, passphrase: networkPassphrase };
  } catch (fallo) {
    if (fallo instanceof ErrorBilletera) throw fallo;
    throw new ErrorBilletera("red", mensaje(fallo) || "No pudimos leer la red de la wallet.");
  }
}

async function firmarVarial(xdr: string, direccion: string): Promise<string> {
  try {
    const { signedTxXdr, error } = await signTransaction(xdr, {
      networkPassphrase: PASSHRASE_TESTNET,
      address: direccion,
    });
    if (error || !signedTxXdr) {
      throw new ErrorBilletera("firma", mensaje(error) || "La wallet no firmó la transacción.");
    }
    return signedTxXdr;
  } catch (fallo) {
    if (fallo instanceof ErrorBilletera) throw fallo;
    throw new ErrorBilletera("firma", mensaje(fallo) || "La wallet no firmó la transacción.");
  }
}

// --- WalletConnect --------------------------------------------------------

async function obtenerClienteWC(): Promise<ClientWC | null> {
  if (!PROJECT_ID_WC) return null;
  if (!clienteWCPromesa) {
    clienteWCPromesa = (async () => {
      const { SignClient } = await import("@walletconnect/sign-client");
      const url = typeof location !== "undefined" ? location.origin : "";
      const icono =
        typeof location !== "undefined"
          ? new URL(`${import.meta.env.BASE_URL}favicon.svg`, location.href).href
          : "";
      const client = await SignClient.init({
        projectId: PROJECT_ID_WC,
        metadata: {
          name: "RondaPa' Todos",
          description: "Ronda de ahorro circular sobre Stellar testnet",
          url,
          icons: icono ? [icono] : [],
        },
      });
      client.on("session_delete", (evento) => {
        if (sesionWC?.topic === evento.topic) {
          sesionWC = null;
        }
      });
      return client;
    })().catch((fallo) => {
      clienteWCPromesa = null;
      throw fallo;
    });
  }
  return clienteWCPromesa;
}

function extraerDireccionWC(sesion: SesionWC, filtroDireccion?: string): string | null {
  const cuentas = sesion.namespaces?.stellar?.accounts ?? [];
  let respaldo: string | null = null;
  for (const cuenta of cuentas) {
    const partes = cuenta.split(":");
    if (partes.length < 3 || !partes[2]) continue;
    const red = `${partes[0]}:${partes[1]}`;
    const direccion = partes[2];
    if (filtroDireccion && direccion !== filtroDireccion) continue;
    if (red === WC_CHAIN_TESTNET) return direccion;
    if (!respaldo) respaldo = direccion;
  }
  return respaldo;
}

function buscarSesionWC(
  client: ClientWC,
  direccion?: string,
): { topic: string; address: string } | null {
  const sesiones = [...client.session.getAll()].reverse();
  for (const sesion of sesiones) {
    const encontrada = extraerDireccionWC(sesion, direccion);
    if (encontrada) {
      return { topic: sesion.topic, address: encontrada };
    }
  }
  return null;
}

// --- Diálogos nativos -----------------------------------------------------

function crearDialogo(
  titulo: string,
  alCancelar: () => void,
): { dialog: HTMLDialogElement; cerrar: () => void } {
  if (typeof document === "undefined") {
    throw new ErrorBilletera(
      "denegado",
      "No hay interfaz de navegador disponible para mostrar el selector.",
    );
  }
  const dialog = document.createElement("dialog");
  dialog.className = "modal-billetera";

  const encabezado = document.createElement("h2");
  encabezado.textContent = titulo;
  dialog.append(encabezado);

  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    if (dialog.open) dialog.close();
    dialog.remove();
  };

  dialog.addEventListener("cancel", (evento) => {
    evento.preventDefault();
    cerrar();
    alCancelar();
  });

  dialog.addEventListener("click", (evento) => {
    if (evento.target === dialog) {
      cerrar();
      alCancelar();
    }
  });

  document.body.append(dialog);
  dialog.showModal();
  return { dialog, cerrar };
}

function elegirProveedor(): Promise<Proveedor> {
  return new Promise((resolve, reject) => {
    const cancelar = () => reject(new ErrorBilletera("denegado", "Conexión cancelada."));
    const { dialog, cerrar } = crearDialogo("Conectar wallet", cancelar);

    const opciones = document.createElement("div");
    opciones.className = "modal-opciones";

    const btnVarial = document.createElement("button");
    btnVarial.type = "button";
    btnVarial.textContent = "Varial / Freighter (extensión)";
    btnVarial.addEventListener("click", () => {
      cerrar();
      resolve("varial");
    });

    const btnWC = document.createElement("button");
    btnWC.type = "button";
    btnWC.textContent = "WalletConnect (móvil / QR)";
    btnWC.addEventListener("click", () => {
      cerrar();
      resolve("walletconnect");
    });

    opciones.append(btnVarial, btnWC);

    const acciones = document.createElement("div");
    acciones.className = "modal-acciones";
    const btnCancelar = document.createElement("button");
    btnCancelar.type = "button";
    btnCancelar.textContent = "Cancelar";
    btnCancelar.addEventListener("click", () => {
      cerrar();
      cancelar();
    });
    acciones.append(btnCancelar);

    dialog.append(opciones, acciones);
  });
}

async function mostrarModalQR(
  uri: string,
  alCancelar: () => void,
): Promise<{ cerrar: () => void }> {
  const { encode } = await import("uqr");
  const qr = encode(uri, { border: 2 });
  const { dialog, cerrar } = crearDialogo("Escanea con tu wallet", alCancelar);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${qr.size} ${qr.size}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Código QR de WalletConnect");

  const fondo = document.createElementNS(SVG_NS, "rect");
  fondo.setAttribute("width", String(qr.size));
  fondo.setAttribute("height", String(qr.size));
  fondo.setAttribute("fill", "#ffffff");

  const trazos: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.data[y]?.[x]) trazos.push(`M${x},${y}h1v1h-1z`);
    }
  }
  const modulos = document.createElementNS(SVG_NS, "path");
  modulos.setAttribute("fill", "#000000");
  modulos.setAttribute("d", trazos.join(""));
  svg.append(fondo, modulos);

  const marco = document.createElement("div");
  marco.className = "modal-qr";
  marco.append(svg);

  const nota = document.createElement("p");
  nota.className = "pie-panel";
  nota.textContent = "Escanea el código con una wallet Stellar compatible en testnet.";

  const acciones = document.createElement("div");
  acciones.className = "modal-acciones";

  const btnCopiar = document.createElement("button");
  btnCopiar.type = "button";
  btnCopiar.textContent = "Copiar enlace";
  btnCopiar.addEventListener("click", () => {
    void navigator.clipboard?.writeText(uri).then(
      () => {
        btnCopiar.textContent = "Enlace copiado";
      },
      () => {
        btnCopiar.textContent = "No se pudo copiar";
      },
    );
  });

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", () => {
    cerrar();
    alCancelar();
  });

  acciones.append(btnCopiar, btnCancelar);
  dialog.append(marco, nota, acciones);
  return { cerrar };
}

async function conectarWalletConnect(): Promise<string> {
  try {
    const client = await obtenerClienteWC();
    if (!client) {
      throw new ErrorBilletera("denegado", "WalletConnect no está configurado.");
    }
    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        stellar: {
          methods: [WC_METODO_FIRMA],
          chains: [WC_CHAIN_TESTNET],
          events: [],
        },
      },
      optionalNamespaces: {
        stellar: {
          methods: [
            "stellar_signAndSubmitXDR",
            "stellar_signAuthEntry",
            "stellar_signMessage",
          ],
          chains: [WC_CHAIN_TESTNET],
          events: [],
        },
      },
    });

    let modal: { cerrar: () => void } | null = null;
    const sesion = await new Promise<SesionWC>((resolve, reject) => {
      let resuelto = false;
      const cancelar = () => {
        if (resuelto) return;
        resuelto = true;
        reject(new ErrorBilletera("denegado", "Conexión cancelada."));
      };

      if (uri) {
        void mostrarModalQR(uri, cancelar)
          .then((creado) => {
            if (resuelto) creado.cerrar();
            else modal = creado;
          })
          .catch((fallo) => {
            if (!resuelto) {
              resuelto = true;
              reject(fallo);
            }
          });
      }

      approval().then(
        (aprobada) => {
          if (resuelto) return;
          resuelto = true;
          resolve(aprobada);
        },
        (fallo) => {
          if (resuelto) return;
          resuelto = true;
          reject(fallo);
        },
      );
    }).finally(() => {
      modal?.cerrar();
    });

    const direccion = extraerDireccionWC(sesion);
    if (!direccion) {
      throw new ErrorBilletera(
        "denegado",
        "La wallet móvil no devolvió una cuenta de Stellar testnet.",
      );
    }
    sesionWC = { topic: sesion.topic, address: direccion };
    proveedorActivo = "walletconnect";
    guardarProveedor("walletconnect");
    return direccion;
  } catch (fallo) {
    if (fallo instanceof ErrorBilletera) throw fallo;
    throw new ErrorBilletera("denegado", mensaje(fallo) || "La wallet no autorizó el acceso.");
  }
}

async function firmarWalletConnect(xdr: string, direccion: string): Promise<string> {
  try {
    const client = await obtenerClienteWC();
    if (!client) {
      throw new ErrorBilletera("firma", "WalletConnect no está configurado.");
    }
    const activa = buscarSesionWC(client, direccion);
    const topic = activa?.topic ?? (sesionWC?.address === direccion ? sesionWC.topic : null);
    if (!topic) {
      throw new ErrorBilletera(
        "firma",
        "No hay una sesión activa de WalletConnect para esta dirección. Vuelve a conectarla.",
      );
    }
    const res = await client.request<{ signedXDR?: string; signedTxXdr?: string }>({
      topic,
      chainId: WC_CHAIN_TESTNET,
      request: {
        method: WC_METODO_FIRMA,
        params: { xdr },
      },
    });
    const firmado = res?.signedXDR ?? res?.signedTxXdr;
    if (!firmado) {
      throw new ErrorBilletera("firma", "La wallet móvil no devolvió la transacción firmada.");
    }
    return firmado;
  } catch (fallo) {
    if (fallo instanceof ErrorBilletera) throw fallo;
    throw new ErrorBilletera("firma", mensaje(fallo) || "La wallet no firmó la transacción.");
  }
}

// --- API pública ----------------------------------------------------------

/** Abre el selector de wallets y devuelve la dirección autorizada. */
export async function conectar(): Promise<string> {
  if (!PROJECT_ID_WC) {
    return conectarVarial();
  }
  const elegido = await elegirProveedor();
  return elegido === "walletconnect" ? conectarWalletConnect() : conectarVarial();
}

/** Dirección ya autorizada en una visita anterior, sin abrir ventana. */
export async function cuentaAutorizada(): Promise<string | null> {
  if (PROJECT_ID_WC && leerProveedorGuardado() === "walletconnect") {
    try {
      const client = await obtenerClienteWC();
      const sesion = client ? buscarSesionWC(client) : null;
      if (sesion) {
        sesionWC = sesion;
        proveedorActivo = "walletconnect";
        return sesion.address;
      }
    } catch {
      // Si falla WalletConnect al restaurar, probamos con la extensión local.
    }
  }
  const direccion = await direccionVarial();
  if (direccion) {
    proveedorActivo = "varial";
    guardarProveedor("varial");
  }
  return direccion;
}

/**
 * Dirección que la wallet tiene activa ahora mismo.
 *
 * En la extensión consulta de nuevo la cuenta activa; en WalletConnect devuelve
 * `null` para abrir el selector y permitir reconectar otra cuenta.
 */
export async function refrescarDireccion(): Promise<string | null> {
  if (proveedorActivo === "walletconnect") return null;
  return direccionVarial();
}

/** Red configurada en la wallet elegida. */
export async function redActual(): Promise<{ red: string; passphrase: string }> {
  // WalletConnect firma contra stellar:testnet por sesión y no expone getNetwork().
  if (proveedorActivo === "walletconnect") {
    return { red: "TESTNET", passphrase: PASSHRASE_TESTNET };
  }
  return redVarial();
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
  if (proveedorActivo === "walletconnect") {
    return firmarWalletConnect(xdr, direccion);
  }
  return firmarVarial(xdr, direccion);
}
