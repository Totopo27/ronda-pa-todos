#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, Vec,
};

/// Umbral y destino del TTL de los datos persistentes, en ledgers (~5 s cada uno).
/// 100 000 ledgers ≈ 6 días; 500 000 ≈ 29 días.
const TTL_UMBRAL: u32 = 100_000;
const TTL_VIDA: u32 = 500_000;

/// Límites del cupo, aportes y duración por ronda para asegurar integridad y evitar expiración de TTL.
pub const MIN_CUPO: u32 = 2;
pub const MAX_CUPO: u32 = 50;
pub const MIN_DURACION: u64 = 60; // 1 minuto (permite pruebas y demostraciones en testnet)
pub const MAX_DURACION: u64 = 1_209_600; // 14 días (holgadamente dentro de los ~29 días de TTL)
pub const MIN_APORTES_POR_TURNO: u32 = 1;
pub const MAX_APORTES_POR_TURNO: u32 = 24;
pub const MAX_ESPERA: u64 = 1_209_600; // 14 días entre aportes dentro de los ~29 días de TTL

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventoUnido {
    pub miembro: Address,
    pub inscritos: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventoIniciada {
    pub cupo: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventoAporte {
    pub miembro: Address,
    pub ronda: u32,
    pub aporte: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventoPozo {
    pub receptor: Address,
    pub ronda: u32,
    pub pozo: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventoFin {
    pub rondas: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventoReclamado {
    pub miembro: Address,
    pub ronda: u32,
    pub aporte: i128,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Estado {
    /// Se están ocupando los lugares del cupo. Nadie ha aportado.
    Inscripcion,
    /// Orden sorteado. Rondas en curso.
    Activa,
    /// Todos cobraron exactamente una vez.
    Terminada,
    /// Alguien reclamó su devolución tras vencer el plazo.
    Abortada,
}

/// Todo el estado que necesita una interfaz, en una sola lectura y en un solo
/// instante. Doce llamadas sueltas darían doce fotos distintas.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Resumen {
    pub token: Option<Address>,
    pub estado: Estado,
    pub ronda: u32,
    pub miembros: Vec<Address>,
    pub orden: Vec<Address>,
    pub aporte: i128,
    pub duracion: u64,
    /// Cuántos lugares tiene la tanda. Se fija al desplegar.
    pub cupo: u32,
    pub inscritos: u32,
    pub inicio: u64,
    pub a_quien_toca: Option<Address>,
    /// Si el `miembro` consultado ya firmó su inscripción.
    pub unido: bool,
    /// Si el `miembro` consultado ya aportó en el periodo actual.
    pub ha_pagado: bool,
    /// Si el `miembro` consultado ya recuperó sus aportes del turno en curso.
    pub ya_devuelto: bool,
    /// Cuántos aportes por miembro reúne cada turno antes de entregar la buchaca.
    pub aportes_por_turno: u32,
    /// Sub-periodo actual dentro del turno (`0..aportes_por_turno - 1`).
    pub paso: u32,
    /// Segundos de espera tras completarse un grupo de aportes antes de abrir el siguiente.
    pub espera: u64,
    /// Timestamp de apertura del aporte en curso (`0` antes de activar).
    pub apertura: u64,
    /// Cuántos aportes lleva `miembro` acumulados en el turno en curso.
    pub aportes_miembro: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    /// Quienes ya ocuparon un lugar, en el orden en que firmaron.
    Miembros,
    Orden,
    Aporte,
    Duracion,
    /// Cuántos lugares hay en total.
    Cupo,
    AportesPorTurno,
    Espera,
    Estado,
    Ronda,
    Paso,
    Inicio,
    Apertura,
    Unido(Address),
    /// Guarda `ciclo + 1` (`ciclo = ronda * aportes_por_turno + paso`); 0 significa "nunca pagó".
    Pagado(Address),
    /// Guarda `ronda + 1`; 0 significa "nunca reclamó".
    Devuelto(Address),
    /// Cuántos miembros han aportado en el sub-periodo en curso.
    PagadosEnRonda,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    CupoInvalido = 1,
    AporteInvalido = 2,
    DuracionInvalida = 3,
    NoEsMiembro = 4,
    YaInscrito = 5,
    InscripcionCerrada = 6,
    NoActiva = 7,
    YaPago = 8,
    TandaTerminada = 9,
    PlazoVigente = 10,
    NoHaPagado = 11,
    YaDevuelto = 12,
    NoConfigurado = 13,
    AportesPorTurnoInvalido = 14,
    EsperaInvalida = 15,
    AporteAunNoAbierto = 16,
}

#[contract]
pub struct RondaPaTodos;

#[contractimpl]
impl RondaPaTodos {
    /// Fija las reglas de la tanda. Después de esto nadie puede cambiarlas:
    /// el contrato no tiene admin.
    ///
    /// El contrato nace sin miembros: se despliega con un cupo y cada wallet
    /// ocupa un lugar firmando `unirse`.
    pub fn __constructor(
        env: Env,
        token: Address,
        aporte: i128,
        duracion: u64,
        cupo: u32,
        aportes_por_turno: u32,
        espera: u64,
    ) -> Result<(), Error> {
        if cupo < MIN_CUPO || cupo > MAX_CUPO {
            return Err(Error::CupoInvalido);
        }
        if aporte <= 0 {
            return Err(Error::AporteInvalido);
        }
        if duracion < MIN_DURACION || duracion > MAX_DURACION {
            return Err(Error::DuracionInvalida);
        }
        if aportes_por_turno < MIN_APORTES_POR_TURNO || aportes_por_turno > MAX_APORTES_POR_TURNO {
            return Err(Error::AportesPorTurnoInvalido);
        }
        if espera > MAX_ESPERA {
            return Err(Error::EsperaInvalida);
        }
        let total_cuotas = (cupo as i128)
            .checked_mul(aportes_por_turno as i128)
            .ok_or(Error::AporteInvalido)?;
        aporte
            .checked_mul(total_cuotas)
            .ok_or(Error::AporteInvalido)?;

        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Cupo, &cupo);
        env.storage().instance().set(&DataKey::Aporte, &aporte);
        env.storage().instance().set(&DataKey::Duracion, &duracion);
        env.storage()
            .instance()
            .set(&DataKey::AportesPorTurno, &aportes_por_turno);
        env.storage().instance().set(&DataKey::Espera, &espera);
        env.storage().instance().set(&DataKey::Estado, &Estado::Inscripcion);
        env.storage().instance().set(&DataKey::Ronda, &0u32);
        env.storage().instance().set(&DataKey::Paso, &0u32);
        env.storage().instance().set(&DataKey::PagadosEnRonda, &0u32);
        env.storage().instance().set(&DataKey::Apertura, &0u64);
        env.storage().instance().extend_ttl(TTL_UMBRAL, TTL_VIDA);
        Ok(())
    }

    /// Cualquier wallet firma su propia inscripción y ocupa un lugar. Cuando se
    /// llena el cupo, la última firma sortea el orden de cobro y arranca la
    /// tanda. El contrato no distingue invitados de desconocidos: quien llega
    /// primero con el enlace, entra.
    pub fn unirse(env: Env, miembro: Address) -> Result<u32, Error> {
        miembro.require_auth();

        if leer_estado(&env) != Estado::Inscripcion {
            return Err(Error::InscripcionCerrada);
        }
        let clave = DataKey::Unido(miembro.clone());
        if env.storage().persistent().get(&clave).unwrap_or(false) {
            return Err(Error::YaInscrito);
        }

        env.storage().persistent().set(&clave, &true);
        env.storage().persistent().extend_ttl(&clave, TTL_UMBRAL, TTL_VIDA);

        let mut miembros = leer_miembros(&env);
        miembros.push_back(miembro.clone());
        env.storage().instance().set(&DataKey::Miembros, &miembros);

        let inscritos = miembros.len();
        let cupo = leer_u32(&env, &DataKey::Cupo);
        if inscritos == cupo {
            let mut orden = miembros.clone();
            env.prng().shuffle(&mut orden);
            let ahora = env.ledger().timestamp();
            env.storage().instance().set(&DataKey::Orden, &orden);
            env.storage().instance().set(&DataKey::Estado, &Estado::Activa);
            env.storage().instance().set(&DataKey::Ronda, &0u32);
            env.storage().instance().set(&DataKey::Paso, &0u32);
            env.storage().instance().set(&DataKey::PagadosEnRonda, &0u32);
            env.storage().instance().set(&DataKey::Inicio, &ahora);
            env.storage().instance().set(&DataKey::Apertura, &ahora);
        }
        env.storage().instance().extend_ttl(TTL_UMBRAL, TTL_VIDA);

        EventoUnido {
            miembro: miembro.clone(),
            inscritos,
        }
        .publish(&env);
        if inscritos == cupo {
            EventoIniciada { cupo }.publish(&env);
        }

        Ok(inscritos)
    }

    /// Aporta la cuota del periodo actual. Cuando se completan todos los aportes
    /// requeridos del turno (`cupo × aportes_por_turno`), el pozo completo va al
    /// miembro de turno según el orden sorteado.
    pub fn aportar(env: Env, miembro: Address) -> Result<u32, Error> {
        miembro.require_auth();

        match leer_estado(&env) {
            Estado::Activa => {}
            Estado::Inscripcion => return Err(Error::NoActiva),
            _ => return Err(Error::TandaTerminada),
        }
        if !pertenece(&env, &miembro) {
            return Err(Error::NoEsMiembro);
        }

        let ahora = env.ledger().timestamp();
        if ahora < leer_u64(&env, &DataKey::Apertura) {
            return Err(Error::AporteAunNoAbierto);
        }

        let ronda = leer_u32(&env, &DataKey::Ronda);
        let paso = leer_u32(&env, &DataKey::Paso);
        let aportes_por_turno = leer_aportes_por_turno(&env);
        let ciclo = ronda * aportes_por_turno + paso;
        if pago_de(&env, &miembro) == ciclo + 1 {
            return Err(Error::YaPago);
        }

        let token = leer_token(&env)?;
        let aporte = leer_aporte(&env);
        let cupo = leer_u32(&env, &DataKey::Cupo);

        // CHECKS completados. Ahora EFFECTS (mutaciones de storage antes de llamadas externas)
        let clave = DataKey::Pagado(miembro.clone());
        env.storage().persistent().set(&clave, &(ciclo + 1));
        env.storage().persistent().extend_ttl(&clave, TTL_UMBRAL, TTL_VIDA);

        let pagaron = env
            .storage()
            .instance()
            .get(&DataKey::PagadosEnRonda)
            .unwrap_or(0u32)
            + 1;

        if pagaron < cupo {
            env.storage()
                .instance()
                .set(&DataKey::PagadosEnRonda, &pagaron);
            env.storage().instance().extend_ttl(TTL_UMBRAL, TTL_VIDA);

            // INTERACTIONS
            token::Client::new(&env, &token).transfer(
                &miembro,
                &env.current_contract_address(),
                &aporte,
            );

            // EVENTS
            EventoAporte {
                miembro,
                ronda,
                aporte,
            }
            .publish(&env);

            return Ok(ronda);
        }

        let espera = leer_u64(&env, &DataKey::Espera);
        let nueva_apertura = ahora + espera;

        if paso + 1 < aportes_por_turno {
            // Sub-periodo completo; el turno sigue acumulando aportes.
            env.storage().instance().set(&DataKey::Paso, &(paso + 1));
            env.storage()
                .instance()
                .set(&DataKey::PagadosEnRonda, &0u32);
            env.storage()
                .instance()
                .set(&DataKey::Apertura, &nueva_apertura);
            env.storage()
                .instance()
                .set(&DataKey::Inicio, &nueva_apertura);
            env.storage().instance().extend_ttl(TTL_UMBRAL, TTL_VIDA);

            // INTERACTIONS
            token::Client::new(&env, &token).transfer(
                &miembro,
                &env.current_contract_address(),
                &aporte,
            );

            // EVENTS
            EventoAporte {
                miembro,
                ronda,
                aporte,
            }
            .publish(&env);

            return Ok(ronda);
        }

        // Turno completo: actualizar estado completo primero (CEI)
        let orden: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Orden)
            .ok_or(Error::NoConfigurado)?;
        let receptor = orden.get(ronda).ok_or(Error::NoConfigurado)?;
        let pozo = aporte * (cupo as i128) * (aportes_por_turno as i128);

        let siguiente = ronda + 1;
        env.storage().instance().set(&DataKey::Ronda, &siguiente);
        env.storage().instance().set(&DataKey::Paso, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::PagadosEnRonda, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::Apertura, &nueva_apertura);
        env.storage()
            .instance()
            .set(&DataKey::Inicio, &nueva_apertura);
        if siguiente == cupo {
            env.storage().instance().set(&DataKey::Estado, &Estado::Terminada);
        }
        env.storage().instance().extend_ttl(TTL_UMBRAL, TTL_VIDA);

        // INTERACTIONS (efectuadas al final, tras congelar el estado):
        token::Client::new(&env, &token).transfer(
            &miembro,
            &env.current_contract_address(),
            &aporte,
        );
        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &receptor,
            &pozo,
        );

        // EVENTS
        EventoAporte {
            miembro,
            ronda,
            aporte,
        }
        .publish(&env);
        EventoPozo {
            receptor,
            ronda,
            pozo,
        }
        .publish(&env);
        if siguiente == cupo {
            EventoFin { rondas: siguiente }.publish(&env);
        }

        Ok(siguiente)
    }

    /// Devuelve todos sus aportes del turno en curso a quien ya pagó al menos uno,
    /// una vez vencido el plazo. El primer reembolso congela la tanda en `Abortada`.
    pub fn reclamar(env: Env, miembro: Address) -> Result<i128, Error> {
        miembro.require_auth();

        match leer_estado(&env) {
            Estado::Inscripcion => return Err(Error::NoActiva),
            Estado::Terminada => return Err(Error::TandaTerminada),
            _ => {}
        }
        if !pertenece(&env, &miembro) {
            return Err(Error::NoEsMiembro);
        }

        let ronda = leer_u32(&env, &DataKey::Ronda);
        let cuotas = aportes_en_turno(&env, &miembro);
        if cuotas == 0 {
            return Err(Error::NoHaPagado);
        }
        let clave = DataKey::Devuelto(miembro.clone());
        if env.storage().persistent().get(&clave).unwrap_or(0u32) == ronda + 1 {
            return Err(Error::YaDevuelto);
        }

        let inicio = leer_u64(&env, &DataKey::Inicio);
        let duracion = leer_u64(&env, &DataKey::Duracion);
        if env.ledger().timestamp() < inicio + duracion {
            return Err(Error::PlazoVigente);
        }

        let token = leer_token(&env)?;
        let reembolso = leer_aporte(&env) * (cuotas as i128);

        env.storage().persistent().set(&clave, &(ronda + 1));
        env.storage().persistent().extend_ttl(&clave, TTL_UMBRAL, TTL_VIDA);
        env.storage().instance().set(&DataKey::Estado, &Estado::Abortada);
        env.storage().instance().extend_ttl(TTL_UMBRAL, TTL_VIDA);

        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &miembro,
            &reembolso,
        );

        EventoReclamado {
            miembro,
            ronda,
            aporte: reembolso,
        }
        .publish(&env);

        Ok(reembolso)
    }

    // --- Lecturas -------------------------------------------------------

    /// Estado completo de la tanda. `miembro` es opcional: sin él, `unido` y
    /// `ha_pagado` vuelven en `false`.
    pub fn resumen(env: Env, miembro: Option<Address>) -> Resumen {
        let estado = leer_estado(&env);
        let ronda = leer_u32(&env, &DataKey::Ronda);
        let miembros = leer_miembros(&env);
        let inscritos = miembros.len();
        let orden: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Orden)
            .unwrap_or(Vec::new(&env));
        let a_quien_toca = if estado == Estado::Activa {
            orden.get(ronda)
        } else {
            None
        };

        let ciclo = ciclo_actual(&env);
        let (unido, ha_pagado, ya_devuelto, aportes_miembro) = match miembro {
            Some(ref m) => (
                env.storage()
                    .persistent()
                    .get(&DataKey::Unido(m.clone()))
                    .unwrap_or(false),
                pago_de(&env, m) == ciclo + 1,
                devuelto_de(&env, m) == ronda + 1,
                if matches!(estado, Estado::Activa | Estado::Abortada) {
                    aportes_en_turno(&env, m)
                } else {
                    0
                },
            ),
            None => (false, false, false, 0),
        };

        Resumen {
            token: env.storage().instance().get(&DataKey::Token),
            estado,
            ronda,
            miembros,
            orden,
            aporte: leer_aporte(&env),
            duracion: leer_u64(&env, &DataKey::Duracion),
            cupo: leer_u32(&env, &DataKey::Cupo),
            inscritos,
            inicio: leer_u64(&env, &DataKey::Inicio),
            a_quien_toca,
            unido,
            ha_pagado,
            ya_devuelto,
            aportes_por_turno: leer_aportes_por_turno(&env),
            paso: leer_u32(&env, &DataKey::Paso),
            espera: leer_u64(&env, &DataKey::Espera),
            apertura: leer_u64(&env, &DataKey::Apertura),
            aportes_miembro,
        }
    }

    pub fn estado(env: Env) -> Estado {
        leer_estado(&env)
    }

    pub fn ronda(env: Env) -> u32 {
        leer_u32(&env, &DataKey::Ronda)
    }

    pub fn miembros(env: Env) -> Vec<Address> {
        leer_miembros(&env)
    }

    pub fn orden(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Orden)
            .unwrap_or(Vec::new(&env))
    }

    pub fn aporte(env: Env) -> i128 {
        leer_aporte(&env)
    }

    pub fn duracion(env: Env) -> u64 {
        leer_u64(&env, &DataKey::Duracion)
    }

    /// Cuántos lugares tiene la tanda en total.
    pub fn cupo(env: Env) -> u32 {
        leer_u32(&env, &DataKey::Cupo)
    }

    /// Cuántos lugares están ocupados.
    pub fn inscritos(env: Env) -> u32 {
        leer_miembros(&env).len()
    }

    /// Quién cobra la ronda actual. `None` si la tanda no está activa.
    pub fn a_quien_toca(env: Env) -> Option<Address> {
        if leer_estado(&env) != Estado::Activa {
            return None;
        }
        let orden: Vec<Address> = env.storage().instance().get(&DataKey::Orden)?;
        orden.get(leer_u32(&env, &DataKey::Ronda))
    }

    /// Si el miembro ya aportó el periodo en curso.
    pub fn ha_pagado(env: Env, miembro: Address) -> bool {
        pago_de(&env, &miembro) == ciclo_actual(&env) + 1
    }

    pub fn terminada(env: Env) -> bool {
        matches!(leer_estado(&env), Estado::Terminada | Estado::Abortada)
    }
}

