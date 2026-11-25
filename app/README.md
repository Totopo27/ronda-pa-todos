# RondaPa' Todos — interfaz

Interfaz estática para crear y participar en rondas de `RondaPa' Todos` en **Stellar testnet**.
No hay backend: todo pasa en el navegador. El contrato se elige con `?contrato=C...` o se
despliega uno nuevo directamente desde la página principal.

> **Solo testnet.** El contrato no está auditado. No lo uses con dinero real. Los XLM de
> testnet no valen nada.

## Qué hace

- **Crea rondas nuevas desde el navegador** usando el Wasm publicado en testnet
  (`Operation.createCustomContract`): por defecto en modo inmediato (`1` aporte por turno, sin
  espera) para probar rápido, y con una sección desplegable opcional para definir periodo y
  frecuencia de ahorro (hasta 24 aportes por turno y espera entre aportes, con vista previa de la
  buchaca grande).
- **Lee el estado completo** con `resumen(miembro)`, `ha_pagado(miembro)` por participante y
  `decimals()`/`symbol()` del token, refrescando cada 5 s y tras cada acción confirmada.
- **Muestra el avance y los cobros:** barra de aportes reunidos en el turno actual, estado por
  miembro (`aportó` / `pendiente`), sección **Buchacas entregadas** por cada turno cerrado y aviso
  cuando se completa un turno.
- **Deriva una sola acción posible** según el estado: ocupar un campo, aportar la cuota o
  recuperar lo acumulado cuando venció el plazo (y espera la apertura si el ritmo aún no abre el
  siguiente periodo).
- **Facilita compartir:** botones **Copiar enlace** y **Crear otra ronda** en cada ronda abierta.
- **Traduce los 16 errores del contrato** a una frase en español.
- **Wallets y fondeo:** conecta con **Varial** (antes Freighter, vía `@stellar/freighter-api`),
  ofrece selector con **WalletConnect** (`@walletconnect/sign-client` y código QR nativo) si se
  configura un Project ID de Reown, bloquea escrituras si la wallet no está en testnet y enlaza
  Friendbot cuando la cuenta aún no existe en testnet.

## Requisitos

