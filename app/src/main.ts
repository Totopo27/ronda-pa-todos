import {
  acortarDireccion,
  describirError,
  formatearDuracion,
  formatearImporte,
  segundosRestantes,
  sugerirAccion,
  type Accion,
  type Resumen,
} from "./logica";
import {
  ejecutar,
  enlaceContrato,
  enlaceTransaccion,
  leerResumen,
  leerToken,
  type Token,
} from "./cadena";
import { ErrorBilletera, conectar, cuentaAutorizada, exigirTestnet, firmar } from "./billetera";

/** Cuenta atrás del refresco y de la cuenta regresiva. */
const REFRESCO_MS = 5_000;
const TICTAC_MS = 1_000;

const BOTON: Record<Accion, string> = {
  unirse: "Firmar mi inscripción",
  aportar: "Aportar la cuota",
  reclamar: "Recuperar mi aporte",
};

const MOTIVO_ESTADO: Record<string, string> = {
  Inscripcion: "Inscripción abierta",
  Activa: "En marcha",
  Terminada: "Terminada",
  Abortada: "Abortada",
};

interface Estado {
  contrato: string;
  yo: string | null;
  resumen: Resumen | null;
  token: Token | null;
  errorCarga: string | null;
  errorAccion: string | null;
  avisoRed: string | null;
  ultimaTx: string | null;
  ocupado: boolean;
}

const ui: Estado = {
  contrato: "",
  yo: null,
  resumen: null,
  token: null,
  errorCarga: null,
  errorAccion: null,
  avisoRed: null,
  ultimaTx: null,
  ocupado: false,
};

let leyendo = false;

function ahora(): number {
  return Math.floor(Date.now() / 1000);
}

