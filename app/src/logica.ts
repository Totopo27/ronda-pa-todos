/**
 * Lógica pura de la interfaz: nada de red, nada de DOM. Todo lo que se puede
 * equivocar sin abrir un navegador se decide aquí y se prueba en `logica.test.ts`.
 */

export type EstadoTanda = "Inscripcion" | "Activa" | "Terminada" | "Abortada";

export type Accion = "unirse" | "aportar" | "reclamar";

/** El estado de la tanda tal como lo usa la interfaz, ya normalizado. */
export interface Resumen {
  token: string | null;
  estado: EstadoTanda;
  ronda: number;
  miembros: string[];
  orden: string[];
  aporte: bigint;
  duracion: bigint;
  /** Cuántos lugares tiene la tanda en total. */
  cupo: number;
  inscritos: number;
  inicio: bigint;
  aQuienToca: string | null;
  unido: boolean;
  haPagado: boolean;
  yaDevuelto: boolean;
  aportesPorTurno: number;
  paso: number;
  espera: bigint;
  apertura: bigint;
  aportesMiembro: number;
}

export interface Sugerencia {
  accion: Accion | null;
  motivo: string;
  /** Advertencia para una acción posible pero con consecuencias. */
  aviso?: string;
}

const ESTADOS: EstadoTanda[] = ["Inscripcion", "Activa", "Terminada", "Abortada"];

/** El SDK decodifica los enums como `{ tag: "Activa" }`; también aceptamos texto. */
export function estadoDesdeCrudo(crudo: unknown): EstadoTanda {
  const nombre =
    typeof crudo === "string"
      ? crudo
      : crudo && typeof crudo === "object" && "tag" in crudo
        ? String((crudo as { tag: unknown }).tag)
        : "";
  return (ESTADOS.find((e) => e === nombre) ?? "Inscripcion") as EstadoTanda;
}

function entero(valor: unknown): bigint {
  if (typeof valor === "bigint") return valor;
  if (typeof valor === "number") return BigInt(Math.trunc(valor));
  if (typeof valor === "string" && /^-?\d+$/.test(valor)) return BigInt(valor);
  return 0n;
}

