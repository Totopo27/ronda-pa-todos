#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Vec,
};

const APORTE: i128 = 1_000_000_000; // 100 XLM en stroops
const DURACION: u64 = 86_400; // un día

struct Tanda {
    env: Env,
    id: Address,
    token: Address,
    /// Direcciones que el test usará para inscribirse. Viven en el test, no en
    /// el contrato: el contrato nace vacío y solo conoce a quien firma.
    candidatos: Vec<Address>,
    cupo: u32,
}

/// Monta una tanda de `cupo` lugares sin simular ninguna firma.
fn tanda_sin_firmas(cupo: u32) -> Tanda {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin).address();

    let mut candidatos = Vec::new(&env);
    for _ in 0..cupo {
        candidatos.push_back(Address::generate(&env));
    }

    let id = env.register(RondaPaTodos, (token.clone(), APORTE, DURACION, cupo, 1u32, 0u64));
    Tanda {
        env,
        id,
        token,
        candidatos,
        cupo,
    }
}

/// Monta una tanda con `aportes_por_turno` y `espera` configurables y fondos suficientes.
fn tanda_configurada(cupo: u32, aportes_por_turno: u32, espera: u64) -> Tanda {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin).address();

    let mut candidatos = Vec::new(&env);
    for _ in 0..cupo {
        candidatos.push_back(Address::generate(&env));
    }

    let id = env.register(
        RondaPaTodos,
        (
            token.clone(),
            APORTE,
            DURACION,
            cupo,
            aportes_por_turno,
            espera,
        ),
    );
    let emisor = StellarAssetClient::new(&env, &token);
    let fondeo = APORTE * ((cupo * aportes_por_turno + 4) as i128);
    for m in candidatos.iter() {
        emisor.mint(&m, &fondeo);
    }
    Tanda {
        env,
        id,
        token,
        candidatos,
        cupo,
    }
}

/// Monta una tanda con todas las firmas simuladas y los candidatos fondeados.
fn tanda(cupo: u32) -> Tanda {
    let t = tanda_sin_firmas(cupo);
    t.env.mock_all_auths();
    let emisor = StellarAssetClient::new(&t.env, &t.token);
    for m in t.candidatos.iter() {
        emisor.mint(&m, &(APORTE * 10));
    }
    t
}

impl Tanda {
    fn cliente(&self) -> RondaPaTodosClient<'_> {
        RondaPaTodosClient::new(&self.env, &self.id)
    }

    fn miembro(&self, i: u32) -> Address {
        self.candidatos.get(i).unwrap()
    }

    fn saldo(&self, quien: &Address) -> i128 {
        TokenClient::new(&self.env, &self.token).balance(quien)
    }

    /// Llena el cupo firmando en el orden de `candidatos`.
    fn inscribir_todos(&self) {
        let cliente = self.cliente();
        for i in 0..self.cupo {
            cliente.unirse(&self.miembro(i));
        }
    }
}

// --- Constructor -------------------------------------------------------

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn constructor_rechaza_cupo_menor_a_dos() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    env.register(RondaPaTodos, (token, APORTE, DURACION, 1u32, 1u32, 0u64));
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn constructor_rechaza_cupo_mayor_a_maximo() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    env.register(RondaPaTodos, (token, APORTE, DURACION, 51u32, 1u32, 0u64));
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn constructor_rechaza_aporte_invalido() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    env.register(RondaPaTodos, (token, 0i128, DURACION, 2u32, 1u32, 0u64));
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn constructor_rechaza_duracion_invalida() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    env.register(RondaPaTodos, (token, APORTE, 0u64, 2u32, 1u32, 0u64));
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn constructor_rechaza_duracion_menor_a_minima() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    env.register(RondaPaTodos, (token, APORTE, 59u64, 2u32, 1u32, 0u64));
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn constructor_rechaza_duracion_mayor_a_maxima() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    env.register(RondaPaTodos, (token, APORTE, 1_209_601u64, 2u32, 1u32, 0u64));
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn constructor_rechaza_aportes_por_turno_invalido() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    env.register(RondaPaTodos, (token, APORTE, DURACION, 2u32, 0u32, 0u64));
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn constructor_rechaza_aportes_por_turno_mayor_a_maximo() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    env.register(RondaPaTodos, (token, APORTE, DURACION, 2u32, 25u32, 0u64));
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn constructor_rechaza_espera_mayor_a_maxima() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    env.register(RondaPaTodos, (token, APORTE, DURACION, 2u32, 1u32, 1_209_601u64));
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn constructor_rechaza_overflow_pozo() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    env.register(RondaPaTodos, (token, i128::MAX, DURACION, 2u32, 2u32, 0u64));
}

