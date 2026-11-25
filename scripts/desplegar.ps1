<#
.SYNOPSIS
    Despliega una ronda nueva de RondaPa' Todos en Stellar testnet.

.DESCRIPTION
    Compila el contrato y despliega con un cupo abierto: el
    contrato nace sin miembros y cada wallet ocupa un campo firmando su propia
    inscripción desde la interfaz. Imprime el ID del contrato y el enlace listo
    para repartir.

    Cada grupo necesita su propio despliegue: la cuota, el plazo, el cupo y el
    ritmo de aportes se fijan en el constructor y no se pueden cambiar después.

    SOLO TESTNET. El contrato no está auditado.

.PARAMETER Cupo
    Cuántos campos tiene la ronda (entre 2 y 50).

.PARAMETER Cuenta
    Identidad de Stellar CLI que paga el despliegue (alias de `stellar keys`),
    no una dirección. Ejemplo: rp-deploy.

.PARAMETER Aporte
    Cuota por aporte en unidades del token (acepta decimales). Por defecto 10.

.PARAMETER Decimales
    Decimales del token, para convertir la cuota a unidades mínimas. XLM usa 7.

.PARAMETER DuracionSegundos
    Plazo de cada aporte/turno en segundos. Por defecto 604800 (una semana).

.PARAMETER AportesPorTurno
    Cuántos aportes por miembro reúne cada turno antes de entregar la buchaca. Por defecto 1.

.PARAMETER EsperaSegundos
    Segundos de espera tras completarse un periodo de aportes antes de abrir el siguiente. Por defecto 0 (inmediato).

.PARAMETER Token
    ID del token (contrato SAC). Si se omite, se resuelve el XLM nativo de testnet.

.PARAMETER BaseUrl
    URL donde está publicada la interfaz. Si se pasa, se imprime el enlace completo.

.EXAMPLE
    .\scripts\desplegar.ps1 -Cupo 3 -Cuenta rp-deploy -Aporte 10 -DuracionSegundos 604800
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [int]$Cupo,

    [Parameter(Mandatory = $true)]
    [string]$Cuenta,

    [decimal]$Aporte = 10,

    [int]$Decimales = 7,

    [int]$DuracionSegundos = 604800,

    [int]$AportesPorTurno = 1,

    [int]$EsperaSegundos = 0,

    [string]$Token,

    [string]$BaseUrl
)

$ErrorActionPreference = "Stop"

# --- Utilidades -------------------------------------------------------------

function Fallar([string]$mensaje) {
    Write-Host "ERROR: $mensaje" -ForegroundColor Red
    exit 1
}

# PowerShell 5.1 convierte cada línea de stderr de un ejecutable nativo en un
# ErrorRecord. Con ErrorActionPreference = "Stop" eso aborta el script por un
# aviso cosmético de cargo o stellar. Este helper lo aisla y devuelve el código
# real del proceso.
function Invocar-Nativo([scriptblock]$bloque) {
    $previo = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $lineas = & $bloque 2>&1 | ForEach-Object { "$_" }
        $codigo = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previo
    }
    return [pscustomobject]@{ Codigo = $codigo; Salida = @($lineas) }
}

function Buscar-Stellar {
    $enPath = Get-Command stellar -ErrorAction SilentlyContinue
    if ($enPath) { return $enPath.Source }

    $candidato = Join-Path $env:LOCALAPPDATA "Programs\stellar\stellar.exe"
    if (Test-Path $candidato) { return $candidato }

    Fallar "No encuentro Stellar CLI. Instálalo o agrégalo al PATH."
}

# --- Validaciones -----------------------------------------------------------

if ($Cupo -lt 2 -or $Cupo -gt 50) {
    Fallar "El cupo debe estar entre 2 y 50 campos."
}

if ($Aporte -le 0) { Fallar "La cuota tiene que ser mayor que cero." }
if ($DuracionSegundos -lt 60 -or $DuracionSegundos -gt 1209600) {
    Fallar "La duración debe estar entre 60 y 1 209 600 segundos (14 días)."
}
if ($AportesPorTurno -lt 1 -or $AportesPorTurno -gt 24) {
    Fallar "Los aportes por turno deben estar entre 1 y 24."
}
if ($EsperaSegundos -lt 0 -or $EsperaSegundos -gt 1209600) {
    Fallar "La espera entre aportes debe estar entre 0 y 1 209 600 segundos (14 días)."
}

