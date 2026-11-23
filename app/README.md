# RondaPa' Todos — interfaz

Interfaz estática para una tanda de `RondaPa' Todos` en **Stellar testnet**. No hay backend:
todo pasa en el navegador. El contrato se elige con `?contrato=C...`, así que un mismo build
sirve para cualquier tanda.

> **Solo testnet.** El contrato no está auditado. No lo uses con dinero real. Los XLM de
> testnet no valen nada.

## Qué hace

- Lee el estado de la tanda con **una** llamada `resumen(miembro)` por refresco (cada 5 s y
  tras cada acción confirmada).
- Deriva **una sola** acción posible según el estado: ocupar un lugar, aportar la cuota
  o recuperar el aporte cuando venció el plazo. Si no hay nada que hacer, explica por qué.
- Muestra cuántos lugares van ocupados, el orden de cobro sorteado y la cuenta regresiva del
  plazo.
- Traduce los 13 errores del contrato a una frase en español.
- Abre un selector de wallets con **Stellar Wallets Kit**. Admite Varial (antes Freighter) y,
  cuando se configura un Project ID de Reown, WalletConnect para firmar desde móvil.
- El cliente nunca pide ni manipula llaves privadas: envía el XDR a la wallet elegida y recibe
  el XDR firmado. Si esa wallet está en otra red, bloquea las escrituras.
- Ofrece un enlace de Friendbot para fondear directamente la cuenta conectada con XLM de prueba.

## Requisitos

- Node 20 o superior.
- Una wallet Stellar compatible, configurada en **testnet**.
- Para WalletConnect, un Project ID gratuito de [Reown Cloud](https://cloud.reown.com/).

## Desarrollo

```sh
cd app
npm install
cp .env.example .env.local
# Sustituye el valor por tu Project ID de Reown
npm run dev
```

Abre la URL que imprime Vite y añade `?contrato=EL_ID_DE_TU_TANDA`.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo con recarga. |
| `npm run build` | Typecheck (`tsc --noEmit`) y build de producción en `dist/`. |
| `npm run preview` | Sirve `dist/` para probar el build real. |
| `npm test` | Pruebas de la lógica pura (Vitest). |
| `npm run test:watch` | Las mismas pruebas en modo interactivo. |
| `npm run smoke -- C...` | Comprueba las lecturas de un contrato desplegado. No firma nada. |

`npm run build` deja rutas relativas (`./assets/...`), así que `dist/` funciona servido desde
cualquier carpeta: GitHub Pages, un subdirectorio o incluso abierto con doble clic (con
limitaciones del navegador para módulos).

## Flujo completo para un grupo nuevo

Cada grupo necesita **su propio despliegue**: la cuota, el plazo y el cupo se fijan en el
constructor y no se pueden cambiar después. Reutilizar un contrato de otro grupo no funciona.

1. **El organizador decide el cupo** (cuántas personas van a ser) y despliega con el script del
   repo. No necesita juntar las direcciones de nadie:

   ```powershell
   .\scripts\desplegar.ps1 `
     -Cupo 3 `
     -Cuenta rp-deploy `
     -Aporte 10 `
     -DuracionSegundos 604800
   ```

   - `-Cupo`: cuántos lugares tiene la tanda. Mínimo dos.
   - `-Cuenta`: identidad de Stellar CLI que paga el despliegue (alias de `stellar keys`), no
     una dirección.
   - `-Aporte`: cuota por ronda en unidades enteras del token (XLM por defecto).
   - `-DuracionSegundos`: plazo de cada ronda. `604800` es una semana.
   - `-Token`: opcional; si se omite, resuelve el SAC del XLM nativo de testnet.
   - `-BaseUrl`: opcional; si pasas dónde está publicada esta interfaz, imprime el enlace
     completo.

   El script compila si hace falta, despliega e imprime el ID y el enlace.

2. **Se reparte el enlace** `…/?contrato=EL_ID` a quienes van a participar.

3. **Cada persona conecta su wallet y firma su inscripción.** El contrato nace vacío y no
   distingue invitados de desconocidos: **ocupa un lugar quien llega primero con el enlace**.
   Cuando se llena el cupo, la última firma dispara el sorteo del orden de cobro y nadie puede
   elegirlo.

   Por eso el enlace se manda solo al grupo, no se publica: cualquiera que lo tenga puede
   entrar mientras queden lugares.

4. **Cada ronda, todos aportan la cuota** y el pozo completo va a quien toca según el orden.

Si alguien no aporta antes de que venza el plazo, quien sí aportó puede recuperar su cuota de
esa ronda. La primera devolución congela la tanda: ya no se cobra más.

## Si algo sale mal

- **`NoConfigurado`**: el contrato no tiene token configurado. Vuelve a desplegar con `-Token`.
- **`NoActiva` / `InscripcionCerrada`**: la tanda aún no arrancó o ya arrancó. Revisa el panel
  de inscripciones. `InscripcionCerrada` también es la respuesta de `unirse` cuando el cupo
  ya está lleno.
- **`YaInscrito`**: esa cuenta ya ocupó un lugar en esta tanda.
- **`CupoInvalido`**: el despliegue se hizo con un cupo menor que dos. Hay que desplegar otro.
- **`NoHaPagado`**: intentaste recuperar el aporte sin haber aportado esa ronda, o el registro
  de tu pago expiró (vive ~29 días en almacenamiento persistente). Reclamar es una acción de
  días, no de meses.
- **`PlazoVigente`**: todavía no venció el plazo de la ronda.
- **Wallet en otra red**: cámbiala a testnet; la app bloquea las escrituras hasta entonces.

## Estructura

```
app/
├── index.html            estructura de la página
├── src/
│   ├── logica.ts         lógica pura: errores, acciones, formato, cuenta regresiva
│   ├── logica.test.ts    pruebas de la lógica pura
│   ├── cadena.ts         Soroban RPC + cliente del contrato
│   ├── billetera.ts      Stellar Wallets Kit + WalletConnect
│   ├── main.ts           pintado del DOM y flujo de acciones
│   └── estilo.css        estilos
├── smoke.mjs             comprobación de lecturas de un contrato desplegado
└── vite.config.ts        build con rutas relativas, Vitest en entorno node
```

## Contrato para la prueba

`CBHIPV67AJV5OMBRH5VD7FB47FRFCOTQ67ZMHP6G3QX2LQOWCKAHKPXX` está en testnet, en estado
`Inscripcion`, con cupo 3, cuota de 10 XLM y plazo de `604800` segundos por ronda (una semana).

## Evidencia histórica

`CAERWTX44RAZNQ6UK4XSHB6P22DRPJ4OPBO2QYDZDMHNOWBC5SX47UU4` (testnet, cupo 3, cuota 10 XLM,
rondas de 10 minutos). Es evidencia histórica de la salida de emergencia: quedó en estado
`Abortada` y **no sirve para una prueba nueva**. Despliega otro contrato con un plazo realista,
por ejemplo `604800` segundos (una semana).
