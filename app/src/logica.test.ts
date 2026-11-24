import { describe, expect, it } from "vitest";
import {
  acortarDireccion,
  codigoDeError,
  describirError,
  enlaceFriendbot,
  entregaDeRondaCerrada,
  entregasRealizadas,
  formatearDuracion,
  formatearImporte,
  montoPozo,
  normalizarResumen,
  quienesCobraron,
  segundosRestantes,
  sugerirAccion,
  traducirError,
  type Resumen,
} from "./logica";

const ANA = "GAYXYLJ2PKC7O7UFHXBY5J7MSEZV6BCOSDNK6MLA7RSBPLE72JJWOC2W";
const BETO = "GCI73NJYPATAAI24BHEMUMRO4D537CIRYS34EP6MTXF6JG5RH3K3PXBQ";
const CAROL = "GAINYKYCTCTDO5N2KSTMY5334PEGZI2AHMA2SDNRFY2UMRKKZVHN7FEE";

function tanda(cambios: Partial<Resumen> = {}): Resumen {
  return {
    token: null,
    estado: "Activa",
    ronda: 0,
    miembros: [ANA, BETO, CAROL],
    orden: [CAROL, ANA, BETO],
    aporte: 10_0000000n,
    duracion: 600n,
    cupo: 3,
    inscritos: 3,
    inicio: 1000n,
    aQuienToca: CAROL,
    unido: true,
    haPagado: false,
    yaDevuelto: false,
    ...cambios,
  };
}

describe("normalizarResumen", () => {
  it("convierte los enums y los enteros que devuelve el SDK", () => {
    const r = normalizarResumen({
      token: "CDLZ",
      estado: { tag: "Activa" },
      ronda: 1,
      miembros: [ANA],
      orden: [ANA],
      aporte: 1_0000000n,
      duracion: 600n,
      cupo: 3,
      inscritos: 1,
      inicio: 42n,
      a_quien_toca: ANA,
      unido: true,
      ha_pagado: true,
      ya_devuelto: false,
    });

    expect(r.estado).toBe("Activa");
    expect(r.aporte).toBe(1_0000000n);
    expect(r.cupo).toBe(3);
    expect(r.inicio).toBe(42n);
    expect(r.aQuienToca).toBe(ANA);
    expect(r.haPagado).toBe(true);
    expect(r.yaDevuelto).toBe(false);
  });

  it("acepta el estado como texto y rellena los campos ausentes", () => {
    const r = normalizarResumen({ estado: "Terminada" });

    expect(r.estado).toBe("Terminada");
    expect(r.miembros).toEqual([]);
    expect(r.orden).toEqual([]);
    expect(r.inicio).toBe(0n);
    expect(r.aQuienToca).toBeNull();
    expect(r.token).toBeNull();
  });
});