/** Todo lo que viene de la red se escapa antes de tocar innerHTML. */
function esc(valor: unknown): string {
  return String(valor).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function idValido(id: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(id);
}

function mensajeDe(fallo: unknown): string {
  if (fallo instanceof ErrorBilletera) return fallo.message;
  return describirError(String((fallo as Error)?.message ?? fallo));
}

// --- Lectura ------------------------------------------------------------

async function refrescar(): Promise<void> {
  if (!ui.contrato || leyendo) return;
  leyendo = true;
  try {
    const resumen = await leerResumen(ui.contrato, ui.yo);
    ui.resumen = resumen;
    ui.errorCarga = null;
    ui.token = resumen.token ? await leerToken(resumen.token).catch(() => null) : null;
  } catch (fallo) {
    ui.errorCarga = mensajeDe(fallo);
  } finally {
    leyendo = false;
    pintar();
  }
}

// --- Billetera ----------------------------------------------------------

async function comprobarRed(): Promise<void> {
  try {
    await exigirTestnet();
    ui.avisoRed = null;
  } catch (fallo) {
    ui.avisoRed = mensajeDe(fallo);
  }
}

async function conectarBilletera(): Promise<void> {
  ui.errorAccion = null;
  try {
    ui.yo = await conectar();
    await comprobarRed();
  } catch (fallo) {
    ui.errorAccion = mensajeDe(fallo);
  }
  pintar();
  await refrescar();
}

async function actuar(accion: Accion): Promise<void> {
  const cuenta = ui.yo;
  if (!cuenta || !ui.contrato || ui.ocupado) return;

  ui.ocupado = true;
  ui.errorAccion = null;
  ui.ultimaTx = null;
  pintar();

  try {
    await exigirTestnet();
    ui.avisoRed = null;
    const envio = await ejecutar(accion, ui.contrato, cuenta, (xdr) => firmar(xdr, cuenta));
    ui.ultimaTx = envio.hash;
  } catch (fallo) {
    ui.errorAccion = mensajeDe(fallo);
    if (fallo instanceof ErrorBilletera && fallo.motivo === "red") ui.avisoRed = fallo.message;
  } finally {
    ui.ocupado = false;
    await refrescar();
  }
}

// --- Pintado ------------------------------------------------------------

function textoCuota(r: Resumen): string {
  if (!ui.token) return `${formatearImporte(r.aporte, 0)} unidades del token`;
  return `${formatearImporte(r.aporte, ui.token.decimales)} ${ui.token.simbolo}`;
}

function textoCuenta(r: Resumen): string {
  if (r.estado === "Inscripcion") {
    return "La cuenta regresiva empieza cuando se llena el cupo.";
  }
  if (r.estado === "Terminada") {
    return "La tanda terminó: todos cobraron su pozo exactamente una vez.";
  }
  if (r.estado === "Abortada") {
    return "La tanda se abortó. Quien aportó su cuota de esta ronda puede recuperarla.";
  }
  const ronda = Math.min(r.ronda + 1, r.cupo);
  const restante = segundosRestantes(r, ahora());
  if (restante > 0) {
    return `Quedan ${formatearDuracion(restante)} para que cierre la ronda ${ronda} de ${r.cupo}.`;
  }
  return `El plazo de la ronda ${ronda} ya venció. Quien aportó puede recuperar su dinero; quien no aportó ya no cobrará su pozo.`;
}

function panelTanda(r: Resumen): string {
  const ronda =
    r.estado === "Inscripcion"
      ? "—"
      : `${Math.min(r.ronda + 1, r.cupo)} de ${r.cupo}`;

  return `
    <section class="panel">
      <div class="panel-cabecera">
        <h2>La tanda</h2>
        <span class="pill ${esc(r.estado.toLowerCase())}">${esc(MOTIVO_ESTADO[r.estado] ?? r.estado)}</span>
      </div>
      <dl class="datos">
        <div><dt>Cuota</dt><dd>${esc(textoCuota(r))}</dd></div>
        <div><dt>Plazo por ronda</dt><dd>${esc(formatearDuracion(Number(r.duracion)))}</dd></div>
        <div><dt>Ronda</dt><dd>${esc(ronda)}</dd></div>
        <div><dt>Lugares</dt><dd>${r.inscritos} de ${r.cupo} ocupados</dd></div>
      </dl>
      <p class="cuenta" id="cuenta">${esc(textoCuenta(r))}</p>
      <p class="pie-panel">
        Contrato
        <a href="${enlaceContrato(ui.contrato)}" target="_blank" rel="noreferrer noopener"
          ><code>${esc(acortarDireccion(ui.contrato))}</code></a
        >
      </p>
    </section>
    ${panelInscripcion(r)}
    ${panelMiembros(r)}
    ${panelOrden(r)}
    ${panelAccion(r)}
  `;
}

function panelInscripcion(r: Resumen): string {
  if (r.estado !== "Inscripcion") return "";
  const total = Math.max(1, r.cupo);
  const porcentaje = Math.min(100, Math.round((r.inscritos / total) * 100));
  return `
    <section class="panel">
      <h2>Inscripciones</h2>
      <div class="barra"><span style="width: ${porcentaje}%"></span></div>
      <p>${r.inscritos} de ${r.cupo} lugares ocupados. La tanda arranca sola cuando se llena el cupo.</p>
      <p class="pie-panel">Cualquiera con el enlace puede ocupar un lugar libre: el contrato no distingue invitados de desconocidos.</p>
    </section>
  `;
}

function panelMiembros(r: Resumen): string {
  if (r.miembros.length === 0) return "";
  const items = r.miembros
    .map((m) => {
      const yo = m === ui.yo ? ' <span class="tu">tú</span>' : "";
      return `<li class="${m === ui.yo ? "yo" : ""}"><code>${esc(acortarDireccion(m))}</code>${yo}</li>`;
    })
    .join("");
  return `
    <section class="panel">
      <h2>Miembros</h2>
      <ul class="miembros">${items}</ul>
    </section>
  `;
}

function panelOrden(r: Resumen): string {
  if (r.orden.length === 0) return "";
  const items = r.orden
    .map((m, i) => {
      const cobrado = i < r.ronda;
      const turno = !cobrado && i === r.ronda && r.estado === "Activa";
      const yo = m === ui.yo ? ' <span class="tu">tú</span>' : "";
      const marca = cobrado
        ? '<span class="marca">ya cobró</span>'
        : turno
          ? '<span class="marca">le toca ahora</span>'
          : "";
      return `<li class="${cobrado ? "cobrado" : ""} ${turno ? "turno" : ""}">
        <span class="num">${i + 1}</span>
        <code>${esc(acortarDireccion(m))}</code>${yo}${marca}
      </li>`;
    })
    .join("");
  return `
    <section class="panel">
      <h2>Orden de cobro</h2>
      <p class="pie-panel">Lo sorteó la red cuando se llenó el cupo. Nadie pudo elegirlo.</p>
      <ol class="orden">${items}</ol>
    </section>
  `;
}

function panelAccion(r: Resumen): string {
  const sugerencia = sugerirAccion(r, ui.yo, ahora());
  const deshabilitado = ui.ocupado || !!ui.avisoRed;
  const boton = sugerencia.accion
    ? `<button class="principal" data-accion="${esc(sugerencia.accion)}" ${deshabilitado ? "disabled" : ""}>
        ${esc(ui.ocupado ? "Esperando a Freighter…" : BOTON[sugerencia.accion])}
      </button>`
    : "";

  return `
    <section class="panel accion">
      <h2>Qué puedo hacer</h2>
      <p class="motivo">${esc(sugerencia.motivo)}</p>
      ${sugerencia.aviso ? `<p class="aviso">${esc(sugerencia.aviso)}</p>` : ""}
      ${boton}
    </section>
  `;
}

function panelIntro(): string {
  return `
    <section class="panel">
      <h2>Falta el ID</h2>
      <p>
        El organizador despliega el contrato una vez con la cuota, el plazo y el cupo, y reparte
        el enlace. Cada persona firma su inscripción con su propia wallet hasta llenar el cupo.
        Pega el ID (<code>C…</code>, 56 caracteres) en el campo de arriba.
      </p>
      <details>
        <summary>Cómo desplegar una tanda nueva</summary>
        <pre># 1. Compila y despliega en testnet (la cuota va en stroops):
stellar contract build
stellar contract deploy \\
  --wasm target/wasm32v1-none/release/ronda_pa_todos.wasm \\
  --source-account mi-cuenta --network testnet \\
  -- --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \\
     --aporte 1000000000 --duracion 604800 --cupo 3

# 2. Abre la página con ?contrato=EL_ID_QUE_DEVOLVIO</pre>
        <p class="pie-panel">
          Cada grupo necesita su propio despliegue: la cuota, el plazo y el cupo se fijan al
          crear el contrato y no se pueden cambiar después.
        </p>
      </details>
    </section>
  `;
}

function pintarBilletera(): void {
  const contenedor = document.querySelector<HTMLDivElement>("#billetera");
  if (!contenedor) return;
  contenedor.innerHTML = ui.yo
    ? `<span class="conectado">Conectado como <code>${esc(acortarDireccion(ui.yo))}</code></span>`
    : `<button data-accion="conectar">Conectar Freighter</button>`;
}

function pintarMensajes(): void {
  const contenedor = document.querySelector<HTMLDivElement>("#mensajes");
  if (!contenedor) return;
  const partes: string[] = [];
  if (ui.avisoRed) partes.push(`<p class="aviso">${esc(ui.avisoRed)}</p>`);
  if (ui.errorAccion) partes.push(`<p class="error">${esc(ui.errorAccion)}</p>`);
  if (ui.errorCarga) partes.push(`<p class="error">${esc(ui.errorCarga)}</p>`);
  if (ui.ultimaTx) {
    partes.push(
      `<p class="exito">Transacción confirmada. <a href="${enlaceTransaccion(ui.ultimaTx)}" target="_blank" rel="noreferrer noopener">Verla en Stellar Expert</a></p>`,
    );
  }
  contenedor.innerHTML = partes.join("");
}

function pintar(): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;
  pintarBilletera();
  pintarMensajes();
  app.innerHTML = !ui.contrato
    ? panelIntro()
    : ui.resumen
      ? panelTanda(ui.resumen)
      : `<section class="panel"><h2>Leyendo la tanda</h2><p>Consultando el contrato en testnet…</p></section>`;
}