function direcciones(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

/** Traduce lo que devuelve `resumen()` en la forma que consume la interfaz. */
export function normalizarResumen(crudo: unknown): Resumen {
  const c = (crudo ?? {}) as Record<string, unknown>;
  const haPagado = c.ha_pagado === true;
  const aportesPorTurno = Number(entero(c.aportes_por_turno));
  const aportesMiembro =
    c.aportes_miembro !== undefined
      ? Math.max(0, Number(entero(c.aportes_miembro)))
      : haPagado
        ? 1
        : 0;
  return {
    token: typeof c.token === "string" ? c.token : null,
    estado: estadoDesdeCrudo(c.estado),
    ronda: Number(entero(c.ronda)),
    miembros: direcciones(c.miembros),
    orden: direcciones(c.orden),
    aporte: entero(c.aporte),
    duracion: entero(c.duracion),
    cupo: Number(entero(c.cupo)),
    inscritos: Number(entero(c.inscritos)),
    inicio: entero(c.inicio),
    aQuienToca: typeof c.a_quien_toca === "string" ? c.a_quien_toca : null,
    unido: c.unido === true,
    haPagado,
    yaDevuelto: c.ya_devuelto === true,
    aportesPorTurno: aportesPorTurno > 0 ? aportesPorTurno : 1,
    paso: Math.max(0, Number(entero(c.paso))),
    espera: entero(c.espera),
    apertura: entero(c.apertura),
    aportesMiembro,
  };
}

/** Los que ya cobraron su pozo: la cabeza del orden hasta la ronda en curso. */
export function quienesCobraron(r: Resumen): string[] {
  return r.orden.slice(0, Math.max(0, r.ronda));
}

export interface EntregaPozo {
  ronda: number;
  receptor: string;
  monto: bigint;
  aportes: number;
}

/** Suma de la buchaca completa de un turno (`cuota × cupo × aportesPorTurno`). */
export function montoPozo(
  r: Pick<Resumen, "aporte" | "cupo" | "aportesPorTurno">,
): bigint {
  return r.aporte * BigInt(Math.max(0, r.cupo)) * BigInt(Math.max(1, r.aportesPorTurno));
}

/** Rondas completadas cuyo pozo ya se transfirió al miembro correspondiente. */
export function entregasRealizadas(r: Resumen): EntregaPozo[] {
  const monto = montoPozo(r);
  const aportes = r.cupo * Math.max(1, r.aportesPorTurno);
  return quienesCobraron(r).map((receptor, i) => ({
    ronda: i + 1,
    receptor,
    monto,
    aportes,
  }));
}

/** Detecta si la tanda avanzó de ronda respecto a la lectura anterior. */
export function entregaDeRondaCerrada(
  anterior: Resumen | null,
  actual: Resumen,
): EntregaPozo | null {
  if (!anterior || actual.ronda <= anterior.ronda) return null;
  const entregas = entregasRealizadas(actual);
  return entregas[entregas.length - 1] ?? null;
}

/** Segundos hasta que abra el siguiente aporte; 0 si ya está abierto. */
export function segundosHastaApertura(r: Resumen, ahoraSegundos: number): number {
  if (r.apertura === 0n) return 0;
  return Math.max(0, Number(r.apertura) - ahoraSegundos);
}

/** Segundos que le quedan a la ronda en curso. Nunca negativo; 0 si no arrancó. */
export function segundosRestantes(r: Resumen, ahoraSegundos: number): number {
  if (r.inicio === 0n) return 0;
  const vence = Number(r.inicio + r.duracion);
  return Math.max(0, vence - ahoraSegundos);
}

/**
 * Qué puede hacer esta cuenta ahora mismo, y por qué. La regla es la misma del
 * contrato: no se ofrecen acciones que la cadena va a rechazar.
 */
export function sugerirAccion(
  r: Resumen | null,
  yo: string | null,
  ahoraSegundos: number,
): Sugerencia {
  if (!r) return { accion: null, motivo: "Leyendo la ronda en testnet…" };
  if (!yo) return { accion: null, motivo: "Conecta tu wallet para participar." };

  const estado = r.estado;

  // Mientras hay cupo, la inscripción está abierta para cualquiera: no hace
  // falta estar en ninguna lista previa, solo firmar con la propia wallet.
  if (estado === "Inscripcion") {
    if (r.unido) {
      const faltan = Math.max(0, r.cupo - r.inscritos);
      return {
        accion: null,
        motivo:
          faltan === 1
            ? "Ya estás dentro. Falta 1 firma para que se llene el cupo y arranque la ronda."
            : `Ya estás dentro. Faltan ${faltan} firmas para que se llene el cupo y arranque la ronda.`,
      };
    }
    return {
      accion: "unirse",
      motivo:
        "Firma tu inscripción y ocupa un campo. Cuando se llene el cupo, se rifa el orden de cobro.",
    };
  }

  // De aquí en adelante sí hay lista cerrada: el cupo ya se llenó.
  if (!r.miembros.includes(yo)) {
    return { accion: null, motivo: "Tu cuenta no está entre los miembros de esta ronda." };
  }

  const vigente = segundosRestantes(r, ahoraSegundos) > 0;

  if (estado === "Abortada") {
    if (r.yaDevuelto) {
      return { accion: null, motivo: "La ronda se abortó y ya recuperaste lo que aportaste en este turno." };
    }
    if (r.haPagado || r.aportesMiembro > 0) {
      return {
        accion: "reclamar",
        motivo:
          r.aportesMiembro > 1
            ? "La ronda se abortó. Recupera los aportes que pusiste en este turno."
            : "La ronda se abortó. Recupera tu aporte.",
      };
    }
    return {
      accion: null,
      motivo: "La ronda se abortó. No aportaste este turno, así que no hay nada que reclamar.",
    };
  }

  if (estado === "Terminada") {
    return { accion: null, motivo: "La ronda terminó: todos cobraron su buchaca una vez." };
  }

  // Activa.
  const faltaAbrir = segundosHastaApertura(r, ahoraSegundos);
  if (faltaAbrir > 0) {
    return {
      accion: null,
      motivo: `El próximo aporte abre en ${formatearDuracion(faltaAbrir)}.`,
    };
  }

  if (r.haPagado) {
    if (!vigente) {
      return {
        accion: "reclamar",
        motivo:
          r.aportesMiembro > 1
            ? "El plazo venció y no se juntó la buchaca de este turno. Puedes recuperar todos tus aportes de este turno."
            : "El plazo venció y no se juntó la buchaca de este turno. Puedes recuperar tu aporte.",
        aviso: "Si reclamas, la ronda se aborta para todos y nadie más cobra su buchaca.",
      };
    }
    return {
      accion: null,
      motivo:
        r.aportesPorTurno > 1
          ? "Ya aportaste este periodo. Esperando a los demás."
          : "Ya aportaste este turno. Esperando a los demás.",
    };
  }
  if (!vigente) {
    if (r.aportesMiembro > 0) {
      return {
        accion: "reclamar",
        motivo:
          "El plazo venció y ya tienes aportes en este turno. Puedes recuperar todo lo que pusiste en este turno.",
        aviso: "Si reclamas, la ronda se aborta para todos y nadie más cobra su buchaca.",
      };
    }
    return {
      accion: "aportar",
      motivo: "El plazo de este turno ya venció, pero nadie ha reclamado todavía.",
      aviso:
        "Si aportas ahora y el turno no se completa, podrás recuperar tu aporte con «Recuperar mi aporte».",
    };
  }
  return { accion: "aportar", motivo: "Falta tu aporte de este turno." };
}

export const DECIMALES_XLM = 7;
export const MIN_CUPO = 2;
export const MAX_CUPO = 50;
export const MIN_DURACION = 60n;
export const MAX_DURACION = 1_209_600n;
export const MIN_APORTES_POR_TURNO = 1;
export const MAX_APORTES_POR_TURNO = 24;
export const MAX_ESPERA = 1_209_600n;
const MAX_SAC_I64 = 9_223_372_036_854_775_807n;

export interface ParametrosNuevaRonda {
  cupo: number;
  aporte: bigint;
  duracion: bigint;
  aportesPorTurno: number;
  espera: bigint;
}

/** Convierte un monto decimal en texto (p. ej. "10.5" o "10,5") a stroops enteros. */
export function parsearImporte(texto: string, decimales = DECIMALES_XLM): bigint | null {
  const limpio = texto.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(limpio)) return null;
  const [entera, fraccion = ""] = limpio.split(/[.,]/);
  if (fraccion.length > decimales) return null;
  const valor = BigInt(entera) * 10n ** BigInt(decimales) + BigInt(fraccion.padEnd(decimales, "0"));
  return valor > 0n ? valor : null;
}

