# RondaPa' Todos

Una ronda de ahorro circular en Stellar para construir el hábito de ahorrar entre compas: cada participante aporta una cuota periódica, la rifa le suma la emoción de poder sacarse la buchaca grande, y las reglas viven en un contrato sin administrador que nadie —ni quien despliega— puede tocar después.

- **Red:** Stellar testnet
- **Probar en vivo (web):** [ronda.pajarobobo.xyz](https://ronda.pajarobobo.xyz) — permite **crear tu propia ronda nueva** en un clic desde el navegador o abrir una existente con `?contrato=C...`
- **Ronda de ejemplo (en curso):** [`CBHIPV67AJV5OMBRH5VD7FB47FRFCOTQ67ZMHP6G3QX2LQOWCKAHKPXX`](https://stellar.expert/explorer/testnet/contract/CBHIPV67AJV5OMBRH5VD7FB47FRFCOTQ67ZMHP6G3QX2LQOWCKAHKPXX) — cupo 3, cuota 10 XLM, plazo de una semana (cupo ya lleno, en turno 3 de 3)
- **Contrato de la corrida documentada en §7:** [`CAERWTX44RAZNQ6UK4XSHB6P22DRPJ4OPBO2QYDZDMHNOWBC5SX47UU4`](https://stellar.expert/explorer/testnet/contract/CAERWTX44RAZNQ6UK4XSHB6P22DRPJ4OPBO2QYDZDMHNOWBC5SX47UU4) — abortado; se conserva solo como evidencia histórica
- **Wasm hash actual:** `d5b58239363a6e99819f93053975ec262cbccf11f2b39c39b4289ef8bdeb6523` (tx de subida [`de259bcc…`](https://stellar.expert/explorer/testnet/tx/de259bcc97cffa78023d8151d56a39b0fb2a623103d02716f0842d7bb2c1b276); la corrida histórica de §7 usó `8bd7c071…849be`)
- **SDK:** Soroban 29.0.1 · **Pruebas:** 33/33 en verde (contrato) · 55/55 en verde (interfaz)

---

## 1. El problema

A mucha gente le cuesta sostener una **cultura del ahorro** por cuenta propia: ahorrar solo requiere constancia y es fácil romper la alcancía antes de tiempo. De ahí entonces nace la idea de crear esta propuesta para hacer una buchaca por rondas entre compas, familia o compañeros de brete en donde: ponen una cuota periódica, el compromiso social ayuda a mantener el hábito y el componente de **azar** —poder llevarse una **buchaca grande** antes que los demás— vuelve el ahorro más interactivo y atractivo.

Hay dos puntos de quiebre que se contemplaron como "subproblemas" que suceden a veces en una actividad de este tipo. El primero es que alguien tiene que guardar la plata de todos, y una persona puede:

- quedarse con lo ahorrado y desaparecer,
- entregarlo tarde o en tractos,
- cambiar el orden de cobro a conveniencia,
- "olvidar" a quién le tocaba agarrar esa semana,
- o simplemente tener una bronca personal y no poder responder por la plata de las personas involucradas.

El problema no es la desconfianza entre los miembros. El problema es que el acuerdo necesita un custodio, y el custodio es el eslabón débil: es un punto único de falla que además concentra toda la tentación.

A esto se suma el otro problema: **el orden de cobro se negocia**. Quien organiza decide quién va primero, y esa decisión tiene un valor económico real. Cobrar primero es recibir un préstamo sin intereses; cobrar de último es prestarle plata gratis a los demás. Si el orden lo elige una persona, la ronda tiene un árbitro con interés propio.

**Por qué este problema y no otro.** Porque ataca un reto real de ahorro cotidiano con reglas verificables en una sola sesión: ahorrar en grupo de forma constante, con una rifa transparente que nadie manipula para sacar la buchaca grande. El proyecto ya está publicado en [ronda.pajarobobo.xyz](https://ronda.pajarobobo.xyz) en testnet, listo para que cualquiera cree una ronda nueva vacía desde su navegador o pruebe una con el cupo, cuota y ritmo que prefiera.

## 2. La idea

Poner las reglas en un contrato y quitar al custodio del medio.

El contrato **es** la buchaca. La plata entra y sale según reglas escritas antes de que nadie ponga un cinco, y ninguna de esas reglas se puede tocar después:

- cuántos campos tiene la ronda (el cupo, de 2 a 50),
- cuánto pone cada uno por aporte (la cuota),
- cuántos aportes reúne cada turno (`aportes_por_turno`, de 1 a 24) y el ritmo entre ellos (`espera`, de 0 a 14 días) — por defecto en modo inmediato (1 aporte por turno, sin espera) para probar rápido, o personalizable para metas de 1 a 3 meses con aportes semanales o bisemanales,
- **y en qué orden cobra cada quien.**

Ese orden no lo decide nadie a dedo. Se rifa una única vez, en cadena, cuando se ocupa el último campo del cupo. El contrato no tiene admin: no existe la función que podría cambiar nada de esto.

## 3. Cómo funciona

### 3.1 Arranque: el cupo se llena a firmas

El contrato se despliega con un **cupo** —cuántos campos tiene la ronda— y sin miembros. Nace vacío. Cada campo se ocupa cuando una wallet firma su propia inscripción:

```rust
pub fn unirse(env: Env, miembro: Address) -> Result<u32, Error>
```

`miembro.require_auth()` exige que la transacción venga firmada por esa dirección. Nadie puede apuntar a otro. Mientras el estado sea `Inscripcion`, el contrato no acepta un solo stroop.

Esto tiene una consecuencia que conviene decir en voz alta: **el grupo es quien llega primero con el enlace**. El contrato no distingue invitados de desconocidos ni tiene forma de sacar a nadie, así que la lista no la escribe una persona: la escriben las firmas. Que entre solo gente conocida es un acuerdo social —el enlace se pasa al grupo de WhatsApp y no se publica—, el mismo tipo de confianza que ya sostiene una ronda tradicional. Lo que el contrato sí garantiza es el consentimiento: nadie queda amarrado por la firma de otro y nadie puede quitarle el campo a un tercero.

### 3.2 La rifa del orden

Cuando se ocupa el último campo, el contrato hace esto, una sola vez:

```rust
let mut orden = miembros.clone();
env.prng().shuffle(&mut orden);
env.storage().instance().set(&DataKey::Orden, &orden);
env.storage().instance().set(&DataKey::Estado, &Estado::Activa);
```

El orden queda congelado en `Orden`, separado de `Miembros` (que guarda el orden en que se apuntaron). Eso importa por dos razones: la rifa es auditable para siempre, y la pregunta "¿ya se rifó?" se responde mirando si `Orden` existe, sin necesidad de un flag extra que pueda desincronizarse.

Desde ese momento la ronda está activa y empieza a correr el reloj.

### 3.3 Los turnos de cobro

Cada turno funciona igual (con modo inmediato por defecto `aportes_por_turno = 1, espera = 0`, o acumulando varios aportes en el tiempo):

1. En cada periodo del turno, cada miembro llama `aportar()`. El contrato transfiere la cuota al contrato vía el Stellar Asset Contract. Nadie puede pagar dos veces el mismo periodo; si `espera > 0`, el siguiente periodo permanece cerrado (`AporteAunNoAbierto`) hasta cumplir el intervalo configurado.
2. Cuando entran todos los aportes del turno (`cupo × aportes_por_turno`), el contrato transfiere **la buchaca completa** (`cuota × cupo × aportes_por_turno`) a `Orden[ronda]`. Por ejemplo, 3 compas ahorrando durante 3 meses con 1 aporte semanal (`aportes_por_turno = 4`) juntan cada mes una buchaca grande de `12 × cuota`.
3. La ronda avanza al siguiente turno y el reloj se reinicia.

Después de N turnos, todos cobraron exactamente una vez. Cada miembro puso `N × aportes_por_turno` cuotas y recibió una buchaca equivalente: el neto es cero para todos. Lo único que cambió es *cuándo* le tocó agarrar la buchaca.

### 3.4 El plazo y la salida de emergencia

Una ronda real tiene un riesgo que ningún contrato elimina: que alguien se eche para atrás. Si en la vuelta 4 alguien deja de aportar, los que ya cobraron no van a seguir poniendo plata por gusto.

Por eso cada periodo tiene un plazo (`duracion`, en segundos). Si el plazo vence sin que se complete el aporte actual, cualquier miembro que **haya puesto al menos un aporte en ese turno** puede llamar:

```rust
pub fn reclamar(env: Env, miembro: Address) -> Result<i128, Error>
```

Le devuelve **todas las cuotas que acumuló en el turno en curso** (`aportes_en_turno × cuota`), y el primer reembolso congela la ronda en estado `Abortada`. No hay rescate parcial ni negociación: la ronda se cierra y cada uno recupera lo que puso en ese turno. Quien ya había cobrado en turnos anteriores se queda con lo cobrado.

## 4. La decisión de diseño que más importa: sin admin

El contrato **no tiene administrador**. No es un olvido, es el punto.

La clase de contratos del bootcamp presenta el patrón opuesto —un `admin` guardado en el storage del que cuelgan las funciones privilegiadas—; aquí se quitó a propósito. El detalle de qué viene de la clase y qué no está en §12.

No existe función para meter o sacar miembros, ni para cambiar la cuota, ni para reordenar la rifa, ni para pausar, ni para sacar fondos. El ABI exporta 16 funciones y ninguna de ellas puede alterar una regla después del despliegue:

```
__constructor  a_quien_toca  aportar  aporte  cupo  duracion  estado  ha_pagado
inscritos  miembros  orden  reclamar  resumen  ronda  terminada  unirse
```

Esto tiene un costo, y hay que decirlo claro: **sin admin, un error en los parámetros es irreversible**. Si despliegas con una cuota equivocada o con un cupo que no era, no hay arreglo; hay que desplegar otro contrato y volver a empezar. Es el precio de que nadie —tampoco yo— pueda tocar la plata ni las reglas.

La alternativa (un admin que pueda corregir) reintroduce exactamente el problema que el contrato venía a resolver.

## 5. La aleatoriedad

`env.prng()` en Soroban es un CSPRNG (ChaCha20) sembrado por la red. La documentación del SDK es explícita sobre sus límites:

> The PRNG is seeded with data that is public as soon as each ledger is nominated. Therefore it **should never be used to generate secrets**.
>
> The PRNG is seeded with data that is under the control of validators. Therefore it **should only be used in applications where the risk of validator influence is acceptable**.

Traducido a este caso:

| Se puede prometer | No se puede prometer |
| --- | --- |
| Ningún miembro puede elegir su número | Que el resultado sea impredecible para un validador |
| Ningún miembro puede predecir el orden antes de firmar | Que el orden sea criptográficamente inatacable |
| El orden no se puede cambiar después de la rifa | Resistencia a un cartel de validadores |
| La rifa ocurre una sola vez y queda registrada | — |

El seed depende del conjunto de transacciones del ledger, así que **quien envía la transacción no controla el resultado**. Para una ronda entre compas o en la oficina, eso resuelve el problema real: el organizador ya no puede amañar los papelitos. Contra un validador corrupto que quisiera sesgar el resultado, no hay defensa en un contrato de este tamaño —y decirlo es más honesto que fingir lo contrario.

Si algún día eso importa, el camino es un esquema commit-reveal: cada miembro publica un hash antes de la rifa y revela su secreto después, y el orden se deriva de la combinación. El SDK soporta re-sembrar el PRNG para eso. No está implementado aquí porque añade una vuelta de transacciones y complejidad considerables para un riesgo que, en este caso de uso, es remoto.

## 6. Pruebas

33 pruebas de host (`Env::default()`, sin red), una por regla:

```sh
cargo test
# running 33 tests -> test result: ok. 33 passed; 0 failed; 0 ignored
```

| Prueba | Qué garantiza |
| --- | --- |
| `constructor_rechaza_cupo_menor_a_dos` / `constructor_rechaza_cupo_mayor_a_maximo` | El cupo queda acotado entre 2 y 50 campos |
| `constructor_rechaza_aporte_invalido` / `constructor_rechaza_overflow_pozo` | No se puede desplegar con cuota <= 0 ni con buchaca que desborde |
| `constructor_rechaza_duracion_invalida` / `_menor_a_minima` / `_mayor_a_maxima` | El plazo queda acotado entre 60 s y 14 días |
| `constructor_rechaza_aportes_por_turno_invalido` / `_mayor_a_maximo` | Los aportes por turno quedan acotados entre 1 y 24 |
| `constructor_rechaza_espera_mayor_a_maxima` | La espera entre aportes no supera 14 días |
| `unirse_sin_firma_falla` | La inscripción exige la firma del miembro, no la de otro |
| `cualquier_wallet_ocupa_un_lugar_libre` | El contrato nace vacío y acepta a cualquier cuenta mientras haya campo |
| `no_se_puede_unir_dos_veces` | Una firma, un campo: no se infla el conteo |
| `unirse_rechaza_cupo_lleno` | Con el cupo lleno, la inscripción está cerrada |
| `el_ultimo_unirse_sortea_y_activa` | La rifa produce una permutación real y arranca la ronda |
| `aportar_antes_de_llenar_el_cupo_falla` | Nadie pone plata antes de que el cupo esté completo |
| `aporte_transfiere_al_contrato` | La plata se mueve de verdad, no es contabilidad interna |
| `no_se_puede_pagar_dos_veces_la_misma_ronda` | Pagar dos veces no acelera el cobro |
| `ronda_completa_paga_al_miembro_de_turno` | La buchaca va completa a quien dice la rifa |
| `tanda_completa_paga_a_todos_una_vez` | Al final todos quedan tablas: nadie pierde ni gana |
| `aportar_despues_de_terminar_falla` | Una ronda terminada no acepta plata |
| `reclamar_antes_del_plazo_falla` | El plazo es real, no decorativo |
| `reclamar_devuelve_el_aporte_y_aborta` | La devolución es exacta y congela la ronda |
| `no_se_reclama_dos_veces` | El reembolso no se puede repetir |
| `ha_pagado_refleja_la_ronda` | El estado de pago que ve el miembro es el real |
| `resumen_durante_la_inscripcion` | Antes de arrancar, `resumen` reporta el cupo, los inscritos y el orden vacío |
| `resumen_durante_las_rondas` | Con la ronda en marcha, `resumen` dice el turno, a quién toca y si pagué |
| `resumen_marca_la_tanda_terminada` | Al terminar, `resumen` lo refleja y ya no hay turno |
| `eventos_se_emiten_durante_ciclo` | Cada inscripción, aporte, buchaca y fin emite su evento |
| `multiples_aportes_por_turno_acumulan_y_pagan_pozo_completo` | Varios aportes por turno acumulan hasta entregar la buchaca grande completa |
| `reclamar_devuelve_todos_los_aportes_del_turno_incompleto` | Al abortar, `reclamar` devuelve todas las cuotas acumuladas en ese turno |
| `espera_bloquea_siguiente_aporte_hasta_apertura` | Cuando `espera > 0`, el contrato bloquea el siguiente aporte hasta `apertura` |
| `resumen_expone_campos_de_periodo` | `resumen` reporta `aportes_por_turno`, `paso`, `espera`, `apertura` y `aportes_miembro` |

La prueba de la rifa verifica **propiedades**, no una secuencia: que el resultado sea una permutación de la lista original y que `a_quien_toca()` coincida con `Orden[0]`. Fijar la secuencia concreta sería frágil —en los tests el PRNG del host se siembra en cero— y no probaría nada sobre la calidad de la rifa.

## 7. Corrida real en testnet

Contrato desplegado con **cupo 3**, cuota de **10 XLM** y plazo de **600 segundos** (corto, para llegar a la salida de emergencia en la misma sesión).

Las tres cuentas de esta corrida son keypairs creados con `stellar keys generate` en la máquina del autor. El friendbot de testnet (`GAIH3ULL…JZNSR`) las creó y financió con 10 000 XLM cada una entre las 23:15:26 y las 23:15:46 UTC del 22 de noviembre de 2026, y las cuatro llaves privadas, incluida la del despliegue, viven en el keystore local. Cada transacción lleva la firma de la cuenta que la origina y cualquiera puede abrirla en Stellar Expert. Eso prueba que el contrato acepta cuentas distintas, exige la firma de cada una y paga según la rifa; no prueba que tres personas independientes hayan aceptado participar. Esa parte queda sin probar hasta que el enlace llegue a manos de terceros.

### 7.1 Estado inicial

```
estado        = "Inscripcion"
cupo          = 3
inscritos     = 0
ronda         = 0
aporte        = "100000000"   // 10 XLM en stroops
duracion      = 600
orden         = []
a_quien_toca  = null
```

Nadie ha puesto un stroop y el contrato todavía no acepta aportes: `aportar` responde `Error::NoActiva` mientras esté en inscripción.

### 7.2 Inscripción abierta (una firma por cuenta)

| Miembro | Devuelve | Transacción |
| --- | --- | --- |
| rp-ana | `1` | [`54291728…`](https://stellar.expert/explorer/testnet/tx/542917289281144b03954b3cdc0432ab97d6cf8ddfec95ded626e9dbbaac33b4) |
| rp-beto | `2` | [`7918d226…`](https://stellar.expert/explorer/testnet/tx/7918d226856079e87e38de0096e49d1966ada8f0d0f2304bd87e4c4f979c8572) |
| rp-carol | `3` | [`1eb73e94…`](https://stellar.expert/explorer/testnet/tx/1eb73e940c21af300f153d69cdc31e63156f7c080f1d71e616de72d55d8ace94) |

La tercera firma llenó el cupo y disparó la rifa. El orden de llegada era **ana, beto, carol**; el orden rifado fue otro:

```
estado        = "Activa"
miembros      = ["GAYXY…C2W" (ana), "GCI73…XBQ" (beto), "GAINY…FEE" (carol)]
orden         = ["GAINY…FEE" (carol), "GAYXY…C2W" (ana), "GCI73…XBQ" (beto)]
a_quien_toca  = "GAINY…FEE" (carol)
```

Carol cobra primero, después Ana, después Beto. El paso a `Activa` y la rifa ocurrieron dentro de esa tercera transacción: no hay una función para arrancar la ronda, se arranca sola cuando el cupo se llena.

### 7.3 Turno 1 (`ronda = 0`) — completo

| Acción | Devuelve | Transacción |
| --- | --- | --- |
| `aportar` ana | `0` | [`bbd891d3…`](https://stellar.expert/explorer/testnet/tx/bbd891d39648e50218338b2401a58a9e5eb7444709c7013694e9c9f32e7dd3b9) |
| `aportar` beto | `0` | [`e19b86b7…`](https://stellar.expert/explorer/testnet/tx/e19b86b753ff675c29a299f933b08e3fb3db2617322cea90b101c0aa365f6cfa) |
| `aportar` carol | `1` | [`56afd6ad…`](https://stellar.expert/explorer/testnet/tx/56afd6adca69139f76dfaf7e3e791844525c7c1a6d6b11fb9b8b346c2a68c575) |

El tercer aporte completó el turno: el contrato movió **30 XLM** de la buchaca a Carol y avanzó al siguiente turno (`ronda = 1`). Los efectos de esa transacción lo dejan por escrito: se debitó la cuota de Carol, se acreditó al contrato y el contrato pagó 30 XLM a su cuenta. El neto del turno es **+20 XLM** antes de comisiones.

### 7.4 Turno 2 (`ronda = 1`) — deserción y devolución

Solo Ana aportó:

| Acción | Resultado | Transacción |
| --- | --- | --- |
| `aportar` ana | `1` | [`f090e976…`](https://stellar.expert/explorer/testnet/tx/f090e976e86a98ffe3e8d3f07d94bdfaf2952f8b72f55592ab45cee5d84a2c7b) |
| `reclamar` beto (no pagó) | ❌ `Error(Contract, #11)` — `NoHaPagado` | — |
| `reclamar` ana (dentro del plazo) | ❌ `Error(Contract, #10)` — `PlazoVigente` | — |
| `reclamar` ana (tras 600 s) | `"100000000"` | [`6ff3ac72…`](https://stellar.expert/explorer/testnet/tx/6ff3ac72b60329248ed5e27c23c6196b8d2b6a50dae1104aa33e3713bec8dd5e) |
| `aportar` carol (ronda abortada) | ❌ `Error(Contract, #9)` — `TandaTerminada` | — |
| `reclamar` ana (segunda vez) | ❌ `Error(Contract, #12)` — `YaDevuelto` | — |

Ana recuperó sus 10 XLM exactos: su saldo pasó de `10169.9505794` a `10179.9480925`, y el contrato quedó con `"0"` stroops cuando antes de la devolución tenía `"100000000"`. El estado quedó:

```
estado        = "Abortada"
terminada     = true
a_quien_toca  = null
saldo del contrato = "0"
```

Ninguna plata quedó atrapada: el contrato cerró en cero porque solo Ana había aportado ese turno.

## 8. Cómo correrlo

Requisitos: Rust 1.84+, target `wasm32v1-none` y [Stellar CLI](https://github.com/stellar/stellar-cli).

```sh
rustup target add wasm32v1-none
cargo test
stellar contract build
```

Desplegar en testnet:

```sh
# El SAC del XLM nativo en testnet. No lo hardcodees, consúltalo:
SAC=$(stellar contract id asset --asset native --network testnet)

stellar contract deploy \
  --wasm target/wasm32v1-none/release/ronda_pa_todos.wasm \
  --source-account <tu-identidad> \
  --network testnet \
  --alias ronda-pa-todos \
  -- --token "$SAC" \
     --aporte 100000000 \
     --duracion 604800 \
     --cupo 3 \
     --aportes_por_turno 1 \
     --espera 0
```

No hay lista de miembros: el contrato nace vacío y espera `cupo` firmas. Cada persona ocupa su campo firmando con su propia llave:

```sh
stellar contract invoke --id ronda-pa-todos --source-account <miembro> --network testnet \
  -- unirse --miembro <su-dirección-G...>
```

Y consultar la rifa antes de poner un solo stroop:

```sh
stellar contract invoke --id ronda-pa-todos --source-account <cualquiera> --network testnet \
  -- orden
```

### La interfaz para el grupo

Hay una interfaz estática publicada en [ronda.pajarobobo.xyz](https://ronda.pajarobobo.xyz) (`app/`) para que cualquiera pueda crear una ronda nueva desde el navegador o abrir una existente con `?contrato=EL_ID` y firmar con su propia wallet, sin tocar la CLI ni usar backend.

- **Crear ronda nueva directo en la web:** por defecto arranca en modo inmediato (`1` aporte por turno, sin espera) para probar en minutos, e incluye un desplegable opcional para personalizar periodo y frecuencia (p. ej. 4, 8, 12 o 24 aportes por turno y ritmo de espera).
- **Transparencia en cada turno:** muestra la barra de aportes reunidos, quién aportó y la sección **Buchacas entregadas** cuando se completa un turno.
- **Wallets y fondeo:** conecta directamente con Varial (antes Freighter, vía `@stellar/freighter-api`), habilita WalletConnect por QR cuando `VITE_WALLETCONNECT_PROJECT_ID` tiene un Project ID de Reown y enlaza Friendbot con la cuenta conectada para pedir XLM de testnet.

```sh
cd app
npm install
cp .env.example .env.local  # añade el Project ID de Reown para WalletConnect
npm run dev
```

Para desplegar una ronda nueva por CLI (con `-AportesPorTurno` y `-EsperaSegundos` opcionales):

```powershell
.\scripts\desplegar.ps1 -Cupo 3 -Cuenta <tu-identidad> -Aporte 10
```

El flujo completo, los comandos y el aviso de testnet están en [`app/README.md`](app/README.md).

## 9. Límites conocidos

Prefiero que los sepas por mí y no que los descubras por tu cuenta.

1. **El PRNG depende de los validadores.** Ya explicado en §5. Para una ronda entre compas alcanza; no es resistencia criptográfica contra un cartel de validadores.
2. **La deserción no se previene, se contiene.** El plazo y `reclamar` devuelven la cuota del turno en curso, pero quien ya cobró no devuelve nada. Si en la vuelta 3 alguien desaparece, los que faltaban cobrar pierden su turno. Es el mismo riesgo que en una ronda tradicional; el contrato no lo elimina, solo hace que la salida sea ordenada y verificable.
3. **Quien paga y nunca reclama deja su plata en el contrato.** Sin admin no existe función de barrido: si alguien aporta un turno que se aborta y nunca llama `reclamar`, esos fondos quedan ahí para siempre. Es el precio directo de §4. Con admin, ese admin podría llevarse todo. Además, el registro de quién pagó vive en almacenamiento persistente con TTL renovado: si un miembro espera más de ~29 días desde su último aporte para reclamar, su registro puede expirar y el reembolso le respondería `NoHaPagado`. Reclamar es una acción de días, no de meses.
4. **Los parámetros son irreversibles.** Una cuota mal puesta o un cupo equivocado no se corrigen. Hay que desplegar de nuevo.
5. **Cualquiera con el enlace puede ocupar un campo.** No hay lista blanca ni código de invitación: el contrato no sabe quién es amigo de quién. Si el enlace se filtra antes de llenar el cupo, un desconocido puede entrar y cobrar su turno como cualquiera. La defensa es social —mandar el enlace solo al grupo y llenar el cupo rápido—, no criptográfica.
6. **Si el cupo no se llena, la ronda nunca arranca.** No hay plazo de inscripción: el contrato se queda en `Inscripcion` esperando firmas. No se pierde plata, porque nadie puede aportar antes de que el cupo esté completo, pero sí queda un despliegue inútil.
7. **No hay incentivo económico para el que cobra último.** En una ronda real, cobrar al final es prestar gratis. Aquí eso se resuelve con confianza social, igual que siempre. Un contrato no arregla la economía de la ronda; arregla la custodia y el orden.

## 10. Qué haría después

- **Commit-reveal para la rifa** (§5), si el riesgo de validador deja de ser teórico.
- **Turnos con cobro automático por tiempo** en vez de esperar el último aporte, para que un solo moroso no congele el cobro de todos.
- **Un plazo de inscripción o un código de invitación** (§9.5 y §9.6): hoy el enlace es la única credencial, y un cupo que no se llena deja el contrato esperando para siempre.

## 11. Estructura del repo

```
Cargo.toml                          workspace
contracts/ronda_pa_todos/
├── Cargo.toml
├── Makefile
└── src/
    ├── lib.rs                      contrato completo (16 funciones exportadas)
    └── test.rs                     33 pruebas de host
app/                                interfaz estática (Vite + TypeScript)
scripts/desplegar.ps1               despliegue de una ronda nueva en testnet
```

## 12. Base en el material del curso

El andamiaje del contrato viene de la clase de contratos del bootcamp (Clase 2, Armando):

| De la clase | Dónde vive |
| --- | --- |
| Rust + SDK de Soroban, compilar a `wasm32v1-none` | `Cargo.toml`, `AGENTS.md` |
| Storage `instance` / `persistent` y el TTL con archivado | `lib.rs`, `TTL_UMBRAL` y `extend_ttl` |
| Constructor que corre antes del despliegue (`__constructor`) | `lib.rs:171` |
| `require_auth` con la regla de que firma quien pierde algo | `unirse`, `aportar`, `reclamar` |
| Errores tipados con `#[contracterror]` | `lib.rs:142` (`Error`) |
| Tests con `Env::default()`, `register`, cliente y `mock_all_auths` | `test.rs`, 33 pruebas |
| Desplegar e invocar desde la CLI | `scripts/desplegar.ps1` |

El TTL no está de adorno: en la clase se contó el caso de un contrato propio que se archivó y empezó a cobrarles de más a sus usuarios al restaurarlo. Por eso cada escritura extiende el TTL en vez de confiar en el default.

**Lo que se agregó por cuenta propia:** las transferencias reales del token (`token::Client` sobre el SAC) y la rifa con `env.prng().shuffle`. El único contrato que se muestra y despliega en clase es un contador; ahí la plata no se mueve, así que esa parte hubo que resolverla.

**La desviación deliberada** es la de §4: la clase presenta el `admin` en storage como patrón recomendado, y este contrato no lo tiene. Un admin que puede corregir reintroduce el problema que el contrato venía a resolver.

---

Proyecto individual para el bootcamp de Stellar. Contrato desplegado en testnet; ninguna dirección ni llave de este README debe usarse en mainnet.