describe("sugerirAccion", () => {
  it("pide conectar cuando no hay billetera", () => {
    expect(sugerirAccion(tanda(), null, 1000).accion).toBeNull();
    expect(sugerirAccion(tanda(), null, 1000).motivo).toMatch(/Conecta/i);
  });

  it("no ofrece nada a quien no es miembro", () => {
    const r = sugerirAccion(tanda(), "GOTRA", 1000);
    expect(r.accion).toBeNull();
    expect(r.motivo).toMatch(/no está entre los miembros/i);
  });

  it("ofrece firmar la inscripción mientras está abierta", () => {
    const r = sugerirAccion(tanda({ estado: "Inscripcion", unido: false, orden: [] }), ANA, 0);
    expect(r.accion).toBe("unirse");
  });

  it("ofrece inscribirse a una cuenta que no está en ninguna lista", () => {
    const r = sugerirAccion(
      tanda({ estado: "Inscripcion", unido: false, orden: [], miembros: [], inscritos: 0 }),
      "GOTRA",
      0,
    );
    expect(r.accion).toBe("unirse");
    expect(r.motivo).toMatch(/ocupa un lugar/i);
  });

  it("cuenta los lugares que faltan cuando ya estoy dentro", () => {
    const r = sugerirAccion(
      tanda({ estado: "Inscripcion", unido: true, inscritos: 2, cupo: 3 }),
      ANA,
      0,
    );
    expect(r.accion).toBeNull();
    expect(r.motivo).toMatch(/falta 1 firma/i);
  });

  it("pide aportar dentro del plazo", () => {
    const r = sugerirAccion(tanda(), ANA, 1200);
    expect(r.accion).toBe("aportar");
    expect(r.motivo).toMatch(/falta tu aporte/i);
  });

  it("avisa cuando se aporta con el plazo vencido", () => {
    const r = sugerirAccion(tanda(), ANA, 5000);
    expect(r.accion).toBe("aportar");
    expect(r.motivo).toMatch(/venció/i);
    expect(r.aviso).toBeDefined();
  });

  it("no ofrece aportar de nuevo en la misma ronda", () => {
    const r = sugerirAccion(tanda({ haPagado: true }), ANA, 1200);
    expect(r.accion).toBeNull();
    expect(r.motivo).toMatch(/Ya aportaste/i);
  });

  it("ofrece reclamar cuando pagué y venció el plazo", () => {
    const r = sugerirAccion(tanda({ haPagado: true }), ANA, 5000);
    expect(r.accion).toBe("reclamar");
    expect(r.aviso).toMatch(/aborta/i);
  });

  it("ofrece reclamar tras abortar si no me devolvieron", () => {
    const r = sugerirAccion(tanda({ estado: "Abortada", haPagado: true }), ANA, 5000);
    expect(r.accion).toBe("reclamar");
  });

  it("no ofrece reclamar dos veces", () => {
    const r = sugerirAccion(tanda({ estado: "Abortada", haPagado: true, yaDevuelto: true }), ANA, 5000);
    expect(r.accion).toBeNull();
    expect(r.motivo).toMatch(/ya recuperaste/i);
  });

  it("cierra la conversación cuando la tanda terminó", () => {
    const r = sugerirAccion(tanda({ estado: "Terminada", ronda: 3 }), ANA, 9999);
    expect(r.accion).toBeNull();
    expect(r.motivo).toMatch(/terminó/i);
  });
});

describe("quienesCobraron", () => {
  it("nadie ha cobrado en la primera ronda", () => {
    expect(quienesCobraron(tanda({ ronda: 0 }))).toEqual([]);
  });

  it("cobraron los que ya pasaron por el orden", () => {
    expect(quienesCobraron(tanda({ ronda: 2 }))).toEqual([CAROL, ANA]);
  });

  it("no inventa cobros si la ronda no cuadra con el orden", () => {
    expect(quienesCobraron(tanda({ ronda: 9 }))).toEqual([CAROL, ANA, BETO]);
  });
});

describe("entregas de pozo", () => {
  it("calcula el pozo completo de la ronda en bigint", () => {
    expect(montoPozo(tanda())).toBe(30_0000000n);
    expect(montoPozo(tanda({ cupo: 0 }))).toBe(0n);
  });

  it("lista los pozos entregados con ronda, receptor, monto y aportes", () => {
    expect(entregasRealizadas(tanda({ ronda: 0 }))).toEqual([]);
    expect(entregasRealizadas(tanda({ ronda: 2 }))).toEqual([
      { ronda: 1, receptor: CAROL, monto: 30_0000000n, aportes: 3 },
      { ronda: 2, receptor: ANA, monto: 30_0000000n, aportes: 3 },
    ]);
    expect(entregasRealizadas(tanda({ estado: "Terminada", ronda: 3 }))).toEqual([
      { ronda: 1, receptor: CAROL, monto: 30_0000000n, aportes: 3 },
      { ronda: 2, receptor: ANA, monto: 30_0000000n, aportes: 3 },
      { ronda: 3, receptor: BETO, monto: 30_0000000n, aportes: 3 },
    ]);
  });

  it("detecta cuando una ronda se cerró entre dos lecturas", () => {
    const r0 = tanda({ ronda: 0, aQuienToca: CAROL });
    const r1 = tanda({ ronda: 1, aQuienToca: ANA });
    const fin = tanda({ estado: "Terminada", ronda: 3, aQuienToca: null });

    expect(entregaDeRondaCerrada(null, r0)).toBeNull();
    expect(entregaDeRondaCerrada(r0, r0)).toBeNull();
    expect(entregaDeRondaCerrada(r0, r1)).toEqual({
      ronda: 1,
      receptor: CAROL,
      monto: 30_0000000n,
      aportes: 3,
    });
    expect(entregaDeRondaCerrada(tanda({ ronda: 2 }), fin)).toEqual({
      ronda: 3,
      receptor: BETO,
      monto: 30_0000000n,
      aportes: 3,
    });
  });
});