/** Valida cupo, cuota, plazo y frecuencia antes de construir la transacción de despliegue. */
export function validarNuevaRonda(entrada: {
  cupo: string;
  cuota: string;
  duracion: string;
  aportesPorTurno?: string;
  espera?: string;
}): { ok: true; datos: ParametrosNuevaRonda } | { ok: false; error: string } {
  const cupoTxt = entrada.cupo.trim();
  if (!/^\d+$/.test(cupoTxt)) {
    return { ok: false, error: "El cupo debe ser un número entero entre 2 y 50 campos." };
  }
  const cupo = Number(cupoTxt);
  if (!Number.isSafeInteger(cupo) || cupo < MIN_CUPO || cupo > MAX_CUPO) {
    return { ok: false, error: "El cupo debe estar entre 2 y 50 campos." };
  }

  const aportesTxt = (entrada.aportesPorTurno ?? "1").trim();
  if (!/^\d+$/.test(aportesTxt)) {
    return { ok: false, error: "Los aportes por turno deben ser un número entero entre 1 y 24." };
  }
  const aportesPorTurno = Number(aportesTxt);
  if (
    !Number.isSafeInteger(aportesPorTurno) ||
    aportesPorTurno < MIN_APORTES_POR_TURNO ||
    aportesPorTurno > MAX_APORTES_POR_TURNO
  ) {
    return { ok: false, error: "Los aportes por turno deben estar entre 1 y 24." };
  }

  const aporte = parsearImporte(entrada.cuota, DECIMALES_XLM);
  if (aporte === null) {
    return {
      ok: false,
      error: "La cuota debe ser un monto de XLM mayor que cero (hasta 7 decimales).",
    };
  }
  if (aporte * BigInt(cupo) * BigInt(aportesPorTurno) > MAX_SAC_I64) {
    return {
      ok: false,
      error: "La buchaca total (cuota × cupo × aportes por turno) excede el límite máximo del token.",
    };
  }

  const durTxt = entrada.duracion.trim();
  if (!/^\d+$/.test(durTxt)) {
    return { ok: false, error: "El plazo límite debe ser un número entero en segundos." };
  }
  const duracion = BigInt(durTxt);
  if (duracion < MIN_DURACION || duracion > MAX_DURACION) {
    return {
      ok: false,
      error: "El plazo límite debe estar entre 60 segundos y 14 días (1 209 600 s).",
    };
  }

  const esperaTxt = (entrada.espera ?? "0").trim();
  if (!/^\d+$/.test(esperaTxt)) {
    return { ok: false, error: "La espera entre aportes debe ser un número entero en segundos." };
  }
  const espera = BigInt(esperaTxt);
  if (espera > MAX_ESPERA) {
    return {
      ok: false,
      error: "La espera entre aportes no puede superar 14 días (1 209 600 s).",
    };
  }

  return { ok: true, datos: { cupo, aporte, duracion, aportesPorTurno, espera } };
}

