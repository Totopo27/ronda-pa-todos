# Agent instructions

Soroban smart-contract workspace. The contract lives in `contracts/ronda_pa_todos/`.

## Layout

- `Cargo.toml` — workspace root; the contract crate inherits `soroban-sdk` from here
- `contracts/ronda_pa_todos/src/lib.rs` — contract implementation (`#![no_std]`)
- `contracts/ronda_pa_todos/src/test.rs` — host-side unit tests

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
  -- --token <SAC> --aporte 100000000 --duracion 604800 --cupo 3
```

Constructor arguments go after `--`. `--token` is the Stellar Asset Contract id for the asset
the tanda is denominated in (`stellar contract id asset --asset native --network testnet` for
native XLM). `--cupo` is how many places the tanda has (minimum 2); the contract is deployed
empty and each wallet takes a place by signing `unirse` itself.

The contract has no admin: once deployed, cuota, duracion, cupo and the drawn order cannot
change. There is no rescue or sweep function, so a wrong parameter means redeploying.

## Further reading

- https://developers.stellar.org/docs/build/smart-contracts/overview
- https://github.com/stellar/soroban-examples
