import {
  acortarDireccion,
  describirError,
  enlaceFriendbot,
  entregaDeRondaCerrada,
  entregasRealizadas,
  formatearDuracion,
  formatearImporte,
  montoPozo,
  segundosRestantes,
  sugerirAccion,
  validarNuevaRonda,
  type Accion,
  type EntregaPozo,
  type Resumen,
} from "./logica";
import {
  crearRonda,
  cuentaFondeada,
  ejecutar,
  enlaceContrato,
  enlaceTransaccion,
  leerPagadosRonda,
  leerResumen,
  leerToken,
  type Token,
} from "./cadena";
import {
  ErrorBilletera,
  conectar,
  cuentaAutorizada,
  exigirTestnet,
  firmar,
  refrescarDireccion,
} from "./billetera";

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
  pagadosRonda: Set<string> | null;
  rondaRecienCerrada: EntregaPozo | null;
  errorCarga: string | null;
  errorAccion: string | null;
  avisoRed: string | null;
  avisoBilletera: string | null;
  fondeada: boolean | null;
  ultimaTx: string | null;
  ocupado: boolean;
  creando: boolean;
  formCrear: {
    cupo: string;
    cuota: string;
    duracion: string;
  };
}

const ui: Estado = {
  contrato: "",
  yo: null,
  resumen: null,
  token: null,
  pagadosRonda: null,
  rondaRecienCerrada: null,
  errorCarga: null,
  errorAccion: null,
  avisoRed: null,
  avisoBilletera: null,
  fondeada: null,
  ultimaTx: null,
  ocupado: false,
  creando: false,
  formCrear: {
    cupo: "3",
    cuota: "10",
    duracion: "600",
  },
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
    const anterior = ui.resumen;
    const resumen = await leerResumen(ui.contrato, ui.yo);
    ui.resumen = resumen;
    ui.errorCarga = null;
    const cerrada = entregaDeRondaCerrada(anterior, resumen);
    if (cerrada) ui.rondaRecienCerrada = cerrada;

    const leerPagados =
      resumen.estado === "Activa" || resumen.estado === "Abortada"
        ? leerPagadosRonda(ui.contrato, resumen.miembros).catch(() => null)
        : Promise.resolve(null);
    const [token, pagadosRonda] = await Promise.all([
      resumen.token ? leerToken(resumen.token).catch(() => null) : Promise.resolve(null),
      leerPagados,
    ]);
    ui.token = token;
    ui.pagadosRonda = pagadosRonda;
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

/**
 * Friendbot rechaza con 400 las cuentas que ya tienen saldo, así que el enlace
 * solo se muestra cuando la cuenta todavía no existe en testnet.
 */
async function comprobarFondos(): Promise<void> {
  ui.fondeada = ui.yo ? await cuentaFondeada(ui.yo) : null;
}

async function conectarBilletera(): Promise<void> {
  ui.errorAccion = null;
  ui.avisoBilletera = null;
  try {
    ui.yo = await conectar();
    await comprobarRed();
    await comprobarFondos();
  } catch (fallo) {
    ui.errorAccion = mensajeDe(fallo);
  }
  pintar();
  await refrescar();
}

/**
 * Vuelve a preguntarle la dirección a la wallet.
 *
 * La app guarda la dirección en memoria y el kit la persiste en localStorage, así
 * que cambiar de cuenta dentro de la misma wallet no rompe nada por sí solo: hay
 * que pedirla de nuevo. Si la wallet no responde sin abrir su ventana, caemos al
 * selector, que siempre funciona.
 */
async function cambiarBilletera(): Promise<void> {
  ui.errorAccion = null;
  ui.avisoBilletera = null;
  const nueva = await refrescarDireccion();
  if (!nueva) {
    await conectarBilletera();
    return;
  }
  if (nueva === ui.yo) {
    ui.avisoBilletera =
      "La wallet sigue entregando la misma dirección. Cámbiala dentro de la wallet y vuelve a intentar.";
    pintarMensajes();
    return;
  }
  ui.yo = nueva;
  await comprobarRed();
  await comprobarFondos();
  pintar();
  await refrescar();
}

async function actuar(accion: Accion): Promise<void> {
  const cuenta = ui.yo;
  if (!cuenta || !ui.contrato || ui.ocupado) return;

  ui.ocupado = true;
  ui.errorAccion = null;
  ui.ultimaTx = null;
  ui.rondaRecienCerrada = null;
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

async function crearNuevaRonda(): Promise<void> {
  if (!ui.yo || ui.creando) return;

  const validacion = validarNuevaRonda(ui.formCrear);
  if (!validacion.ok) {
    ui.errorAccion = validacion.error;
    pintarMensajes();
    return;
  }

  const cuenta = ui.yo;
  ui.creando = true;
  ui.errorAccion = null;
  ui.ultimaTx = null;
  pintar();

  try {
    await exigirTestnet();
    ui.avisoRed = null;
    const creada = await crearRonda(validacion.datos, cuenta, (xdr) => firmar(xdr, cuenta));
    const destino = new URL(location.href);
    destino.searchParams.set("contrato", creada.contratoId);
    location.href = destino.toString();
  } catch (fallo) {
    ui.errorAccion = mensajeDe(fallo);
    if (fallo instanceof ErrorBilletera && fallo.motivo === "red") ui.avisoRed = fallo.message;
    ui.creando = false;
    pintar();
  }
}

// --- Pintado ------------------------------------------------------------

function textoMonto(stroops: bigint): string {
  if (!ui.token) return `${formatearImporte(stroops, 0)} unidades del token`;
  return `${formatearImporte(stroops, ui.token.decimales)} ${ui.token.simbolo}`;
}

function textoCuota(r: Resumen): string {
  return textoMonto(r.aporte);
}

function textoCuenta(r: Resumen): string {
  if (r.estado === "Inscripcion") {
    return "La cuenta regresiva empieza cuando se llena el cupo.";
  }
  if (r.estado === "Terminada") {
    return "La ronda terminó: todos cobraron su buchaca exactamente una vez.";
  }
  if (r.estado === "Abortada") {
    return "La ronda se abortó. Quien aportó su cuota de este turno puede recuperarla.";
  }
  const ronda = Math.min(r.ronda + 1, r.cupo);
  const restante = segundosRestantes(r, ahora());
  if (restante > 0) {
    return `Quedan ${formatearDuracion(restante)} para que cierre el turno ${ronda} de ${r.cupo}.`;
  }
  return `El plazo del turno ${ronda} ya venció. Quien aportó puede recuperar su plata; quien no aportó ya no cobrará su buchaca.`;
}

function panelTanda(r: Resumen): string {
  const ronda =
    r.estado === "Inscripcion"
      ? "—"
      : `${Math.min(r.ronda + 1, r.cupo)} de ${r.cupo}`;

  return `
    <section class="panel">
      <div class="panel-cabecera">
        <h2>La ronda</h2>
        <span class="pill ${esc(r.estado.toLowerCase())}">${esc(MOTIVO_ESTADO[r.estado] ?? r.estado)}</span>
      </div>
      <dl class="datos">
        <div><dt>Cuota</dt><dd>${esc(textoCuota(r))}</dd></div>
        <div><dt>Buchaca por turno</dt><dd>${esc(textoMonto(montoPozo(r)))}</dd></div>
        <div><dt>Plazo por turno</dt><dd>${esc(formatearDuracion(Number(r.duracion)))}</dd></div>
        <div><dt>Turno</dt><dd>${esc(ronda)}</dd></div>
        <div><dt>Campos</dt><dd>${r.inscritos} de ${r.cupo} ocupados</dd></div>
      </dl>
      <p class="cuenta" id="cuenta">${esc(textoCuenta(r))}</p>
      <div class="pie-panel acciones-ronda">
        <span>
          Contrato
          <a href="${enlaceContrato(ui.contrato)}" target="_blank" rel="noreferrer noopener"
            ><code>${esc(acortarDireccion(ui.contrato))}</code></a
          >
        </span>
        <button type="button" class="secundario" data-accion="copiar-enlace">Copiar enlace</button>
        <a href="./">Crear otra ronda</a>
      </div>
    </section>
    ${panelInscripcion(r)}
    ${panelAportesRonda(r)}
    ${panelEntregas(r)}
    ${panelMiembros(r)}
    ${panelOrden(r)}
    ${panelAccion(r)}
  `;
}

function panelAportesRonda(r: Resumen): string {
  if (r.estado !== "Activa") return "";
  const rondaActual = Math.min(r.ronda + 1, r.cupo);
  const pozo = montoPozo(r);

  let progreso = "";
  if (ui.pagadosRonda) {
    const pagados = r.miembros.filter((m) => ui.pagadosRonda?.has(m)).length;
    const total = Math.max(1, r.cupo);
    const porcentaje = Math.min(100, Math.round((pagados / total) * 100));
    const reunido = r.aporte * BigInt(pagados);
    progreso = `
      <div class="barra"><span style="width: ${porcentaje}%"></span></div>
      <p>${pagados} de ${r.cupo} aportes reunidos (${esc(textoMonto(reunido))} de ${esc(textoMonto(pozo))}).</p>
    `;
  }

  const destino = r.aQuienToca
    ? `<code>${esc(acortarDireccion(r.aQuienToca))}</code>${r.aQuienToca === ui.yo ? ' <span class="tu">tú</span>' : ""}`
    : "la persona en turno";

  return `
    <section class="panel">
      <h2>Aportes del turno ${rondaActual}</h2>
      ${progreso}
      <p class="pie-panel">
        Al reunir los ${r.cupo} aportes, el contrato envía de inmediato la buchaca completa (${esc(textoMonto(pozo))}) a ${destino}.
      </p>
    </section>
  `;
}

function panelEntregas(r: Resumen): string {
  const entregas = entregasRealizadas(r);
  if (entregas.length === 0) return "";
  const items = entregas
    .map((e) => {
      const reciente = ui.rondaRecienCerrada?.ronda === e.ronda;
      const yo = e.receptor === ui.yo ? ' <span class="tu">tú</span>' : "";
      return `<li class="${reciente ? "reciente" : ""}">
        <span class="num">Turno ${e.ronda}</span>
        <span class="detalle">
          Todos aportaron (${e.aportes}/${e.aportes}) · Buchaca de ${esc(textoMonto(e.monto))} enviada a
          <code>${esc(acortarDireccion(e.receptor))}</code>${yo}
        </span>
        <span class="marca-ok">${reciente ? "recién enviada" : "enviada"}</span>
      </li>`;
    })
    .join("");

  return `
    <section class="panel">
      <h2>Buchacas entregadas</h2>
      <p class="pie-panel">
        En cada turno cerrado se reunieron todas las cuotas y la buchaca completa se transfirió automáticamente según el orden rifado.
      </p>
      <ol class="entregas">${items}</ol>
    </section>
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
      <p>${r.inscritos} de ${r.cupo} campos ocupados. La ronda arranca sola cuando se llena el cupo.</p>
      <p class="pie-panel">Cualquiera con el enlace puede ocupar un campo libre: el contrato no distingue invitados de desconocidos.</p>
    </section>
  `;
}

function panelMiembros(r: Resumen): string {
  if (r.miembros.length === 0) return "";
  const mostrarPago =
    ui.pagadosRonda !== null && (r.estado === "Activa" || r.estado === "Abortada");
  const items = r.miembros
    .map((m) => {
      const yo = m === ui.yo ? ' <span class="tu">tú</span>' : "";
      const pago = mostrarPago && ui.pagadosRonda?.has(m);
      const estadoPago = mostrarPago
        ? ` <span class="estado-pago ${pago ? "pago" : "pendiente"}">${pago ? "aportó" : "pendiente"}</span>`
        : "";
      return `<li class="${m === ui.yo ? "yo" : ""}"><code>${esc(acortarDireccion(m))}</code>${yo}${estadoPago}</li>`;
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
      <p class="pie-panel">Lo rifó la red cuando se llenó el cupo. Nadie pudo elegirlo a dedo.</p>
      <ol class="orden">${items}</ol>
    </section>
  `;
}

function panelAccion(r: Resumen): string {
  const sugerencia = sugerirAccion(r, ui.yo, ahora());
  const deshabilitado = ui.ocupado || !!ui.avisoRed;
  const boton = sugerencia.accion
    ? `<button class="principal" data-accion="${esc(sugerencia.accion)}" ${deshabilitado ? "disabled" : ""}>
        ${esc(ui.ocupado ? "Esperando a la wallet…" : BOTON[sugerencia.accion])}
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
  const plazos = [
    ["600", "10 minutos (prueba rápida)"],
    ["3600", "1 hora"],
    ["86400", "1 día"],
    ["604800", "1 semana"],
  ]
    .map(
      ([valor, etiqueta]) =>
        `<option value="${valor}"${ui.formCrear.duracion === valor ? " selected" : ""}>${etiqueta}</option>`,
    )
    .join("");

  const botonCrear = !ui.yo
    ? '<button type="button" class="principal" data-accion="conectar">Conectar wallet para crear</button>'
    : `<button type="submit" class="principal" ${ui.creando || !!ui.avisoRed ? "disabled" : ""}>
        ${ui.creando ? "Creando ronda…" : "Crear ronda nueva"}
      </button>`;

  return `
    <section class="panel">
      <h2>Crear ronda nueva</h2>
      <p>
        Despliega tu propia ronda vacía en Stellar testnet con XLM de prueba y comparte el enlace
        generado para que cada persona ocupe un campo.
      </p>
      <form id="form-crear" class="form-crear" novalidate>
        <div class="campos-crear">
          <div>
            <label for="crear-cupo">Campos (cupo)</label>
            <input
              id="crear-cupo"
              name="cupo"
              type="number"
              min="2"
              max="50"
              step="1"
              value="${esc(ui.formCrear.cupo)}"
            />
          </div>
          <div>
            <label for="crear-cuota">Cuota por turno (XLM)</label>
            <input
              id="crear-cuota"
              name="cuota"
              type="text"
              inputmode="decimal"
              value="${esc(ui.formCrear.cuota)}"
            />
          </div>
          <div>
            <label for="crear-duracion">Plazo por turno</label>
            <select id="crear-duracion" name="duracion">${plazos}</select>
          </div>
        </div>
        ${botonCrear}
      </form>
      <p class="pie-panel">
        Los parámetros no se pueden cambiar después. El creador no entra automáticamente: después
        firmas tu campo como cualquier participante.
      </p>
    </section>
    <section class="panel">
      <h2>Abrir una ronda existente</h2>
      <p>
        Si ya te compartieron un enlace o tienes el ID de una ronda en curso, pega el ID
        (<code>C…</code>, 56 caracteres) en el campo de arriba.
      </p>
      <details>
        <summary>Cómo desplegar una ronda nueva por CLI</summary>
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
    ? `<span class="conectado">Conectado como <code>${esc(acortarDireccion(ui.yo))}</code></span>
       <button data-accion="cambiar">Cambiar</button>`
    : `<button data-accion="conectar">Conectar wallet</button>`;
}

function pintarMensajes(): void {
  const contenedor = document.querySelector<HTMLDivElement>("#mensajes");
  if (!contenedor) return;
  const partes: string[] = [];
  if (ui.avisoRed) partes.push(`<p class="aviso">${esc(ui.avisoRed)}</p>`);
  if (ui.avisoBilletera) partes.push(`<p class="aviso">${esc(ui.avisoBilletera)}</p>`);
  if (ui.errorAccion) partes.push(`<p class="error">${esc(ui.errorAccion)}</p>`);
  if (ui.errorCarga) partes.push(`<p class="error">${esc(ui.errorCarga)}</p>`);
  if (ui.rondaRecienCerrada) {
    const e = ui.rondaRecienCerrada;
    const tu = e.receptor === ui.yo ? " (tú)" : "";
    const enlace = ui.ultimaTx
      ? ` <a href="${esc(enlaceTransaccion(ui.ultimaTx))}" target="_blank" rel="noreferrer noopener">Verla en Stellar Expert</a>`
      : "";
    partes.push(
      `<p class="exito">Turno ${e.ronda} completado: aportaron los ${e.aportes}/${e.aportes} miembros y ya se envió la buchaca de ${esc(textoMonto(e.monto))} a <code>${esc(acortarDireccion(e.receptor))}</code>${tu}.${enlace}</p>`,
    );
  } else if (ui.ultimaTx) {
    partes.push(
      `<p class="exito">Transacción confirmada. <a href="${esc(enlaceTransaccion(ui.ultimaTx))}" target="_blank" rel="noreferrer noopener">Verla en Stellar Expert</a></p>`,
    );
  }
  if (ui.yo && ui.fondeada !== true) {
    partes.push(
      `<p class="fondos">¿Necesitas XLM de prueba? <a href="${enlaceFriendbot(ui.yo)}" target="_blank" rel="noreferrer noopener">Fondear esta cuenta con Friendbot</a>.</p>`,
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
      : `<section class="panel"><h2>Leyendo la ronda</h2><p>Consultando el contrato en testnet…</p></section>`;
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

  const actualizarFormCrear = (evento: Event) => {
    const campo = evento.target as HTMLInputElement | HTMLSelectElement | null;
    if (!campo || campo.closest("#form-crear") === null) return;
    if (campo.name === "cupo") ui.formCrear.cupo = campo.value;
    else if (campo.name === "cuota") ui.formCrear.cuota = campo.value;
    else if (campo.name === "duracion") ui.formCrear.duracion = campo.value;
  };
  document.addEventListener("input", actualizarFormCrear);
  document.addEventListener("change", actualizarFormCrear);

  document.addEventListener("submit", (evento) => {
    if ((evento.target as HTMLElement | null)?.id !== "form-crear") return;
    evento.preventDefault();
    void crearNuevaRonda();
  });

  document.addEventListener("click", (evento) => {
    const objetivo = (evento.target as HTMLElement | null)?.closest<HTMLElement>("[data-accion]");
    if (!objetivo || objetivo.hasAttribute("disabled")) return;
    const accion = objetivo.dataset.accion;
    if (accion === "conectar") void conectarBilletera();
    else if (accion === "cambiar") void cambiarBilletera();
    else if (accion === "copiar-enlace") {
      void navigator.clipboard?.writeText(location.href).then(
        () => {
          objetivo.textContent = "Enlace copiado";
          window.setTimeout(() => {
            if (objetivo.isConnected) objetivo.textContent = "Copiar enlace";
          }, 2000);
        },
        () => {
          objetivo.textContent = "No se pudo copiar";
        },
      );
    } else if (accion === "unirse" || accion === "aportar" || accion === "reclamar") {
      void actuar(accion);
    }
  });

  pintar();

  const guardada = await cuentaAutorizada();
  if (guardada) {
    ui.yo = guardada;
    await comprobarRed();
    await comprobarFondos();
    pintar();
  }

  if (ui.contrato) await refrescar();

  window.setInterval(() => {
    if (ui.contrato && !ui.ocupado && !document.hidden) void refrescar();
  }, REFRESCO_MS);

  window.setInterval(refrescarCuenta, TICTAC_MS);
}

void arrancar();
