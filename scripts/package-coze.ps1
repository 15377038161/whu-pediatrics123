$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$deliverableRoot = Join-Path $projectRoot 'deliverables'
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('luojia-peds-coze-' + [guid]::NewGuid().ToString('N'))
$packagePath = Join-Path $deliverableRoot '珞珈儿科智训_Coze全栈工程.zip'

New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
New-Item -ItemType Directory -Path $deliverableRoot -Force | Out-Null

try {
  $rootFiles = @(
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'next-env.d.ts',
    'next.config.ts', 'postcss.config.mjs', 'eslint.config.mjs',
    '.env.example', 'README.md'
  )
  foreach ($file in $rootFiles) {
    $source = Join-Path $projectRoot $file
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $stagingRoot }
  }

  foreach ($folder in @('src', 'public', 'supabase')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $folder) -Destination $stagingRoot -Recurse
  }
  $implementationDocs = Join-Path $stagingRoot 'docs\实施方案'
  New-Item -ItemType Directory -Path $implementationDocs -Force | Out-Null
  foreach ($file in @(
    'ARCHITECTURE.md', 'UI_DESIGN_STANDARD.md', 'COZE_IMPORT_AND_CONFIG.md',
    'CHAOXING_AUTH_HANDOFF.md', 'CHAOXING_FORM_CONTRACT.md', 'ACCEPTANCE.md',
    'LOCAL_ACCEPTANCE_REPORT.md', '老师汇报_整体智能体思维导图.md'
  )) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "docs\实施方案\$file") -Destination $implementationDocs
  }
  Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\实施方案\assets') -Destination $implementationDocs -Recurse

  Get-ChildItem -LiteralPath $stagingRoot -Recurse -Force | Where-Object {
    (($_.Name -ne '.env.example') -and ($_.Name -match '^\.env')) -or $_.FullName -match '\\(node_modules|\.next|output|outputs|backups|qa|demo)\\'
  } | ForEach-Object { throw "禁止文件进入导入包: $($_.FullName)" }

  if (Test-Path -LiteralPath $packagePath) { Remove-Item -LiteralPath $packagePath -Force }
  Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $packagePath -CompressionLevel Optimal
  $hash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
  Write-Output "PACKAGE=$packagePath"
  Write-Output "SHA256=$hash"
} finally {
  $resolvedTemp = [System.IO.Path]::GetFullPath($stagingRoot)
  $tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($resolvedTemp.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