$factor = [long][math]::Pow(10, $Decimales)
$aporteMinimo = [long]($Aporte * $factor)
if ($aporteMinimo -le 0) { Fallar "La cuota, en unidades mínimas, quedó en cero." }

$stellar = Buscar-Stellar
$raiz = Split-Path -Parent $PSScriptRoot
$wasm = Join-Path $raiz "target\wasm32v1-none\release\ronda_pa_todos.wasm"

# --- Token ------------------------------------------------------------------

if (-not $Token) {
    Write-Host "Resolviendo el SAC del XLM en testnet..."
    $resolucion = Invocar-Nativo { & $stellar contract id asset --asset native --network testnet }
    if ($resolucion.Codigo -ne 0) {
        Fallar "No pude resolver el SAC del XLM. Pasa -Token a mano."
    }
    $Token = ($resolucion.Salida | Where-Object { $_ -match '^C[A-Z2-7]{55}$' } | Select-Object -Last 1)
}
if ($Token -notmatch '^C[A-Z2-7]{55}$') {
    Fallar "'$Token' no parece un contrato de token (C + 55 caracteres)."
}
$Token = $Token.Trim()

# --- Build ------------------------------------------------------------------

Write-Host "Compilando el contrato..."
Push-Location $raiz
try {
    $build = Invocar-Nativo { & $stellar contract build }
}
finally {
    Pop-Location
}
if ($build.Codigo -ne 0) {
    $build.Salida | ForEach-Object { Write-Host $_ }
    Fallar "Falló 'stellar contract build'."
}
if (-not (Test-Path $wasm)) { Fallar "No encuentro el wasm compilado en $wasm." }

# --- Despliegue -------------------------------------------------------------

Write-Host ("Desplegando en testnet: cupo {0}, cuota {1}, plazo {2} s, aportes/turno {3}, espera {4} s..." -f $Cupo, $Aporte, $DuracionSegundos, $AportesPorTurno, $EsperaSegundos)

$despliegue = Invocar-Nativo {
    & $stellar contract deploy `
        --wasm $wasm `
        --source-account $Cuenta `
        --network testnet `
        -- --token $Token `
           --aporte $aporteMinimo `
           --duracion $DuracionSegundos `
           --cupo $Cupo `
           --aportes_por_turno $AportesPorTurno `
           --espera $EsperaSegundos
}

if ($despliegue.Codigo -ne 0) {
    $despliegue.Salida | ForEach-Object { Write-Host $_ }
    Fallar "Falló el despliegue. Revisa la cuenta, el saldo de testnet y la salida de arriba."
}

$id = ($despliegue.Salida | Where-Object { $_ -match '^C[A-Z2-7]{55}$' } | Select-Object -Last 1)
if (-not $id) {
    $despliegue.Salida | ForEach-Object { Write-Host $_ }
    Fallar "El despliegue no devolvió un ID de contrato reconocible."
}

# --- Resultado --------------------------------------------------------------

Write-Host ""
Write-Host "Contrato desplegado:" -ForegroundColor Green
Write-Host "  $id"
Write-Host ""
Write-Host ("El contrato nace vacío y espera {0} firmas. Reparte este enlace:" -f $Cupo)
if ($BaseUrl) {
    $separador = if ($BaseUrl.Contains("?")) { "&" } else { "?" }
    Write-Host "  $BaseUrl$($separador)contrato=$id"
}
else {
    Write-Host "  <tu-url-de-la-interfaz>?contrato=$id"
}
Write-Host ""
Write-Host "Cualquiera con ese enlace puede ocupar un campo libre: el contrato no distingue"
Write-Host "invitados de desconocidos. Manda el enlace solo a quien quieras dentro."
Write-Host ""
Write-Host "Comprobación de lecturas:"
Write-Host "  cd app; npm run smoke -- $id"
