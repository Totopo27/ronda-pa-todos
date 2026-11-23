# RondaPa' Todos — interfaz

Interfaz estática para una tanda de `RondaPa' Todos` en **Stellar testnet**. No hay backend:
todo pasa en el navegador. El contrato se elige con `?contrato=C...`, así que un mismo build
sirve para cualquier tanda.

> **Solo testnet.** El contrato no está auditado. No lo uses con dinero real. Los XLM de
> testnet no valen nada.

## Qué hace

- Lee el estado de la tanda con **una** llamada `resumen(miembro)` por refresco (cada 5 s y
  tras cada acción confirmada).
- Deriva **una sola** acción posible según el estado: firmar la inscripción, aportar la cuota
  o recuperar el aporte cuando venció el plazo. Si no hay nada que hacer, explica por qué.
- Muestra quién falta por firmar, el orden de cobro sorteado y la cuenta regresiva del plazo.
- Traduce los 13 errores del contrato a una frase en español.
- Firma con **Freighter**: el cliente nunca pide ni manipula llaves privadas, solo envía el XDR
  a la extensión y recibe el XDR firmado.
- Si Freighter está en otra red, bloquea las escrituras con un aviso explícito.

## Requisitos

- Node 20 o superior.
- Extensión [Freighter](https://freighter.app/) en el navegador, configurada en **testnet**.

## Desarrollo

```sh
cd app
npm install
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

Cada grupo necesita **su propio despliegue**: la lista de miembros se fija en el constructor y
no se puede cambiar después. Reutilizar un contrato de otro grupo no funciona.

1. **Cada amigo copia su dirección `G...`** desde Freighter (testnet) y se la pasa al
   organizador.

2. **El organizador despliega** con el script del repo:

   ```powershell
   .\scripts\desplegar.ps1 `
     -Miembros GAAA...,GBBB...,GCCC... `
     -Cuenta rp-deploy `
     -Aporte 10 `
     -DuracionSegundos 604800
   ```

   - `-Miembros`: dos o más direcciones `G...`, sin repetidos.
   - `-Cuenta`: identidad de Stellar CLI que paga el despliegue (alias de `stellar keys`), no
     una dirección.
   - `-Aporte`: cuota por ronda en unidades enteras del token (XLM por defecto).
   - `-DuracionSegundos`: plazo de cada ronda. `604800` es una semana.
   - `-Token`: opcional; si se omite, resuelve el SAC del XLM nativo de testnet.
   - `-BaseUrl`: opcional; si pasas dónde está publicada esta interfaz, imprime el enlace
     completo.

   El script compila si hace falta, valida las direcciones, despliega e imprime el ID.

3. **Se reparte el enlace** `…/?contrato=EL_ID`.

4. **Cada miembro conecta Freighter y firma su inscripción.** La tanda arranca sola cuando
   firma el último; el orden de cobro lo sortea la red en ese momento y nadie puede elegirlo.

5. **Cada ronda, todos aportan la cuota** y el pozo completo va a quien toca según el orden.

Si alguien no aporta antes de que venza el plazo, quien sí aportó puede recuperar su cuota de
esa ronda. La primera devolución congela la tanda: ya no se cobra más.

## Si algo sale mal

- **`NoConfigurado`**: el contrato no tiene token configurado. Vuelve a desplegar con `-Token`.
- **`NoActiva` / `InscripcionCerrada`**: la tanda aún no arrancó o ya arrancó. Revisa el panel
  de firmas.
- **`NoHaPagado`**: intentaste recuperar el aporte sin haber aportado esa ronda, o el registro
  de tu pago expiró (vive ~29 días en almacenamiento persistente). Reclamar es una acción de
  días, no de meses.
- **`PlazoVigente`**: todavía no venció el plazo de la ronda.
- **Freighter en otra red**: cambia la extensión a testnet; la app bloquea las escrituras hasta
  entonces.

## Estructura

```
app/
├── index.html            estructura de la página
├── src/
│   ├── logica.ts         lógica pura: errores, acciones, formato, cuenta regresiva
│   ├── logica.test.ts    pruebas de la lógica pura
│   ├── cadena.ts         Soroban RPC + cliente del contrato
│   ├── billetera.ts      wrapper de Freighter
│   ├── main.ts           pintado del DOM y flujo de acciones
│   └── estilo.css        estilos
├── smoke.mjs             comprobación de lecturas de un contrato desplegado
└── vite.config.ts        build con rutas relativas, Vitest en entorno node
```

## Contrato de ejemplo

`CALGMJCGQTCL2EPNPC2W2KW5W32REZ2WKLOAZ47G4363XGD7LEJCQ7SW` (testnet, cuota 10 XLM, rondas de
10 minutos). Es un despliegue de demostración; los miembros son cuentas de prueba del
organizador, no personas reales.