// --- Inscripción -------------------------------------------------------

#[test]
fn unirse_sin_firma_falla() {
    let t = tanda_sin_firmas(3);
    let cliente = t.cliente();
    assert!(cliente.try_unirse(&t.miembro(0)).is_err());
}

#[test]
fn cualquier_wallet_ocupa_un_lugar_libre() {
    let t = tanda(3);
    let cliente = t.cliente();
    let ajeno = Address::generate(&t.env);

    assert_eq!(cliente.unirse(&ajeno), 1);
    assert_eq!(cliente.estado(), Estado::Inscripcion);
    assert_eq!(cliente.inscritos(), 1);
    assert_eq!(cliente.miembros().get(0).unwrap(), ajeno);
}

#[test]
fn no_se_puede_unir_dos_veces() {
    let t = tanda(3);
    let cliente = t.cliente();
    cliente.unirse(&t.miembro(0));
    assert_eq!(
        cliente.try_unirse(&t.miembro(0)),
        Err(Ok(Error::YaInscrito))
    );
}

#[test]
fn unirse_rechaza_cupo_lleno() {
    let t = tanda(2);
    let cliente = t.cliente();
    t.inscribir_todos();

    let tarde = Address::generate(&t.env);
    assert_eq!(
        cliente.try_unirse(&tarde),
        Err(Ok(Error::InscripcionCerrada))
    );
    assert_eq!(cliente.inscritos(), 2);
}

#[test]
fn el_ultimo_unirse_sortea_y_activa() {
    let t = tanda(3);
    let cliente = t.cliente();
    t.inscribir_todos();

    // `miembros` guarda el orden de llegada; `orden`, la permutación sorteada.
    let inscritos = cliente.miembros();
    assert_eq!(inscritos.len(), 3);
    for i in 0..3 {
        assert_eq!(inscritos.get(i).unwrap(), t.miembro(i));
    }

    assert_eq!(cliente.estado(), Estado::Activa);
    assert_eq!(cliente.inscritos(), 3);
    assert_eq!(cliente.ronda(), 0);

    // El sorteo solo se verifica por propiedades: es una permutación de la
    // lista original. En los tests el PRNG se siembra en cero, así que fijar
    // una secuencia concreta sería un test frágil.
    let orden = cliente.orden();
    assert_eq!(orden.len(), 3);
    for m in t.candidatos.iter() {
        assert!(orden.contains(&m));
    }
    assert_eq!(cliente.a_quien_toca(), Some(orden.get(0).unwrap()));
}

// --- Aportes -----------------------------------------------------------

#[test]
fn aportar_antes_de_llenar_el_cupo_falla() {
    let t = tanda(3);
    let cliente = t.cliente();
    cliente.unirse(&t.miembro(0));
    assert_eq!(
        cliente.try_aportar(&t.miembro(0)),
        Err(Ok(Error::NoActiva))
    );
}

#[test]
fn aporte_transfiere_al_contrato() {
    let t = tanda(3);
    let cliente = t.cliente();
    t.inscribir_todos();

    cliente.aportar(&t.miembro(0));

    assert_eq!(t.saldo(&t.id), APORTE);
    assert_eq!(t.saldo(&t.miembro(0)), APORTE * 9);
}

#[test]
fn no_se_puede_pagar_dos_veces_la_misma_ronda() {
    let t = tanda(3);
    let cliente = t.cliente();
    t.inscribir_todos();
    cliente.aportar(&t.miembro(0));
    assert_eq!(
        cliente.try_aportar(&t.miembro(0)),
        Err(Ok(Error::YaPago))
    );
}

#[test]
fn ronda_completa_paga_al_miembro_de_turno() {
    let t = tanda(3);
    let cliente = t.cliente();
    t.inscribir_todos();

    let receptor = cliente.orden().get(0).unwrap();
    let antes = t.saldo(&receptor);

    for i in 0..t.cupo {
        cliente.aportar(&t.miembro(i));
    }

    assert_eq!(cliente.ronda(), 1);
    assert_eq!(t.saldo(&receptor) - antes, APORTE * 2); // paga 1, cobra 3
    assert_eq!(t.saldo(&t.id), 0);
}