/** `15000000n` con 7 decimales es "1.5", no "1.5000000". */
export function formatearImporte(stroops: bigint, decimales: number): string {
  const negativo = stroops < 0n;
  const bruto = (negativo ? -stroops : stroops).toString().padStart(decimales + 1, "0");
  const corte = bruto.length - decimales;
  const entera = bruto.slice(0, corte);
  const fraccion = bruto.slice(corte).replace(/0+$/, "");
  const numero = fraccion ? `${entera}.${fraccion}` : entera;
  return negativo ? `-${numero}` : numero;
}

/** "1 d 1 h", "1 h 0 min", "1 min 30 s", "45 s". */
export function formatearDuracion(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}

export function enlaceFriendbot(direccion: string): string {
  return `https://friendbot.stellar.org/?addr=${encodeURIComponent(direccion)}`;
}

const ERRORES: Record<number, string> = {
  1: "El cupo de la ronda tiene que estar entre 2 y 50 campos.",
  2: "La cuota tiene que ser mayor que cero y la buchaca total no puede desbordar el límite del contrato.",
  3: "El plazo límite tiene que estar entre 60 segundos y 14 días (1 209 600 s).",
  4: "Tu cuenta no está entre los miembros de esta ronda.",
  5: "Esa cuenta ya ocupó un campo en esta ronda.",
  6: "La inscripción ya cerró: el cupo está lleno y la ronda está en marcha.",
  7: "La ronda todavía no arrancó: faltan firmas de inscripción.",
  8: "Esa cuenta ya aportó en este ciclo.",
  9: "La ronda ya terminó o se abortó; no admite más aportes.",
  10: "Todavía no venció el plazo de este turno.",
  11: "Esa cuenta no aportó el turno en curso, así que no tiene nada que reclamar.",
  12: "Ese aporte ya fue devuelto.",
  13: "El contrato no tiene configuración. ¿Seguro que ese ID es una ronda?",
  14: "Los aportes por turno deben estar entre 1 y 24.",
  15: "La espera entre aportes no puede superar 14 días.",
  16: "Todavía no abre la ventana para el siguiente aporte.",
};

/** El host devuelve `Error(Contract, #N)` dentro de un mensaje largo. */
export function codigoDeError(mensaje: string): number | null {
  const coincidencia = /Error\(Contract, #(\d+)\)/.exec(mensaje);
  return coincidencia ? Number(coincidencia[1]) : null;
}

export function traducirError(codigo: number): string {
  return ERRORES[codigo] ?? `Error del contrato (código ${codigo}).`;
}

/**
 * Convierte lo que escupe el SDK, Freighter o el RPC en una frase accionable.
 * Si no reconoce nada, devuelve el mensaje original: inventar sería peor.
 */
export function describirError(mensaje: string): string {
  const codigo = codigoDeError(mensaje);
  if (codigo !== null) return traducirError(codigo);
  if (/declin|denied|reject|cancel/i.test(mensaje)) {
    return "Cancelaste la firma en tu wallet. No se movió nada.";
  }
  if (/insufficient|underfunded|balance is not sufficient|tx_insufficient/i.test(mensaje)) {
    return "La cuenta no tiene XLM suficiente para la cuota y las comisiones. Pide fondos en testnet.";
  }
  if (/timeout|timed out|network|fetch failed|failed to fetch|ECONN/i.test(mensaje)) {
    return `No pudimos hablar con el RPC de testnet. Revisa tu conexión y vuelve a intentar. (${mensaje})`;
  }
  return mensaje;
}

/** "GAYX…OC2W" para no llenar la pantalla de direcciones. */
export function acortarDireccion(direccion: string): string {
  if (direccion.length <= 10) return direccion;
  return `${direccion.slice(0, 4)}…${direccion.slice(-4)}`;
}
