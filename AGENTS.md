# Agent instructions

Soroban smart-contract workspace. The contract lives in `contracts/ronda_pa_todos/`.

## Layout

- `Cargo.toml` — workspace root; the contract crate inherits `soroban-sdk` from here
- `contracts/ronda_pa_todos/src/lib.rs` — contract implementation (`#![no_std]`)
- `contracts/ronda_pa_todos/src/test.rs` — host-side unit tests
- `app/` — static Vite + TypeScript web interface
- `scripts/desplegar.ps1` — testnet deployment helper

## Build

```sh
stellar contract build
```

Do not substitute this with `cargo build --target wasm32v1-none`. `stellar contract build`
applies the flags and metadata the network expects. The `wasm32v1-none` target must be
installed (`rustup target add wasm32v1-none`); Rust 1.84 or newer is required.

## Test

```sh
cargo test
```

Host tests run on the normal Cargo harness, not on-chain.

## Deploy

```sh
stellar contract deploy \
  --wasm target/wasm32v1-none/release/ronda_pa_todos.wasm \
  --source-account <identity> \
  --network testnet \
  --alias ronda-pa-todos \
  -- --token <SAC> --aporte 100000000 --duracion 604800 --cupo 3 --aportes_por_turno 1 --espera 0
```

Constructor arguments go after `--`. `--token` is the Stellar Asset Contract id for the asset
the ronda is denominated in (`stellar contract id asset --asset native --network testnet` for
native XLM). Constructor bounds: `--cupo` (`2..=50`, how many campos the ronda has),
`--aporte` (`> 0` and total buchaca `aporte * cupo * aportes_por_turno` must not overflow),
`--duracion` (`60..=1_209_600` seconds), `--aportes_por_turno` (`1..=24`), and `--espera`
(`0..=1_209_600` seconds). The contract is deployed empty and each wallet takes a campo by
signing `unirse` itself.

The contract has no admin: once deployed, cuota, duracion, cupo, aportes_por_turno, espera, and
the drawn order cannot change. There is no rescue or sweep function, so a wrong parameter means
redeploying.

## Further reading

- https://developers.stellar.org/docs/build/smart-contracts/overview
- https://github.com/stellar/soroban-examples