#[test]
fn tanda_completa_paga_a_todos_una_vez() {
    let t = tanda(3);
    let cliente = t.cliente();
    t.inscribir_todos();

    let inicial: Vec<i128> = {
        let mut v = Vec::new(&t.env);
        for i in 0..t.cupo {
            v.push_back(t.saldo(&t.miembro(i)));
        }
        v
    };

    for _ in 0..t.cupo {
        for i in 0..t.cupo {
            cliente.aportar(&t.miembro(i));
        }
    }

    assert_eq!(cliente.estado(), Estado::Terminada);
    assert_eq!(cliente.ronda(), 3);
    assert_eq!(t.saldo(&t.id), 0);
    // Cada miembro aportó 3 cuotas y cobró un pozo de 3 cuotas: queda igual.
    for i in 0..t.cupo {
        assert_eq!(t.saldo(&t.miembro(i)), inicial.get(i).unwrap());
    }
    assert!(cliente.terminada());
}

#[test]
fn aportar_despues_de_terminar_falla() {
    let t = tanda(3);
    let cliente = t.cliente();
    t.inscribir_todos();
    for _ in 0..t.cupo {
        for i in 0..t.cupo {
            cliente.aportar(&t.miembro(i));
        }
    }
    assert_eq!(
        cliente.try_aportar(&t.miembro(0)),
        Err(Ok(Error::TandaTerminada))
    );
}

// --- Devolución --------------------------------------------------------

#[test]
fn reclamar_antes_del_plazo_falla() {
    let t = tanda(3);
    let cliente = t.cliente();
    t.inscribir_todos();
    cliente.aportar(&t.miembro(0));
    assert_eq!(
        cliente.try_reclamar(&t.miembro(0)),
        Err(Ok(Error::PlazoVigente))
    );
}

#[test]
fn reclamar_devuelve_el_aporte_y_aborta() {
    let t = tanda(3);
    let cliente = t.cliente();
    t.inscribir_todos();
    cliente.aportar(&t.miembro(0));

    t.env.ledger().set_timestamp(DURACION + 1);
    let devuelto = cliente.reclamar(&t.miembro(0));
    assert_eq!(t.env.events().all().filter_by_contract(&t.id).events().len(), 1);

    assert_eq!(devuelto, APORTE);
    assert_eq!(t.saldo(&t.miembro(0)), APORTE * 10);
    assert_eq!(t.saldo(&t.id), 0);
    assert_eq!(cliente.estado(), Estado::Abortada);
    assert!(cliente.terminada());

    let visto = cliente.resumen(&Some(t.miembro(0)));
    assert!(visto.ya_devuelto);
    assert!(visto.ha_pagado);
    assert!(!cliente.resumen(&Some(t.miembro(1))).ya_devuelto);
}

#[test]
fn no_se_reclama_dos_veces() {
    let t = tanda(3);
    let cliente = t.cliente();
    t.inscribir_todos();
    cliente.aportar(&t.miembro(0));

    t.env.ledger().set_timestamp(DURACION + 1);
    cliente.reclamar(&t.miembro(0));

    assert_eq!(
        cliente.try_reclamar(&t.miembro(0)),
        Err(Ok(Error::YaDevuelto))
    );
}

// --- Lecturas ----------------------------------------------------------

#[test]
fn ha_pagado_refleja_la_ronda() {
    let t = tanda(3);
    let cliente = t.cliente();
    t.inscribir_todos();

    assert!(!cliente.ha_pagado(&t.miembro(0)));
    cliente.aportar(&t.miembro(0));
    assert!(cliente.ha_pagado(&t.miembro(0)));
    assert!(!cliente.ha_pagado(&t.miembro(1)));
}

#[test]
fn resumen_durante_la_inscripcion() {
    let t = tanda(3);
    let cliente = t.cliente();
    cliente.unirse(&t.miembro(0));

    let sin_miembro = cliente.resumen(&None);
    assert_eq!(sin_miembro.estado, Estado::Inscripcion);
    assert_eq!(sin_miembro.cupo, 3);
    assert_eq!(sin_miembro.inscritos, 1);
    assert_eq!(sin_miembro.miembros.len(), 1);
    assert_eq!(sin_miembro.ronda, 0);
    assert_eq!(sin_miembro.inicio, 0);
    assert_eq!(sin_miembro.orden.len(), 0);
    assert_eq!(sin_miembro.a_quien_toca, None);
    assert!(!sin_miembro.unido);
    assert!(!sin_miembro.ha_pagado);
    assert!(!sin_miembro.ya_devuelto);
    assert_eq!(sin_miembro.token, Some(t.token.clone()));
    assert_eq!(sin_miembro.aporte, APORTE);
    assert_eq!(sin_miembro.duracion, DURACION);

    let firmo = cliente.resumen(&Some(t.miembro(0)));
    assert!(firmo.unido);
    assert!(!cliente.resumen(&Some(t.miembro(1))).unido);
}

