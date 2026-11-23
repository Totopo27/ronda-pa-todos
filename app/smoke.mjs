// Smoke de lecturas contra un contrato desplegado en testnet.
//
//   node smoke.mjs C...
//
// No firma nada ni gasta stroops: solo simula `resumen()` y lee del token.
// Sirve para comprobar que el ID responde y que el contrato tiene el spec que
// la app espera antes de mandarle el enlace a nadie.

import { contract } from "@stellar/stellar-sdk";

const RPC = "https://soroban-testnet.stellar.org";
const PASSHRASE = "Test SDF Network ; September 2015";

const id = process.argv[2];

if (!id) {
  console.error("Uso: node smoke.mjs <ID_DEL_CONTRATO>");
  console.error("El ID empieza por C y tiene 56 caracteres.");
  process.exit(1);
}

if (!/^C[A-Z2-7]{55}$/.test(id)) {
  console.error(`"${id}" no parece un contrato Stellar (C + 55 caracteres base32).`);
  process.exit(1);
}

/** Los BigInt no se serializan con JSON.stringify por defecto. */
function acortar(direccion) {
  return `${direccion.slice(0, 4)}…${direccion.slice(-4)}`;
}

const cliente = await contract.Client.from({
  contractId: id,
  rpcUrl: RPC,
  networkPassphrase: PASSHRASE,
});

// Siempre con el objeto de argumentos: `resumen()` sin argumento revienta en
// el host con `Error(WasmVm, UnexpectedSize)`.
const { result } = await cliente.resumen({ miembro: undefined });

console.log(`Contrato ${id}`);
console.log(`  estado:    ${result.estado?.tag ?? result.estado}`);
console.log(`  ronda:     ${result.ronda} de ${result.cupo}`);
console.log(`  cupo:      ${result.inscritos} de ${result.cupo} lugares ocupados`);
console.log(`  aporte:    ${result.aporte} (unidades mínimas del token)`);
console.log(`  duracion:  ${result.duracion} s`);
console.log(`  inicio:    ${Number(result.inicio) === 0 ? "sin arrancar" : result.inicio}`);
console.log(`  toca a:    ${result.a_quien_toca ? acortar(result.a_quien_toca) : "nadie"}`);
console.log(`  orden:     ${result.orden.length === 0 ? "(sin sortear)" : result.orden.map(acortar).join(" → ")}`);

if (result.token) {
  const token = await contract.Client.from({
    contractId: result.token,
    rpcUrl: RPC,
    networkPassphrase: PASSHRASE,
  });
  const [decimales, simbolo] = await Promise.all([token.decimals(), token.symbol()]);
  const bruto = String(simbolo.result ?? "");
  console.log(`  token:     ${bruto === "native" || bruto === "" ? "XLM" : bruto} (${decimales.result} decimales)`);
} else {
  console.log("  token:     (el contrato no reporta token)");
}

console.log("\nLecturas OK.");
