# RondaPa' Todos

Una tanda de ahorro circular en Stellar: un grupo de personas aporta la misma cuota cada
semana, y cada semana una distinta se lleva el pozo completo. El orden de cobro se sortea una
sola vez, al arrancar, y nadie —ni quien despliega el contrato— puede cambiarlo después.

- **Red:** Stellar testnet
- **Contrato:** [`CDIED32RNOXVVOAKA6RRKHIAUB6BAMPJQC2Z3GQCCYETKXMCPMVKAI7Y`](https://stellar.expert/explorer/testnet/contract/CDIED32RNOXVVOAKA6RRKHIAUB6BAMPJQC2Z3GQCCYETKXMCPMVKAI7Y)
- **Wasm hash:** `2d6fc13a1699774cce02bd77b638ebc484a25a8b2ff40fc9960ff5122ccf7eb2`
- **SDK:** Soroban 29.0.1 · **Pruebas:** 19/19 en verde

---

## 1. El problema

En Costa Rica (y en media Latinoamérica) la tanda es una institución: un grupo de gente de
confianza —familia, vecinos, compañeros de trabajo— acuerda aportar lo mismo cada semana, y
cada semana uno se lleva todo. Es ahorro sin banco, y funciona.

Funciona **hasta que deja de funcionar**, y el punto de quiebre es siempre el mismo: alguien
tiene que guardar la plata de todos.

Ese alguien es una persona. Y una persona puede:

- quedarse con el pozo y desaparecer,
- entregarlo tarde o en cuotas,
- cambiar el orden de cobro a conveniencia,
- "olvidar" a quién le tocaba,
- o simplemente tener un problema y no poder responder por la plata de ocho familias.

El problema no es la desconfianza entre los miembros. El problema es que el acuerdo necesita
un custodio, y el custodio es el eslabón débil: es un punto único de falla que además
concentra toda la tentación.

Hay un segundo problema, más silencioso: **el orden de cobro siempre se negocia**. Quien
organiza decide quién va primero, y esa decisión tiene un valor económico real. Cobrar primero
es recibir un préstamo sin intereses; cobrar último es dar un préstamo sin intereses. Si el
orden lo elige una persona, la tanda tiene un árbitro con interés propio.

## 2. La idea

Poner las reglas en un contrato y quitar al custodio del medio.

El contrato **es** el pozo. La plata entra y sale según reglas escritas antes de que nadie
ponga un cinco, y ninguna de esas reglas se puede tocar después:

- quiénes son los miembros,
- cuánto aporta cada uno,
- cuántas rondas hay,
- **y en qué orden cobra cada quien.**

Ese orden no lo decide nadie. Se sortea una única vez, en cadena, cuando entra el último
miembro. El contrato no tiene admin: no existe la función que podría cambiar nada de esto.

## 3. Cómo funciona

### 3.1 Arranque: las N firmas

El contrato se despliega con la lista de miembros ya fija, pero **no arranca solo**. Cada
miembro tiene que firmar su propia inscripción con su propia llave:

```rust
pub fn unirse(env: Env, miembro: Address) -> Result<u32, Error>
```

`miembro.require_auth()` exige que la transacción venga firmada por esa dirección. Nadie puede
inscribir a otro. Y mientras no estén las N firmas, el estado es `Inscripcion` y el contrato
no acepta un solo stroop.

Esa es la multifirma del arranque: **N-de-N para empezar**. No es un mecanismo de consenso
sobre el sorteo —el sorteo no necesita consenso— es el consentimiento explícito de cada
miembro sobre las condiciones. Si alguien no firma, la tanda no existe. Nadie queda amarrado
por la firma de otro.

### 3.2 El sorteo

Cuando entra el miembro número N, el contrato hace esto, una sola vez:

```rust
let mut orden = miembros.clone();
env.prng().shuffle(&mut orden);
env.storage().instance().set(&DataKey::Orden, &orden);
env.storage().instance().set(&DataKey::Estado, &Estado::Activa);
```

El orden queda congelado en `Orden`, separado de `Miembros`. Eso importa por dos razones:
el sorteo es auditable para siempre, y la pregunta "¿ya se sorteó?" se responde mirando si
`Orden` existe, sin necesidad de un flag extra que pueda desincronizarse.

Desde ese momento la tanda está activa y empieza el reloj.

### 3.3 Las rondas

Cada ronda funciona igual:

1. Cada miembro llama `aportar()`. El contrato transfiere la cuota del miembro a sí mismo
   vía el Stellar Asset Contract. Nadie puede pagar dos veces la misma ronda.
2. Cuando entra el último aporte, el contrato transfiere **el pozo completo** (`cuota × N`)
   a `Orden[ronda]`.
3. La ronda avanza y el reloj se reinicia.

Después de N rondas, todos cobraron exactamente una vez. Cada miembro puso N cuotas y recibió
un pozo de N cuotas: el neto es cero para todos. Lo único que cambió es *cuándo*.

### 3.4 El plazo y la salida

Una tanda real tiene un riesgo que ningún contrato elimina: la deserción. Si en la ronda 4
alguien deja de aportar, los que ya cobraron no van a seguir pagando por gusto.

Por eso cada ronda tiene un plazo (`duracion`, en segundos). Si el plazo vence sin que la
ronda se complete, cualquier miembro que **sí pagó esa ronda** puede llamar:

```rust
pub fn reclamar(env: Env, miembro: Address) -> Result<i128, Error>
```

Le devuelve su cuota, y el primer reembolso congela la tanda en estado `Abortada`. No hay
rescate parcial ni negociación: la tanda se termina y cada uno recupera lo que puso en esa
ronda. Quien ya había cobrado se queda con lo cobrado.

## 4. La decisión de diseño que más importa: sin admin

El contrato **no tiene administrador**. No es un olvido, es el punto.

No existe función para añadir o quitar miembros, ni para cambiar la cuota, ni para reordenar
el sorteo, ni para pausar, ni para sacar fondos. El ABI exporta 14 funciones y ninguna de
ellas puede alterar una regla después del despliegue:

```
__constructor  a_quien_toca  aportar  aporte  duracion  estado
ha_pagado  inscritos  miembros  orden  reclamar  ronda  terminada  unirse
```

Esto tiene un costo, y hay que decirlo: **sin admin, un error en los parámetros es
irreversible**. Si despliegas con una cuota equivocada, no hay arreglo; hay que desplegar otro
contrato y volver a empezar. Es el precio de que nadie —tampoco yo— pueda tocar la plata ni
las reglas.

La alternativa (un admin que pueda corregir) reintroduce exactamente el problema que el
contrato venía a resolver.

## 5. La aleatoriedad, sin vender humo

`env.prng()` en Soroban es un CSPRNG (ChaCha20) sembrado por la red. La documentación del SDK
es explícita sobre sus límites:

> The PRNG is seeded with data that is public as soon as each ledger is nominated. Therefore
> it **should never be used to generate secrets**.
>
> The PRNG is seeded with data that is under the control of validators. Therefore it **should
> only be used in applications where the risk of validator influence is acceptable**.

Traducido a este caso:

| Se puede prometer | No se puede prometer |
| --- | --- |
| Ningún miembro puede elegir su posición | Que el resultado sea impredecible para un validador |
| Ningún miembro puede predecir el orden antes de firmar | Que el orden sea criptográficamente inatacable |
| El orden no se puede cambiar después del sorteo | Resistencia a un cartel de validadores |
| El sorteo ocurre una sola vez y queda registrado | — |

El seed depende del conjunto de transacciones del ledger, así que **quien envía la transacción
no controla el resultado**. Para una tanda de barrio, eso resuelve el problema real: el
organizador ya no puede amañar el orden. Contra un validador corrupto que quisiera sesgar el
sorteo, no hay defensa en un contrato de este tamaño —y decirlo es más honesto que fingir lo
contrario.

Si algún día eso importa, el camino es un esquema commit-reveal: cada miembro publica un hash
antes del sorteo y revela su secreto después, y el orden se deriva de la combinación. El SDK
soporta re-sembrar el PRNG para eso. No está implementado aquí porque añade una ronda de
transacciones y complejidad considerables para un riesgo que, en el caso de uso, es remoto.

## 6. Pruebas

22 pruebas de host (`Env::default()`, sin red), una por regla:

```sh
cargo test
```

```
running 22 tests
test test::constructor_rechaza_menos_de_dos ... ok
test test::constructor_rechaza_duplicados ... ok
test test::constructor_rechaza_aporte_invalido ... ok
test test::constructor_rechaza_duracion_invalida ... ok
test test::unirse_sin_firma_falla ... ok
test test::unirse_rechaza_no_miembro ... ok
test test::no_se_puede_unir_dos_veces ... ok
test test::el_ultimo_unirse_sortea_y_activa ... ok
test test::no_se_puede_unir_tras_activar ... ok
test test::aportar_antes_de_activar_falla ... ok
test test::aporte_transfiere_al_contrato ... ok
test test::no_se_puede_pagar_dos_veces_la_misma_ronda ... ok
test test::ronda_completa_paga_al_miembro_de_turno ... ok
test test::tanda_completa_paga_a_todos_una_vez ... ok
test test::aportar_despues_de_terminar_falla ... ok
test test::reclamar_antes_del_plazo_falla ... ok
test test::reclamar_devuelve_el_aporte_y_aborta ... ok
test test::no_se_reclama_dos_veces ... ok
test test::ha_pagado_refleja_la_ronda ... ok
test test::resumen_durante_la_inscripcion ... ok
test test::resumen_durante_las_rondas ... ok
test test::resumen_marca_la_tanda_terminada ... ok

test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s
```

| Prueba | Qué garantiza |
| --- | --- |
| `constructor_rechaza_menos_de_dos` | Una tanda de una persona no es una tanda |
| `constructor_rechaza_duplicados` | Un miembro repetido rompería el pozo |
| `constructor_rechaza_aporte_invalido` | No se puede desplegar con cuota cero o negativa |
| `constructor_rechaza_duracion_invalida` | Sin plazo no hay salida de emergencia |
| `unirse_sin_firma_falla` | La inscripción exige la firma del miembro, no la de otro |
| `unirse_rechaza_no_miembro` | Nadie de afuera se cuela en la lista |
| `no_se_puede_unir_dos_veces` | Una firma, un voto: no se infla el conteo |
| `el_ultimo_unirse_sortea_y_activa` | El sorteo produce una permutación real y arranca la tanda |
| `no_se_puede_unir_tras_activar` | Con la tanda activa, la lista está cerrada |
| `aportar_antes_de_activar_falla` | Nadie paga antes de que estén las N firmas |
| `aporte_transfiere_al_contrato` | La plata se mueve de verdad, no es contabilidad interna |
| `no_se_puede_pagar_dos_veces_la_misma_ronda` | Pagar dos veces no acelera el cobro |
| `ronda_completa_paga_al_miembro_de_turno` | El pozo va completo a quien dice el sorteo |
| `tanda_completa_paga_a_todos_una_vez` | Al final todos quedan en cero: nadie pierde ni gana |
| `aportar_despues_de_terminar_falla` | Una tanda terminada no acepta plata |
| `reclamar_antes_del_plazo_falla` | El plazo es real, no decorativo |
| `reclamar_devuelve_el_aporte_y_aborta` | La devolución es exacta y congela la tanda |
| `no_se_reclama_dos_veces` | El reembolso no se puede repetir |
| `ha_pagado_refleja_la_ronda` | El estado de pago que ve el miembro es el real |
| `resumen_durante_la_inscripcion` | Antes de arrancar, `resumen` reporta inscritos, orden vacío y quién falta |
| `resumen_durante_las_rondas` | Con la tanda en marcha, `resumen` dice la ronda, a quién toca y si pagué |
| `resumen_marca_la_tanda_terminada` | Al terminar, `resumen` lo refleja y ya no hay turno |

La prueba del sorteo verifica **propiedades**, no una secuencia: que el resultado sea una
permutación de la lista original y que `a_quien_toca()` coincida con `Orden[0]`. Fijar la
secuencia concreta sería frágil —en los tests el PRNG del host se siembra en cero— y no
probaría nada sobre la calidad del sorteo.

## 7. Corrida real en testnet

Contrato desplegado con tres miembros (`rp-ana`, `rp-beto`, `rp-carol`), cuota de **10 XLM**
y plazo de **120 segundos** (corto, para poder mostrar la salida de emergencia en la misma
sesión).

### 7.1 Estado inicial

```
estado        = "Inscripcion"
inscritos     = 0
ronda         = 0
aporte        = "100000000"   // 10 XLM en stroops
duracion      = 120
orden         = []
a_quien_toca  = null
```

Nadie ha puesto un stroop y el contrato ya no acepta aportes: `aportar` responde
`Error::NoActiva` mientras esté en inscripción.

### 7.2 Inscripción (una firma por persona, con su propia llave)

| Miembro | Devuelve | Transacción |
| --- | --- | --- |
| rp-ana | `1` | [`3835b452…`](https://stellar.expert/explorer/testnet/tx/3835b452efea39e5ff010c0c7bd816d6b132cafd7f320e4f5ff3ba96c04816e3) |
| rp-beto | `2` | [`16e6c6ed…`](https://stellar.expert/explorer/testnet/tx/16e6c6edea3ac79e85c77599b642e6be49177fae8aa7d33cb5b3cf9819ea4d6b) |
| rp-carol | `3` | [`6cde3761…`](https://stellar.expert/explorer/testnet/tx/6cde37615684b300dd64c82d403d77d722c7356cb94b6337dcd55a2414ede110) |

La tercera firma disparó el sorteo. El orden inscrito era **ana, beto, carol**. El orden
sorteado fue otro:

```
estado        = "Activa"
orden         = ["GAINY…FEE" (carol), "GAYXY…C2W" (ana), "GCI73…XBQ" (beto)]
a_quien_toca  = "GAINY…FEE" (carol)
```

Carol cobra primero, después Ana, después Beto. La tanda pasó a `Activa` sin que nadie
interviniera.

### 7.3 Ronda 0 — completa

| Acción | Devuelve | Transacción |
| --- | --- | --- |
| `aportar` ana | `0` | [`83a74531…`](https://stellar.expert/explorer/testnet/tx/83a74531522ca6828be59bc81fa3f53d6b2a7972be305942440ee2529d8202d5) |
| `aportar` beto | `0` | [`1ae607d4…`](https://stellar.expert/explorer/testnet/tx/1ae607d46aba1d6492f905e5ebf2db60427dc578d84738669fb323aeec53fc06) |
| `aportar` carol | `1` | [`18d2e20b…`](https://stellar.expert/explorer/testnet/tx/18d2e20b4f8792b9df90805db0c42286766ff4878b438517cee0f45b8cc6cfdd) |

El tercer aporte completó la ronda: el contrato movió **30 XLM** a Carol y avanzó a la
ronda 1. Verificado en los saldos: Carol terminó con **+20 XLM** (puso 10, cobró 30), antes
de comisiones de red.

### 7.4 Ronda 1 — deserción y devolución

Solo Ana aportó:

| Acción | Resultado | Transacción |
| --- | --- | --- |
| `aportar` ana | `1` | [`75879f01…`](https://stellar.expert/explorer/testnet/tx/75879f01f9dd1bf0974764a944956fca924bd94ce13fca5a471937f72b445a71) |
| `reclamar` ana (dentro del plazo) | ❌ `Error(Contract, #10)` — `PlazoVigente` | — |
| `reclamar` ana (tras 120 s) | `"100000000"` | [`bd3a34cc…`](https://stellar.expert/explorer/testnet/tx/bd3a34ccf5aebc8fb272bce2d8122f2175e197331ae9f33823d6f1abb67dc4b2) |
| `reclamar` ana (segunda vez) | ❌ `Error(Contract, #12)` — `YaDevuelto` | — |

Ana recuperó sus 10 XLM exactos. El estado quedó:

```
estado        = "Abortada"
terminada     = true
a_quien_toca  = null
saldo del contrato = "0"
```

Ninguna plata quedó atrapada: el contrato cerró en cero porque solo Ana había aportado esa
ronda.

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
     --miembros-file-path miembros.json \
     --aporte 100000000 \
     --duracion 604800
```

`miembros.json` es un arreglo de direcciones `G...`:

```json
["GAAA…", "GBBB…", "GCCC…"]
```

Cada miembro firma su inscripción con su propia llave:

```sh
stellar contract invoke --id ronda-pa-todos --source-account <miembro> --network testnet \
  -- unirse --miembro <su-dirección-G...>
```

Y consultar el sorteo antes de poner un solo stroop:

```sh
stellar contract invoke --id ronda-pa-todos --source-account <cualquiera> --network testnet \
  -- orden
```

### La interfaz para el grupo

Hay una interfaz estática en `app/` para que cada amigo firme con su propia wallet, sin tocar
la CLI. Se abre con `?contrato=EL_ID` y no necesita backend.

```sh
cd app
npm install
npm run dev
```

Para desplegar una tanda nueva con las direcciones del grupo:

```powershell
.\scripts\desplegar.ps1 -Miembros GAAA...,GBBB...,GCCC... -Cuenta <tu-identidad> -Aporte 10
```

El flujo completo, los comandos y el aviso de testnet están en [`app/README.md`](app/README.md).

## 9. Límites conocidos

Prefiero que los sepas por mí y no que los descubras tú.

1. **El PRNG depende de los validadores.** Ya explicado en §5. Para una tanda de barrio
   alcanza; no es resistencia criptográfica contra un cartel de validadores.
2. **La deserción no se previene, se contiene.** El plazo y `reclamar` devuelven la cuota de
   la ronda en curso, pero quien ya cobró no devuelve nada. Si en la ronda 3 alguien
   desaparece, los que faltaban cobrar pierden su turno. Es el mismo riesgo que en una tanda
   presencial; el contrato no lo elimina, solo hace que la salida sea ordenada y verificable.
3. **Quien paga y nunca reclama deja su plata en el contrato.** Sin admin no existe función
   de barrido: si alguien aporta una ronda que se aborta y nunca llama `reclamar`, esos
   fondos quedan ahí para siempre. Es el precio directo de §4. Con admin, ese admin podría
   llevarse todo. Además, el registro de quién pagó vive en almacenamiento persistente con
   TTL renovado: si un miembro espera más de ~29 días desde su último aporte para reclamar, su
   registro puede expirar y el reembolso le respondería `NoHaPagado`. Reclamar es una acción
   de días, no de meses.
4. **Los parámetros son irreversibles.** Una cuota mal puesta no se corrige. Hay que desplegar
   de nuevo.
5. **Una firma faltante deja el contrato en inscripción para siempre.** Si un miembro se
   arrepiente antes de firmar, la tanda nunca arranca y no hay forma de expulsarlo ni de
   reemplazarlo. No se pierde plata —nadie ha aportado— pero el contrato queda muerto. Es la
   otra cara de la multifirma: el arranque exige unanimidad real.
6. **No hay incentivo económico para el que cobra último.** En una tanda real, cobrar al final
   es prestar gratis. Aquí eso se resuelve con confianza social, igual que siempre. Un
   contrato no arregla la economía de la tanda; arregla la custodia y el orden.

## 10. Qué haría después

- **Commit-reveal para el sorteo** (§5), si el riesgo de validador deja de ser teórico.
- **Rondas con cobro automático por tiempo** en vez de esperar el último aporte, para que un
  solo moroso no congele el cobro de todos.
- **Historial de tanda en eventos**, para que la app cliente muestre quién pagó qué sin
  consultar cada clave de almacenamiento.
- **Expulsión antes de activar**: si un miembro se arrepiente y nunca firma, hoy el contrato
  queda muerto (§9.5). Una salida con reembolso de firmas y reemplazo permitiría armar el grupo
  sin desplegar de nuevo.
- **Publicar la interfaz**: el build de `app/` es estático y funciona en GitHub Pages, Vercel o
  cualquier hosting; falta decidir dónde.

## 11. Estructura del repo

```
Cargo.toml                          workspace
contracts/ronda_pa_todos/
├── Cargo.toml
├── Makefile
└── src/
    ├── lib.rs                      contrato completo (14 funciones exportadas)
    └── test.rs                     22 pruebas de host
app/                                interfaz estática (Vite + TypeScript)
scripts/desplegar.ps1               despliegue de una tanda nueva en testnet
```

---

Proyecto individual para el bootcamp de Stellar. Contrato desplegado en testnet; ninguna
dirección ni llave de este README debe usarse en mainnet.