#[test]
fn resumen_durante_las_rondas() {
    let t = tanda(3);
    let cliente = t.cliente();
    t.inscribir_todos();
    let orden = cliente.orden();

    let activa = cliente.resumen(&Some(t.miembro(0)));
    assert_eq!(activa.estado, Estado::Activa);
    assert_eq!(activa.cupo, 3);
    assert_eq!(activa.orden, orden);
    assert_eq!(activa.a_quien_toca, Some(orden.get(0).unwrap()));
    assert!(activa.inscritos == 3);
    assert!(activa.unido);

    cliente.aportar(&t.miembro(0));
    let tras_uno = cliente.resumen(&Some(t.miembro(0)));
    assert_eq!(tras_uno.ronda, 0);
    assert!(tras_uno.ha_pagado);
    assert!(!cliente.resumen(&Some(t.miembro(1))).ha_pagado);

    cliente.aportar(&t.miembro(1));
    cliente.aportar(&t.miembro(2));
    let siguiente = cliente.resumen(&None);
    assert_eq!(siguiente.ronda, 1);
    assert_eq!(siguiente.a_quien_toca, Some(orden.get(1).unwrap()));
    assert!(!siguiente.ha_pagado);
}

#[test]
fn resumen_marca_la_tanda_terminada() {
    let t = tanda(2);
    let cliente = t.cliente();
    t.inscribir_todos();
    for _ in 0..2 {
        cliente.aportar(&t.miembro(0));
        cliente.aportar(&t.miembro(1));
    }

    let fin = cliente.resumen(&Some(t.miembro(0)));
    assert_eq!(fin.estado, Estado::Terminada);
    assert_eq!(fin.ronda, 2);
    assert_eq!(fin.a_quien_toca, None);
}

#[test]
fn eventos_se_emiten_durante_ciclo() {
    let t = tanda(2);
    let cliente = t.cliente();

    // Evento al unirse el primer miembro: EventoUnido
    cliente.unirse(&t.miembro(0));
    let ev1 = t.env.events().all().filter_by_contract(&t.id);
    assert_eq!(ev1.events().len(), 1);

    // Evento al llenar cupo: EventoUnido + EventoIniciada
    cliente.unirse(&t.miembro(1));
    let ev2 = t.env.events().all().filter_by_contract(&t.id);
    assert_eq!(ev2.events().len(), 2);

    // Evento al aportar primer miembro: EventoAporte
    cliente.aportar(&t.miembro(0));
    let ev3 = t.env.events().all().filter_by_contract(&t.id);
    assert_eq!(ev3.events().len(), 1);

    // Evento al completar ronda 0: EventoAporte + EventoPozo
    cliente.aportar(&t.miembro(1));
    let ev4 = t.env.events().all().filter_by_contract(&t.id);
    assert_eq!(ev4.events().len(), 2);

    // Ronda 1: primer aporte
    cliente.aportar(&t.miembro(0));
    let ev5 = t.env.events().all().filter_by_contract(&t.id);
    assert_eq!(ev5.events().len(), 1);

    // Ronda 1: segundo aporte que completa la tanda: EventoAporte + EventoPozo + EventoFin
    cliente.aportar(&t.miembro(1));
    let ev6 = t.env.events().all().filter_by_contract(&t.id);
    assert_eq!(ev6.events().len(), 3);
}

// --- Periodo y frecuencia configurables --------------------------------

#[test]
fn multiples_aportes_por_turno_acumulan_y_pagan_pozo_completo() {
    let t = tanda_configurada(3, 4, 0);
    let cliente = t.cliente();
    t.inscribir_todos();

    let inicial: Vec<i128> = {
        let mut v = Vec::new(&t.env);
        for i in 0..t.cupo {
            v.push_back(t.saldo(&t.miembro(i)));
        }
        v
    };

    let orden = cliente.orden();
    let receptor0 = orden.get(0).unwrap();
    let antes_receptor0 = t.saldo(&receptor0);

    // Pasos 0..2 del turno 0: solo acumulan en el contrato.
    for paso in 0..3 {
        for i in 0..t.cupo {
            cliente.aportar(&t.miembro(i));
        }
        assert_eq!(cliente.ronda(), 0);
        assert_eq!(cliente.resumen(&None).paso, paso + 1);
        assert_eq!(t.saldo(&t.id), APORTE * 3 * ((paso + 1) as i128));
    }

    // Paso 3 del turno 0: completa 12 cuotas y entrega la buchaca grande.
    for i in 0..t.cupo {
        cliente.aportar(&t.miembro(i));
    }
    assert_eq!(cliente.ronda(), 1);
    assert_eq!(cliente.resumen(&None).paso, 0);
    assert_eq!(t.saldo(&t.id), 0);
    // Receptor 0 puso 4 cuotas y recibió 12 cuotas -> neto +8 cuotas.
    assert_eq!(t.saldo(&receptor0) - antes_receptor0, APORTE * 8);

    // Turnos 1 y 2 completan la ronda entera.
    for _turno in 1..t.cupo {
        for _paso in 0..4 {
            for i in 0..t.cupo {
                cliente.aportar(&t.miembro(i));
            }
        }
    }

    assert_eq!(cliente.estado(), Estado::Terminada);
    assert_eq!(cliente.ronda(), 3);
    assert_eq!(t.saldo(&t.id), 0);
    for i in 0..t.cupo {
        assert_eq!(t.saldo(&t.miembro(i)), inicial.get(i).unwrap());
    }
}