- Node 20 o superior.
- Una wallet Stellar compatible, configurada en **testnet**.
- Para WalletConnect, un Project ID gratuito de [Reown Cloud](https://cloud.reown.com/).

## Desarrollo

```sh
cd app
npm install
cp .env.example .env.local
# Sustituye el valor por tu Project ID de Reown (opcional)
npm run dev
```

Abre la URL que imprime Vite para crear una ronda nueva, o añade `?contrato=EL_ID_DE_TU_RONDA`.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo con recarga. |
| `npm run build` | Typecheck (`tsc --noEmit`) y build de producción en `dist/`. |
| `npm run preview` | Sirve `dist/` para probar el build real. |
| `npm test` | Pruebas de la lógica pura, billetera y cadena (Vitest). |
| `npm run test:watch` | Las mismas pruebas en modo interactivo. |
| `npm run smoke -- C...` | Comprueba las lecturas de un contrato desplegado. No firma nada. |

`npm run build` deja rutas relativas (`./assets/...`), así que `dist/` funciona servido desde
cualquier carpeta o hosting estático.

## Publicación en Vercel

La app es estática: Vercel solo publica `dist/`. No hay backend ni funciones.

| Ajuste | Valor |
| --- | --- |
| Root Directory | `app` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version | `22.x` (fijado en `engines`; Vite 8 exige `^20.19` o `>=22.12`) |

El **Root Directory** tiene que ser `app`, no la raíz: arriba hay un workspace de Rust que
Vercel no necesita compilar.

Variables de entorno (opcional, solo para firmar desde móvil):

- `VITE_WALLETCONNECT_PROJECT_ID`: Project ID de Reown. Sin ella la app ofrece únicamente
  Varial/Freighter de extensión. El dominio de producción debe estar permitido en ese proyecto.

El contrato **no** va en una variable: entra por `?contrato=C...` o se instancia en el navegador.

`vercel.json` añade cabeceras de seguridad y cache inmutable para `/assets/*` (Vite pone un
hash en cada nombre). No lleva `rewrites`: la app no tiene rutas de cliente, todo viaja por
query string.

## Flujo completo para un grupo nuevo

Cada grupo necesita **su propio despliegue**: la cuota, el plazo, el cupo y el ritmo se fijan en
el constructor y no se pueden cambiar después.

1. **Crea la ronda desde la web (o por CLI):**
   - Desde la web: conecta tu wallet en testnet, ajusta campos, cuota y plazo (o abre
     *Personalizar periodo y frecuencia de ahorro* para metas de varios aportes por turno) y firma
     **Crear ronda nueva**.
   - Por CLI:

   ```powershell
   .\scripts\desplegar.ps1 `
     -Cupo 3 `
     -Cuenta rp-deploy `
     -Aporte 10 `
     -DuracionSegundos 604800 `
     -AportesPorTurno 1 `
     -EsperaSegundos 0
   ```

   - `-Cupo`: cuántos campos tiene la ronda (2 a 50).
   - `-Cuenta`: identidad de Stellar CLI que paga el despliegue (alias de `stellar keys`), no
     una dirección.
   - `-Aporte`: cuota por aporte en unidades del token (XLM por defecto).
   - `-DuracionSegundos`: plazo límite por aporte/turno en segundos (`60` a `1209600`).
   - `-AportesPorTurno`: cuántos aportes por miembro reúne cada turno (`1` a `24`, por defecto `1`).
   - `-EsperaSegundos`: espera entre un periodo de aportes y el siguiente (`0` a `1209600`, por defecto `0`).
   - `-Token`: opcional; si se omite, resuelve el SAC del XLM nativo de testnet.
   - `-BaseUrl`: opcional; si pasas dónde está publicada esta interfaz, imprime el enlace
     completo.

   El script siempre recompila el Wasm, despliega e imprime el ID y el enlace.

2. **Reparte el enlace** `…/?contrato=EL_ID` (o usa **Copiar enlace** en la app) al grupo.

3. **Cada persona conecta su wallet y firma su inscripción.** El contrato nace vacío y no
   distingue invitados de desconocidos: **ocupa un campo quien llega primero con el enlace**.
   Cuando se llena el cupo, la última firma dispara la rifa del orden de cobro y nadie puede
   elegirlo.

4. **En cada turno, todos aportan según el ritmo configurado** y la buchaca completa se envía
   automáticamente al destinatario correspondiente.

Si alguien deja de aportar y vence el plazo, quien ya aportó puede recuperar todo lo que puso en
ese turno con **Reclamar**. La primera devolución congela la ronda en `Abortada`.

## Si algo sale mal

- **`NoConfigurado`**: el contrato no tiene token configurado. Vuelve a desplegar con `-Token`.
- **`NoActiva` / `InscripcionCerrada`**: la ronda aún no arrancó o ya arrancó. `InscripcionCerrada`
  también es la respuesta de `unirse` cuando el cupo ya está lleno.
- **`YaInscrito`**: esa cuenta ya ocupó un campo en esta ronda.
- **`CupoInvalido` / `AportesPorTurnoInvalido` / `EsperaInvalida`**: algún parámetro del
  despliegue está fuera de los límites (`cupo` 2..50, `aportes_por_turno` 1..24, `espera`/`duracion`
  hasta 14 días).
- **`AporteAunNoAbierto`**: la ronda usa espera entre aportes y todavía no llega la fecha de
  apertura del siguiente periodo.
- **`NoHaPagado`**: intentaste recuperar el aporte sin haber aportado ese turno, o el registro
  requiere restauración tras ~29 días sin actividad.
- **`PlazoVigente`**: todavía no venció el plazo límite del aporte en curso.
- **Wallet en otra red**: cámbiala a testnet; la app bloquea las escrituras hasta entonces.

## Estructura

```
app/
├── index.html            estructura de la página
├── src/
│   ├── logica.ts         lógica pura: validación, errores, acciones, formato, cuenta regresiva
│   ├── logica.test.ts    pruebas de la lógica pura
│   ├── cadena.ts         Soroban RPC, despliegue en navegador y cliente del contrato
│   ├── cadena.test.ts    pruebas de consultas Horizon
│   ├── billetera.ts      Varial/Freighter (@stellar/freighter-api) + WalletConnect QR
│   ├── billetera.test.ts pruebas de integración de billetera
│   ├── main.ts           pintado del DOM y flujo de acciones
│   └── estilo.css        estilos
├── smoke.mjs             comprobación de lecturas de un contrato desplegado
└── vite.config.ts        build con rutas relativas, Vitest en entorno node
```

## Contratos de referencia

- **Ronda de ejemplo (en curso):** `CBHIPV67AJV5OMBRH5VD7FB47FRFCOTQ67ZMHP6G3QX2LQOWCKAHKPXX`
  (testnet, cupo 3, cuota 10 XLM, plazo de `604800` segundos — cupo ya lleno).
- **Evidencia histórica:** `CAERWTX44RAZNQ6UK4XSHB6P22DRPJ4OPBO2QYDZDMHNOWBC5SX47UU4`
  (testnet, cupo 3, cuota 10 XLM, turnos de 10 minutos, quedó en `Abortada`).

Para probar una ronda desde cero, crea una nueva directo desde la portada de la web.
