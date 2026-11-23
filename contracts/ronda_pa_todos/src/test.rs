#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
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

    let id = env.register(RondaPaTodos, (token.clone(), APORTE, DURACION, cupo));
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
    env.register(RondaPaTodos, (token, APORTE, DURACION, 1u32));
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn constructor_rechaza_aporte_invalido() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    env.register(RondaPaTodos, (token, 0i128, DURACION, 2u32));
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn constructor_rechaza_duracion_invalida() {
    let env = Env::default();
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    env.register(RondaPaTodos, (token, APORTE, 0u64, 2u32));
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