#[test]
fn reclamar_devuelve_todos_los_aportes_del_turno_incompleto() {
    let t = tanda_configurada(3, 3, 0);
    let cliente = t.cliente();
    t.inscribir_todos();

    // Paso 0 completo (todos aportan 1 vez).
    for i in 0..t.cupo {
        cliente.aportar(&t.miembro(i));
    }
    // En paso 1 solo aporta el miembro 0.
    cliente.aportar(&t.miembro(0));
    assert_eq!(cliente.resumen(&Some(t.miembro(0))).aportes_miembro, 2);
    assert_eq!(cliente.resumen(&Some(t.miembro(1))).aportes_miembro, 1);

    t.env.ledger().set_timestamp(DURACION + 1);

    assert_eq!(cliente.reclamar(&t.miembro(0)), APORTE * 2);
    assert_eq!(cliente.reclamar(&t.miembro(1)), APORTE);
    assert_eq!(cliente.reclamar(&t.miembro(2)), APORTE);
    assert_eq!(t.saldo(&t.id), 0);
    assert_eq!(cliente.estado(), Estado::Abortada);
}

#[test]
fn espera_bloquea_siguiente_aporte_hasta_apertura() {
    let espera = 3_600u64;
    let t = tanda_configurada(2, 2, espera);
    let cliente = t.cliente();
    t.inscribir_todos();

    // Paso 0 abierto de inmediato en t = 0.
    cliente.aportar(&t.miembro(0));
    cliente.aportar(&t.miembro(1));

    let tras_paso0 = cliente.resumen(&Some(t.miembro(0)));
    assert_eq!(tras_paso0.paso, 1);
    assert_eq!(tras_paso0.apertura, espera);
    assert_eq!(tras_paso0.inicio, espera);

    // Antes de `espera`, aportar falla con #16 y reclamar falla con #10.
    t.env.ledger().set_timestamp(espera - 1);
    assert_eq!(
        cliente.try_aportar(&t.miembro(0)),
        Err(Ok(Error::AporteAunNoAbierto))
    );
    assert_eq!(
        cliente.try_reclamar(&t.miembro(0)),
        Err(Ok(Error::PlazoVigente))
    );

    // Al llegar a `espera`, abre el paso 1.
    t.env.ledger().set_timestamp(espera);
    cliente.aportar(&t.miembro(0));

    // El plazo límite corre desde `inicio = espera`, no desde 0.
    t.env.ledger().set_timestamp(espera + DURACION - 1);
    assert_eq!(
        cliente.try_reclamar(&t.miembro(0)),
        Err(Ok(Error::PlazoVigente))
    );

    t.env.ledger().set_timestamp(espera + DURACION);
    assert_eq!(cliente.reclamar(&t.miembro(0)), APORTE * 2);
}

#[test]
fn resumen_expone_campos_de_periodo() {
    let t = tanda_configurada(2, 4, 600);
    let cliente = t.cliente();

    let antes = cliente.resumen(&None);
    assert_eq!(antes.aportes_por_turno, 4);
    assert_eq!(antes.paso, 0);
    assert_eq!(antes.espera, 600);
    assert_eq!(antes.apertura, 0);
    assert_eq!(antes.aportes_miembro, 0);

    t.inscribir_todos();
    cliente.aportar(&t.miembro(0));

    let tras = cliente.resumen(&Some(t.miembro(0)));
    assert_eq!(tras.aportes_por_turno, 4);
    assert_eq!(tras.paso, 0);
    assert_eq!(tras.espera, 600);
    assert_eq!(tras.aportes_miembro, 1);
    assert!(tras.ha_pagado);
}