describe("formatearImporte", () => {
  it("quita los ceros sobrantes", () => {
    expect(formatearImporte(10_0000000n, 7)).toBe("10");
    expect(formatearImporte(1_5000000n, 7)).toBe("1.5");
    expect(formatearImporte(0n, 7)).toBe("0");
    expect(formatearImporte(1n, 7)).toBe("0.0000001");
  });

  it("respeta los decimales de otro token", () => {
    expect(formatearImporte(1234n, 2)).toBe("12.34");
  });
});

describe("plazo", () => {
  it("cuenta lo que falta y nunca baja de cero", () => {
    expect(segundosRestantes(tanda(), 1300)).toBe(300);
    expect(segundosRestantes(tanda(), 5000)).toBe(0);
  });

  it("no cuenta nada si la tanda no arrancó", () => {
    expect(segundosRestantes(tanda({ inicio: 0n }), 5000)).toBe(0);
  });

  it("formatea en unidades legibles", () => {
    expect(formatearDuracion(0)).toBe("0 s");
    expect(formatearDuracion(45)).toBe("45 s");
    expect(formatearDuracion(90)).toBe("1 min 30 s");
    expect(formatearDuracion(3600)).toBe("1 h 0 min");
    expect(formatearDuracion(90000)).toBe("1 d 1 h");
  });
});

describe("errores", () => {
  it("lee el código del mensaje del host", () => {
    expect(codigoDeError('Transaction simulation failed: "HostError: Error(Contract, #10)"')).toBe(10);
    expect(codigoDeError('HostError: Error(Contract, #7)')).toBe(7);
    expect(codigoDeError("network timeout")).toBeNull();
  });

  it("traduce los trece códigos del contrato", () => {
    for (let codigo = 1; codigo <= 13; codigo++) {
      expect(traducirError(codigo)).not.toMatch(/Error del contrato/);
    }
    expect(traducirError(10)).toMatch(/plazo/i);
    expect(traducirError(12)).toMatch(/devuelto/i);
    expect(traducirError(99)).toMatch(/código 99/);
  });

  it("distingue un rechazo del usuario de un fallo de red", () => {
    expect(describirError("User declined access")).toMatch(/Cancelaste/i);
    expect(describirError("fetch failed")).toMatch(/RPC de testnet/i);
    expect(describirError('HostError: Error(Contract, #8)')).toMatch(/ya aportó/i);
    expect(describirError("algo rarísimo")).toBe("algo rarísimo");
  });

  it("envía a Friendbot cuando faltan fondos de testnet", () => {
    expect(describirError("insufficient balance")).toMatch(/Pide fondos en testnet/i);
  });
});

describe("acortarDireccion", () => {
  it("deja las puntas visibles", () => {
    expect(acortarDireccion(ANA)).toBe("GAYX…OC2W");
  });

  it("no toca lo que ya es corto", () => {
    expect(acortarDireccion("GABC")).toBe("GABC");
  });
});

describe("enlaceFriendbot", () => {
  it("abre Friendbot con la cuenta conectada", () => {
    expect(enlaceFriendbot(ANA)).toBe(`https://friendbot.stellar.org/?addr=${ANA}`);
  });

  it("no permite romper el atributo href de Friendbot", () => {
    const u = enlaceFriendbot(`G\"><script>alert(1)</script>`);
    expect(u).toMatch(/^https:\/\/friendbot\.stellar\.org\/\?addr=/);
    expect(u.slice("https://friendbot.stellar.org/?addr=".length)).not.toMatch(/[<>"\s]/);
  });
});