// --- Auxiliares internos -------------------------------------------------

fn leer_estado(env: &Env) -> Estado {
    env.storage()
        .instance()
        .get(&DataKey::Estado)
        .unwrap_or(Estado::Inscripcion)
}

fn leer_miembros(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Miembros)
        .unwrap_or(Vec::new(env))
}

fn leer_u32(env: &Env, clave: &DataKey) -> u32 {
    env.storage().instance().get(clave).unwrap_or(0u32)
}

fn leer_u64(env: &Env, clave: &DataKey) -> u64 {
    env.storage().instance().get(clave).unwrap_or(0u64)
}

fn leer_aporte(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::Aporte).unwrap_or(0i128)
}

fn leer_aportes_por_turno(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::AportesPorTurno)
        .unwrap_or(1u32)
}

fn ciclo_actual(env: &Env) -> u32 {
    leer_u32(env, &DataKey::Ronda) * leer_aportes_por_turno(env) + leer_u32(env, &DataKey::Paso)
}

fn aportes_en_turno(env: &Env, miembro: &Address) -> u32 {
    let paso = leer_u32(env, &DataKey::Paso);
    let pago_paso_actual = pago_de(env, miembro) == ciclo_actual(env) + 1;
    paso + if pago_paso_actual { 1 } else { 0 }
}

fn leer_token(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .ok_or(Error::NoConfigurado)
}

fn pertenece(env: &Env, miembro: &Address) -> bool {
    leer_miembros(env).contains(miembro)
}

fn pago_de(env: &Env, miembro: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::Pagado(miembro.clone()))
        .unwrap_or(0u32)
}

fn devuelto_de(env: &Env, miembro: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::Devuelto(miembro.clone()))
        .unwrap_or(0u32)
}

mod test;