function refrescarCuenta(): void {
  const nodo = document.querySelector<HTMLElement>("#cuenta");
  if (nodo && ui.resumen) nodo.textContent = textoCuenta(ui.resumen);
}

// --- Arranque -----------------------------------------------------------

async function arrancar(): Promise<void> {
  const url = new URL(location.href);
  const pedido = (url.searchParams.get("contrato") ?? "").trim();
  const campo = document.querySelector<HTMLInputElement>("#contrato");
  const formulario = document.querySelector<HTMLFormElement>("#form-contrato");

  if (pedido) {
    if (campo) campo.value = pedido;
    ui.contrato = idValido(pedido) ? pedido : "";
    if (!ui.contrato) {
      ui.errorCarga = "Ese ID no parece un contrato Stellar: empieza por C y tiene 56 caracteres.";
    }
  }

  formulario?.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const id = (campo?.value ?? "").trim();
    if (!idValido(id)) {
      ui.errorCarga = "Ese ID no parece un contrato Stellar: empieza por C y tiene 56 caracteres.";
      pintarMensajes();
      return;
    }
    const destino = new URL(location.href);
    destino.searchParams.set("contrato", id);
    location.href = destino.toString();
  });

  document.addEventListener("click", (evento) => {
    const objetivo = (evento.target as HTMLElement | null)?.closest<HTMLElement>("[data-accion]");
    if (!objetivo || objetivo.hasAttribute("disabled")) return;
    const accion = objetivo.dataset.accion;
    if (accion === "conectar") void conectarBilletera();
    else if (accion === "unirse" || accion === "aportar" || accion === "reclamar") {
      void actuar(accion);
    }
  });

  pintar();

  const guardada = await cuentaAutorizada();
  if (guardada) {
    ui.yo = guardada;
    await comprobarRed();
    pintar();
  }

  if (ui.contrato) await refrescar();

  window.setInterval(() => {
    if (ui.contrato && !ui.ocupado && !document.hidden) void refrescar();
  }, REFRESCO_MS);

  window.setInterval(refrescarCuenta, TICTAC_MS);
}

void arrancar();
