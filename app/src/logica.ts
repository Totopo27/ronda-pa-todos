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
  inscritos: number;
  inicio: bigint;
  aQuienToca: string | null;
  unido: boolean;
  haPagado: boolean;
  yaDevuelto: boolean;
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
  return {
    token: typeof c.token === "string" ? c.token : null,
    estado: estadoDesdeCrudo(c.estado),
    ronda: Number(entero(c.ronda)),
    miembros: direcciones(c.miembros),
    orden: direcciones(c.orden),
    aporte: entero(c.aporte),
    duracion: entero(c.duracion),
    inscritos: Number(entero(c.inscritos)),
    inicio: entero(c.inicio),
    aQuienToca: typeof c.a_quien_toca === "string" ? c.a_quien_toca : null,
    unido: c.unido === true,
    haPagado: c.ha_pagado === true,
    yaDevuelto: c.ya_devuelto === true,
  };
}

/** Los que ya cobraron su pozo: la cabeza del orden hasta la ronda en curso. */
export function quienesCobraron(r: Resumen): string[] {
  return r.orden.slice(0, Math.max(0, r.ronda));
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
  if (!r) return { accion: null, motivo: "Leyendo la tanda en testnet…" };
  if (!yo) return { accion: null, motivo: "Conecta tu billetera para participar." };
  if (!r.miembros.includes(yo)) {
    return { accion: null, motivo: "Tu cuenta no está entre los miembros de esta tanda." };
  }

  const vigente = segundosRestantes(r, ahoraSegundos) > 0;

  switch (r.estado) {
    case "Inscripcion": {
      if (!r.unido) {
        return {
          accion: "unirse",
          motivo: "Firma tu inscripción. Cuando firmen todos, se sortea el orden de cobro.",
        };
      }
      const faltan = Math.max(0, r.miembros.length - r.inscritos);
      return {
        accion: null,
        motivo:
          faltan === 1
            ? "Ya firmaste. Falta 1 firma para que arranque la tanda."
            : `Ya firmaste. Faltan ${faltan} firmas para que arranque la tanda.`,
      };
    }

    case "Activa": {
      if (r.haPagado) {
        if (!vigente) {
          return {
            accion: "reclamar",
            motivo: "El plazo venció y la ronda no se completó. Puedes recuperar tu aporte.",
            aviso: "Si reclamas, la tanda se aborta para todos y nadie más cobra su pozo.",
          };
        }
        return {
          accion: null,
          motivo: "Ya aportaste esta ronda. Esperando a los demás.",
        };
      }
      if (!vigente) {
        return {
          accion: "aportar",
          motivo: "El plazo de esta ronda ya venció, pero nadie ha reclamado todavía.",
          aviso:
            "Si aportas ahora y la ronda no se completa, recuperarás tu aporte con Reclamar.",
        };
      }
      return { accion: "aportar", motivo: "Te toca aportar la cuota de esta ronda." };
    }

    case "Abortada": {
      if (r.yaDevuelto) {
        return { accion: null, motivo: "La tanda se abortó y ya recuperaste tu aporte." };
      }
      if (r.haPagado) {
        return { accion: "reclamar", motivo: "La tanda se abortó. Recupera tu aporte." };
      }
      return {
        accion: null,
        motivo: "La tanda se abortó. No aportaste esta ronda, así que no hay nada que reclamar.",
      };
    }

    case "Terminada":
      return { accion: null, motivo: "La tanda terminó: todos cobraron su pozo una vez." };
  }
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

const ERRORES: Record<number, string> = {
  1: "La lista de miembros no sirve: hacen falta al menos dos direcciones distintas.",
  2: "La cuota tiene que ser mayor que cero.",
  3: "El plazo tiene que ser mayor que cero.",
  4: "Tu cuenta no está entre los miembros de esta tanda.",
  5: "Esa cuenta ya firmó su inscripción.",
  6: "La inscripción ya cerró: la tanda está en marcha.",
  7: "La tanda todavía no arrancó: faltan firmas de inscripción.",
  8: "Esa cuenta ya aportó esta ronda.",
  9: "La tanda ya terminó o se abortó; no admite más aportes.",
  10: "Todavía no venció el plazo de esta ronda.",
  11: "Esa cuenta no aportó la ronda en curso, así que no tiene nada que reclamar.",
  12: "Ese aporte ya fue devuelto.",
  13: "El contrato no tiene configuración. ¿Seguro que ese ID es una tanda?",
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
    return "Cancelaste la firma en Freighter. No se movió nada.";
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
