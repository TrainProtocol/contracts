# Deterministic multi-testnet deploy: same contract addresses on every chain (CreateX CREATE2,
# factory 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed — see DeployDeterministic.s.sol).
#
# Usage (from anywhere; the script cd's to the foundry root itself):
#   .\script\deploy-testnets.ps1                          # deploy + verify on all 7 testnets
#   .\script\deploy-testnets.ps1 -Chains sepolia          # single chain pilot
#   .\script\deploy-testnets.ps1 -DryRun                  # simulate everywhere, broadcast nothing
#   .\script\deploy-testnets.ps1 -NoVerify                # deploy without explorer verification
#
# Requires: PRIVATE_KEY (0x-prefixed) in env or .env; ETHERSCAN_API_KEY for verification.
# Windows PowerShell 5.1 compatible.

param(
  [string[]] $Chains,
  [switch]   $DryRun,
  [switch]   $NoVerify
)

$ErrorActionPreference = 'Stop'

# Anvil's well-known key #0. Only used for -DryRun simulations when no PRIVATE_KEY is set;
# CREATE2 addresses do not depend on the deployer key, so any key predicts the same result.
$DummyPk = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

# Single source of truth for the targets. Alias must match [rpc_endpoints] in foundry.toml.
$AllChains = @(
  @{ Alias = 'sepolia';          ChainId = 11155111; Verifier = 'etherscan' }
  @{ Alias = 'arbitrum_sepolia'; ChainId = 421614;   Verifier = 'etherscan' }
  @{ Alias = 'base_sepolia';     ChainId = 84532;    Verifier = 'etherscan' }
  @{ Alias = 'optimism_sepolia'; ChainId = 11155420; Verifier = 'etherscan' }
  @{ Alias = 'bsc_testnet';      ChainId = 97;       Verifier = 'etherscan'; ExtraArgs = @('--legacy') }
  @{ Alias = 'linea_sepolia';    ChainId = 59141;    Verifier = 'etherscan' }
  @{ Alias = 'monad_testnet';    ChainId = 10143;    Verifier = 'etherscan'
     VerifierUrl = 'https://api.etherscan.io/v2/api?chainid=10143' }
)

$FoundryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $FoundryRoot
try {
  # Pin the build profile so a leaked FOUNDRY_PROFILE (e.g. 'tron') can't change the initcode
  # and thereby the CREATE2 addresses.
  $env:FOUNDRY_PROFILE = 'default'

  # Load .env (KEY=VALUE lines); real environment variables take precedence.
  $envFile = Join-Path $FoundryRoot '.env'
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      $trimmed = $line.Trim()
      if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
      $idx = $trimmed.IndexOf('=')
      if ($idx -lt 1) { continue }
      $name = $trimmed.Substring(0, $idx).Trim()
      $value = $trimmed.Substring($idx + 1).Trim()
      if ($value -ne '' -and -not (Test-Path "Env:$name")) {
        Set-Item -Path "Env:$name" -Value $value
      }
    }
  }

  if (-not $env:PRIVATE_KEY) {
    if ($DryRun) {
      Write-Host 'PRIVATE_KEY not set; using a dummy key for simulation (addresses are key-independent).' -ForegroundColor Yellow
      $env:PRIVATE_KEY = $DummyPk
    } else {
      throw 'PRIVATE_KEY is not set (env or .env). Aborting.'
    }
  }
  if (-not $NoVerify -and -not $DryRun -and -not $env:ETHERSCAN_API_KEY) {
    Write-Host 'WARNING: ETHERSCAN_API_KEY not set - Etherscan verification will fail. Use -NoVerify to silence.' -ForegroundColor Yellow
  }

  if (-not $Chains -or $Chains.Count -eq 0) {
    $targets = $AllChains
  } else {
    $targets = @()
    foreach ($requested in $Chains) {
      $match = $AllChains | Where-Object { $_.Alias -eq $requested }
      if (-not $match) {
        $known = ($AllChains | ForEach-Object { $_.Alias }) -join ', '
        throw "Unknown chain alias '$requested'. Known: $known"
      }
      $targets += $match
    }
  }

  # Predict the canonical addresses once, offline. Every chain must land exactly these.
  Write-Host 'Predicting deterministic addresses (offline)...' -ForegroundColor Cyan
  $predictOutput = & forge script script/DeployDeterministic.s.sol --sig 'predict()' | Out-String
  if ($LASTEXITCODE -ne 0) {
    Write-Host $predictOutput
    throw 'Offline address prediction failed (forge script --sig predict()).'
  }
  $expected = @{}
  foreach ($name in @('ConstantPayoutCurve', 'Train', 'TrainRouter')) {
    if ($predictOutput -match "$name\s*:\s*(0x[0-9a-fA-F]{40})") {
      $expected[$name] = $Matches[1]
    } else {
      throw "Could not parse predicted $name address from forge output."
    }
  }
  Write-Host ("  ConstantPayoutCurve: " + $expected['ConstantPayoutCurve'])
  Write-Host ("  Train              : " + $expected['Train'])
  Write-Host ("  TrainRouter        : " + $expected['TrainRouter'])
  Write-Host ''

  $results = @()
  foreach ($chain in $targets) {
    $alias = $chain.Alias
    Write-Host ('=== ' + $alias + ' (chain id ' + $chain.ChainId + ') ===') -ForegroundColor Cyan

    $forgeArgs = @('script', 'script/DeployDeterministic.s.sol', '--rpc-url', $alias)
    if (-not $DryRun) { $forgeArgs += '--broadcast' }
    if ($chain.ExtraArgs) { $forgeArgs += $chain.ExtraArgs }

    & forge @forgeArgs
    $ok = ($LASTEXITCODE -eq 0)

    $status = 'FAILED'
    if ($ok) {
      if ($DryRun) {
        $status = 'SIMULATED'
      } else {
        # CreateX deploys are factory CALLs (no CREATE2 tx type in the receipts), so the
        # authoritative cross-check is on-chain code at each predicted address.
        $status = 'DEPLOYED'
        foreach ($name in @('ConstantPayoutCurve', 'Train', 'TrainRouter')) {
          $code = (& cast code $expected[$name] --rpc-url $alias | Out-String).Trim()
          if ($LASTEXITCODE -ne 0 -or $code -eq '' -or $code -eq '0x') {
            $status = 'ADDRESS MISSING'
            Write-Host ("MISSING CODE on " + $alias + ": " + $name + " expected at " + $expected[$name]) -ForegroundColor Red
          }
        }
        # forge script --verify does not cover factory-created contracts reliably; verify each
        # contract explicitly at its deterministic address.
        if ($status -eq 'DEPLOYED' -and -not $NoVerify) {
          $sources = @{
            ConstantPayoutCurve = 'src/ConstantPayoutCurve.sol:ConstantPayoutCurve'
            Train               = 'src/Train.sol:Train'
            TrainRouter         = 'src/TrainRouter.sol:TrainRouter'
          }
          foreach ($name in @('ConstantPayoutCurve', 'Train', 'TrainRouter')) {
            $verifyArgs = @('verify-contract', $expected[$name], $sources[$name],
                            '--chain', $chain.ChainId, '--verifier', $chain.Verifier, '--watch')
            if ($chain.VerifierUrl) { $verifyArgs += @('--verifier-url', $chain.VerifierUrl) }
            & forge @verifyArgs
            if ($LASTEXITCODE -ne 0) {
              Write-Host ("VERIFY FAILED on " + $alias + ": " + $name + " (deploy unaffected)") -ForegroundColor Yellow
            }
          }
        }
      }
    }

    $results += [pscustomobject]@{
      Chain   = $alias
      ChainId = $chain.ChainId
      Status  = $status
    }
    Write-Host ''
  }

  Write-Host '================ SUMMARY ================' -ForegroundColor Cyan
  Write-Host ('Salt-derived addresses (identical on every chain that reports DEPLOYED/ALREADY DEPLOYED):')
  Write-Host ("  ConstantPayoutCurve: " + $expected['ConstantPayoutCurve'])
  Write-Host ("  Train              : " + $expected['Train'])
  Write-Host ("  TrainRouter        : " + $expected['TrainRouter'])
  $results | Format-Table -AutoSize

  if (-not $DryRun) {
    $deploymentsDir = Join-Path $FoundryRoot 'deployments'
    New-Item -ItemType Directory -Force -Path $deploymentsDir | Out-Null
    $commit = ''
    try { $commit = (& git rev-parse HEAD | Select-Object -First 1) } catch {}
    $record = [pscustomobject]@{
      commit    = "$commit"
      addresses = $expected
      chains    = $results
    }
    $recordPath = Join-Path $deploymentsDir 'testnets.json'
    $record | ConvertTo-Json -Depth 5 | Out-File -FilePath $recordPath -Encoding utf8
    Write-Host ('Summary written to ' + $recordPath)
  }

  $failed = @($results | Where-Object { $_.Status -eq 'FAILED' -or $_.Status -eq 'ADDRESS MISSING' })
  if ($failed.Count -gt 0) { exit 1 }
} finally {
  Pop-Location
}
