#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, Vec,
};

/// Umbral y destino del TTL de los datos persistentes, en ledgers (~5 s cada uno).
/// 100 000 ledgers ≈ 6 días; 500 000 ≈ 29 días.
const TTL_UMBRAL: u32 = 100_000;
const TTL_VIDA: u32 = 500_000;

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
    /// Si el `miembro` consultado ya aportó la ronda en curso.
    pub ha_pagado: bool,
    /// Si el `miembro` consultado ya recuperó su aporte de la ronda en curso.
    pub ya_devuelto: bool,
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
    Estado,
    Ronda,
    Inicio,
    Unido(Address),
    /// Guarda `ronda + 1`; 0 significa "nunca pagó".
    Pagado(Address),
    /// Guarda `ronda + 1`; 0 significa "nunca reclamó".
    Devuelto(Address),
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
    ) -> Result<(), Error> {
        if cupo < 2 {
            return Err(Error::CupoInvalido);
        }
        if aporte <= 0 {
            return Err(Error::AporteInvalido);
        }
        if duracion == 0 {
            return Err(Error::DuracionInvalida);
        }

        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Cupo, &cupo);
        env.storage().instance().set(&DataKey::Aporte, &aporte);
        env.storage().instance().set(&DataKey::Duracion, &duracion);
        env.storage().instance().set(&DataKey::Estado, &Estado::Inscripcion);
        env.storage().instance().set(&DataKey::Ronda, &0u32);
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
        miembros.push_back(miembro);
        env.storage().instance().set(&DataKey::Miembros, &miembros);

        let inscritos = miembros.len();
        if inscritos == leer_u32(&env, &DataKey::Cupo) {
            let mut orden = miembros.clone();
            env.prng().shuffle(&mut orden);
            env.storage().instance().set(&DataKey::Orden, &orden);
            env.storage().instance().set(&DataKey::Estado, &Estado::Activa);
            env.storage().instance().set(&DataKey::Ronda, &0u32);
            env.storage()
                .instance()
                .set(&DataKey::Inicio, &env.ledger().timestamp());
        }
        env.storage().instance().extend_ttl(TTL_UMBRAL, TTL_VIDA);

        Ok(inscritos)
    }

    /// Aporta la cuota de la ronda. Si con este aporte todos han pagado, el
    /// pozo completo va al miembro de turno según el orden sorteado.
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

        let ronda = leer_u32(&env, &DataKey::Ronda);
        if pago_de(&env, &miembro) == ronda + 1 {
            return Err(Error::YaPago);
        }

        let token = leer_token(&env)?;
        let aporte = leer_aporte(&env);
        token::Client::new(&env, &token).transfer(
            &miembro,
            &env.current_contract_address(),
            &aporte,
        );

        let clave = DataKey::Pagado(miembro.clone());
        env.storage().persistent().set(&clave, &(ronda + 1));
        env.storage().persistent().extend_ttl(&clave, TTL_UMBRAL, TTL_VIDA);

        let miembros = leer_miembros(&env);
        let n = miembros.len();
        let mut pagaron = 0u32;
        for m in miembros.iter() {
            if pago_de(&env, &m) == ronda + 1 {
                pagaron += 1;
            }
        }

        if pagaron < n {
            env.storage().instance().extend_ttl(TTL_UMBRAL, TTL_VIDA);
            return Ok(ronda);
        }

        // Ronda completa: el pozo va al miembro de turno.
        let orden: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Orden)
            .ok_or(Error::NoConfigurado)?;
        let receptor = orden.get(ronda).ok_or(Error::NoConfigurado)?;
        let pozo = aporte * (n as i128);
        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &receptor,
            &pozo,
        );

        let siguiente = ronda + 1;
        env.storage().instance().set(&DataKey::Ronda, &siguiente);
        env.storage()
            .instance()
            .set(&DataKey::Inicio, &env.ledger().timestamp());
        if siguiente == n {
            env.storage().instance().set(&DataKey::Estado, &Estado::Terminada);
        }
        env.storage().instance().extend_ttl(TTL_UMBRAL, TTL_VIDA);

        Ok(siguiente)
    }

    /// Devuelve su aporte a quien ya pagó esta ronda, una vez vencido el plazo.
    /// El primer reembolso congela la tanda en `Abortada`.
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
        if pago_de(&env, &miembro) != ronda + 1 {
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
        let aporte = leer_aporte(&env);

        env.storage().persistent().set(&clave, &(ronda + 1));
        env.storage().persistent().extend_ttl(&clave, TTL_UMBRAL, TTL_VIDA);
        env.storage().instance().set(&DataKey::Estado, &Estado::Abortada);
        env.storage().instance().extend_ttl(TTL_UMBRAL, TTL_VIDA);

        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &miembro,
            &aporte,
        );

        Ok(aporte)
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

        let (unido, ha_pagado, ya_devuelto) = match miembro {
            Some(ref m) => (
                env.storage()
                    .persistent()
                    .get(&DataKey::Unido(m.clone()))
                    .unwrap_or(false),
                pago_de(&env, m) == ronda + 1,
                devuelto_de(&env, m) == ronda + 1,
            ),
            None => (false, false, false),
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

    /// Si el miembro ya aportó la ronda en curso.
    pub fn ha_pagado(env: Env, miembro: Address) -> bool {
        pago_de(&env, &miembro) == leer_u32(&env, &DataKey::Ronda) + 1
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
