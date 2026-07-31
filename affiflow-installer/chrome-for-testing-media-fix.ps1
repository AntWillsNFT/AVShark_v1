& {
    Set-StrictMode -Version Latest
    $ErrorActionPreference = "Stop"

    $project = "D:\AntWills\Desktop\AffiFlow-AI"
    $extension = Join-Path $project "extensions\affiflow-capture"
    $manifestPath = Join-Path $extension "manifest.json"
    $runnerPagePath = Join-Path $extension "mediaRunner.html"
    $runnerScriptPath = Join-Path $extension "mediaRunner.js"
    $profile = Join-Path $project ".affiflow-chrome-profile"
    $database = Join-Path $env:APPDATA "affiflow-ai\affiflow.sqlite3"
    $launcherPath = Join-Path $project "Launch-AffiFlow-Chrome.cmd"

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backup = Join-Path $project ".backups\chrome-for-testing-media-$timestamp"
    $tools = Join-Path $project ".affiflow-tools\chrome-for-testing-media"
    $logs = Join-Path $project "diagnostics\chrome-for-testing-media-$timestamp"
    $cftRoot = Join-Path $tools "browser"
    $forceRunnerPath = Join-Path $tools "force-runner.cjs"
    $requeuePath = Join-Path $tools "requeue-media.cjs"
    $statusPath = Join-Path $tools "check-media.cjs"
    $stdoutPath = Join-Path $logs "stdout.log"
    $stderrPath = Join-Path $logs "stderr.log"
    $debugPort = 47839

    $cftApi = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"
    $forceRunnerUrl = "https://raw.githubusercontent.com/AntWillsNFT/AVShark_v1/main/affiflow-installer/force-runner.cjs"

    foreach ($required in @(
        (Join-Path $project "package.json"),
        $extension,
        $manifestPath,
        $runnerPagePath,
        $runnerScriptPath,
        $database
    )) {
        if (-not (Test-Path $required)) {
            throw "Fail penting tidak dijumpai: $required"
        }
    }

    function Stop-AffiFlowProcesses {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.ProcessId -ne $PID -and
                $_.CommandLine -and
                $_.Name -in @("electron.exe", "node.exe", "cmd.exe") -and
                ($_.CommandLine -like "*AffiFlow-AI*" -or $_.CommandLine -like "*affiflow-ai*")
            } |
            ForEach-Object {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
    }

    function Stop-AffiFlowBrowsers {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq "chrome.exe" -and
                $_.CommandLine -and
                ($_.CommandLine -like "*affiflow-chrome-profile*" -or $_.CommandLine -like "*$profile*")
            } |
            ForEach-Object {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
    }

    function Test-ServicePort {
        param([int]$Port)

        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -Method Get -TimeoutSec 1
            return $health.ok -eq $true
        }
        catch {
            return $false
        }
    }

    Write-Host ""
    Write-Host "=== AFFIFLOW CHROME FOR TESTING MEDIA FIX ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Root cause: official Google Chrome no longer loads unpacked extensions from --load-extension." -ForegroundColor Yellow
    Write-Host "AffiFlow will now use Chrome for Testing for its dedicated browser profile." -ForegroundColor Yellow
    Write-Host ""

    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    New-Item -ItemType Directory -Path $tools -Force | Out-Null
    New-Item -ItemType Directory -Path $logs -Force | Out-Null

    Write-Host "Stopping AffiFlow processes..." -ForegroundColor Cyan
    Stop-AffiFlowBrowsers
    Stop-AffiFlowProcesses
    Start-Sleep -Seconds 3

    Copy-Item $manifestPath (Join-Path $backup "manifest.json") -Force
    Copy-Item $database (Join-Path $backup "affiflow.sqlite3") -Force

    if (Test-Path $launcherPath) {
        Copy-Item $launcherPath (Join-Path $backup "Launch-AffiFlow-Chrome.cmd") -Force
    }

    foreach ($suffix in @("-wal", "-shm")) {
        $extra = "$database$suffix"
        if (Test-Path $extra) {
            Copy-Item $extra (Join-Path $backup "affiflow.sqlite3$suffix") -Force
        }
    }

    Write-Host "Backup completed." -ForegroundColor Green
    Write-Host ""
    Write-Host "Finding latest official Chrome for Testing..." -ForegroundColor Cyan

    $availability = Invoke-RestMethod -Uri $cftApi -Method Get -TimeoutSec 30
    $stable = $availability.channels.Stable
    $download = $stable.downloads.chrome | Where-Object { $_.platform -eq "win64" } | Select-Object -First 1

    if ($null -eq $download -or [string]::IsNullOrWhiteSpace([string]$download.url)) {
        throw "Chrome for Testing win64 download tidak ditemui dalam official API."
    }

    $cftVersion = [string]$stable.version
    $versionDirectory = Join-Path $cftRoot $cftVersion
    $cftChrome = Join-Path $versionDirectory "chrome-win64\chrome.exe"
    $versionMarker = Join-Path $versionDirectory ".installed"

    if (-not (Test-Path $cftChrome)) {
        $zipPath = Join-Path $tools "chrome-for-testing-$cftVersion.zip"
        $extractTemporary = Join-Path $tools "extract-$cftVersion"

        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item $extractTemporary -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $versionDirectory -Recurse -Force -ErrorAction SilentlyContinue

        Write-Host "Downloading Chrome for Testing $cftVersion..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri ([string]$download.url) -OutFile $zipPath -UseBasicParsing

        Write-Host "Extracting browser..." -ForegroundColor Cyan
        Expand-Archive -Path $zipPath -DestinationPath $extractTemporary -Force
        New-Item -ItemType Directory -Path $versionDirectory -Force | Out-Null
        Copy-Item (Join-Path $extractTemporary "*") $versionDirectory -Recurse -Force
        Remove-Item $extractTemporary -Recurse -Force
        Remove-Item $zipPath -Force
        Set-Content -Path $versionMarker -Value $cftVersion -Encoding ASCII
    }

    if (-not (Test-Path $cftChrome)) {
        throw "Chrome for Testing executable tidak dijumpai selepas extraction."
    }

    $browserVersion = (& $cftChrome --version) -join " "
    Write-Host "Browser ready: $browserVersion" -ForegroundColor Green

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $pathBytes = [System.Text.Encoding]::Unicode.GetBytes($extension)
        $pathHash = $sha256.ComputeHash($pathBytes)
    }
    finally {
        $sha256.Dispose()
    }

    $alphabet = "abcdefghijklmnop"
    $idBuilder = [System.Text.StringBuilder]::new()

    for ($index = 0; $index -lt 16; $index++) {
        $high = ($pathHash[$index] -shr 4) -band 15
        $low = $pathHash[$index] -band 15
        [void]$idBuilder.Append($alphabet[$high])
        [void]$idBuilder.Append($alphabet[$low])
    }

    $extensionId = $idBuilder.ToString()
    $runnerUrl = "chrome-extension://$extensionId/mediaRunner.html"
    Set-Content -Path (Join-Path $project ".affiflow-extension-id") -Value $extensionId -Encoding ASCII

    Write-Host "AffiFlow extension ID: $extensionId" -ForegroundColor Green

    $requeueCode = @'
const { DatabaseSync } = require("node:sqlite");
const database = new DatabaseSync(process.argv[2], { enableForeignKeyConstraints: true });
const now = new Date().toISOString();
database.exec("BEGIN IMMEDIATE TRANSACTION;");
try {
  database.prepare(`
    DELETE FROM candidate_media_assets
    WHERE candidate_id IN (
      SELECT id FROM capture_candidates
      WHERE status = 'Imported' AND affiliate_link != ''
    )
  `).run();

  const reset = database.prepare(`
    UPDATE candidate_media_state
    SET batch_id = 'legacy-backfill', status = 'Queued',
        expected_image_count = 0, downloaded_image_count = 0,
        expected_video_count = 0, downloaded_video_count = 0,
        video_status = 'Not Checked', attempts = 0, last_error = '',
        started_at = '', completed_at = '', updated_at = ?
    WHERE candidate_id IN (
      SELECT id FROM capture_candidates
      WHERE status = 'Imported' AND affiliate_link != ''
    )
  `).run(now);

  database.prepare(`
    UPDATE product_media_state
    SET discovery_status = 'Not Checked', video_status = 'Not Checked',
        overall_status = 'Not Checked', last_error = '', last_checked_at = '',
        ready_at = '', updated_at = ?
  `).run(now);

  database.prepare(`
    UPDATE product_media_jobs
    SET status = 'Waiting for Source', progress = CASE WHEN downloaded_count > 0 THEN 25 ELSE 0 END,
        attempts = 0, failed_count = 0,
        last_error = 'Waiting for Chrome for Testing media runner.',
        started_at = '', completed_at = '', updated_at = ?
  `).run(now);

  database.exec("COMMIT;");
  console.log(JSON.stringify({ ok: true, requeued: Number(reset.changes) || 0 }, null, 2));
} catch (error) {
  database.exec("ROLLBACK;");
  throw error;
} finally {
  database.close();
}
'@

    $statusCode = @'
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const database = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = database.prepare(`
  SELECT products.id AS productId, products.name,
         capture_candidates.id AS candidateId,
         COALESCE(candidate_media_state.status, '') AS candidateStatus,
         COALESCE(candidate_media_state.attempts, 0) AS attempts,
         COALESCE(candidate_media_state.expected_image_count, 0) AS expectedImages,
         COALESCE(candidate_media_state.downloaded_image_count, 0) AS downloadedImages,
         COALESCE(candidate_media_state.expected_video_count, 0) AS expectedVideos,
         COALESCE(candidate_media_state.downloaded_video_count, 0) AS downloadedVideos,
         COALESCE(candidate_media_state.last_error, '') AS candidateError,
         COALESCE(product_media_state.overall_status, '') AS overallStatus,
         COALESCE(product_media_jobs.status, '') AS jobStatus,
         COALESCE(product_media_jobs.progress, 0) AS jobProgress,
         COALESCE(product_media_jobs.last_error, '') AS jobError
  FROM products
  INNER JOIN capture_candidates ON capture_candidates.id = (
    SELECT candidate.id FROM capture_candidates AS candidate
    WHERE candidate.status = 'Imported' AND (
      candidate.source_url = products.source_url OR
      (products.affiliate_link != '' AND candidate.affiliate_link = products.affiliate_link) OR
      LOWER(TRIM(candidate.name)) = LOWER(TRIM(products.name))
    )
    ORDER BY candidate.updated_at DESC LIMIT 1
  )
  LEFT JOIN candidate_media_state ON candidate_media_state.candidate_id = capture_candidates.id
  LEFT JOIN product_media_state ON product_media_state.product_id = products.id
  LEFT JOIN product_media_jobs ON product_media_jobs.product_id = products.id
  ORDER BY products.updated_at DESC
`).all();
const media = database.prepare(`
  SELECT media_type AS mediaType, download_status AS downloadStatus, local_path AS localPath
  FROM product_media WHERE product_id = ?
`);
const results = rows.map((row) => {
  const assets = media.all(row.productId).filter((asset) =>
    asset.downloadStatus === 'Downloaded' &&
    typeof asset.localPath === 'string' && asset.localPath.trim() && fs.existsSync(asset.localPath)
  );
  const actualImages = assets.filter((asset) => asset.mediaType === 'Image').length;
  const actualVideos = assets.filter((asset) => asset.mediaType === 'Video').length;
  return {
    ...row,
    actualImages,
    actualVideos,
    enhanced: actualImages > 1 || actualVideos > 0,
    error: row.candidateError || row.jobError || ''
  };
});
database.close();
const summary = {
  total: results.length,
  queued: results.filter((row) => row.candidateStatus === 'Queued').length,
  scanning: results.filter((row) => row.candidateStatus === 'Scanning').length,
  downloading: results.filter((row) => row.candidateStatus === 'Downloading').length,
  ready: results.filter((row) => row.candidateStatus === 'Ready' || row.overallStatus === 'Ready').length,
  failed: results.filter((row) => row.candidateStatus === 'Failed' || row.overallStatus === 'Failed').length,
  enhanced: results.filter((row) => row.enhanced).length,
  attempts: results.filter((row) => Number(row.attempts) > 0).length
};
process.stdout.write(JSON.stringify({ summary, rows: results }, null, 2));
'@

    [System.IO.File]::WriteAllText($requeuePath, $requeueCode, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($statusPath, $statusCode, [System.Text.UTF8Encoding]::new($false))

    Invoke-WebRequest -Uri $forceRunnerUrl -OutFile $forceRunnerPath -UseBasicParsing

    foreach ($script in @($requeuePath, $statusPath, $forceRunnerPath, $runnerScriptPath)) {
        & node --check $script
        if ($LASTEXITCODE -ne 0) {
            throw "JavaScript syntax error: $script"
        }
    }

    Write-Host "Requeueing imported product media..." -ForegroundColor Cyan
    & node --no-warnings $requeuePath $database
    if ($LASTEXITCODE -ne 0) {
        throw "Media requeue gagal."
    }

    Write-Host "Starting AffiFlow Desktop..." -ForegroundColor Cyan
    Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/s", "/c", "npm run dev") -WorkingDirectory $project -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath | Out-Null

    $ports = @(47831, 47832, 47833)
    $ready = @{}
    foreach ($port in $ports) { $ready[$port] = $false }

    for ($round = 1; $round -le 100; $round++) {
        Start-Sleep -Milliseconds 500
        foreach ($port in $ports) {
            if (-not $ready[$port]) {
                $ready[$port] = Test-ServicePort -Port $port
            }
        }
        if ($ready[47831] -and $ready[47832] -and $ready[47833]) { break }
    }

    if (-not $ready[47831] -or -not $ready[47832] -or -not $ready[47833]) {
        Get-Content $stdoutPath -ErrorAction SilentlyContinue | Select-Object -Last 100
        Get-Content $stderrPath -ErrorAction SilentlyContinue | Select-Object -Last 100
        throw "AffiFlow services gagal hidup."
    }

    Write-Host "All AffiFlow services connected." -ForegroundColor Green
    Write-Host "Starting Chrome for Testing with AffiFlow extension..." -ForegroundColor Cyan

    Start-Process -FilePath $cftChrome -ArgumentList @(
        "--user-data-dir=`"$profile`"",
        "--disable-extensions-except=`"$extension`"",
        "--load-extension=`"$extension`"",
        "--remote-debugging-port=$debugPort",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        "https://affiliate.shopee.com.my/offer/product_offer"
    )

    Start-Sleep -Seconds 10

    Start-Process -FilePath $cftChrome -ArgumentList @(
        "--user-data-dir=`"$profile`"",
        $runnerUrl
    )

    Start-Sleep -Seconds 6

    Write-Host "Verifying live Media Runner..." -ForegroundColor Cyan
    & node --no-warnings $forceRunnerPath $debugPort $extensionId
    if ($LASTEXITCODE -ne 0) {
        throw "Media Runner page tidak berjaya dimuatkan dalam Chrome for Testing."
    }

    $launcher = @"
@echo off
setlocal
set "CHROME=$cftChrome"
set "PROFILE=$profile"
set "EXTENSION=$extension"
set "EXTENSION_ID=$extensionId"
start "" "%CHROME%" --user-data-dir="%PROFILE%" --disable-extensions-except="%EXTENSION%" --load-extension="%EXTENSION%" --no-first-run --no-default-browser-check --new-window "https://affiliate.shopee.com.my/offer/product_offer"
timeout /t 7 /nobreak >nul
start "" "%CHROME%" --user-data-dir="%PROFILE%" "chrome-extension://%EXTENSION_ID%/mediaRunner.html"
endlocal
"@

    [System.IO.File]::WriteAllText($launcherPath, $launcher, [System.Text.Encoding]::ASCII)

    Write-Host ""
    Write-Host "Media Runner is active. Terminal will verify downloads for up to 6 minutes." -ForegroundColor Yellow
    Write-Host "Biarkan Chrome for Testing terbuka. Lengkapkan Shopee verification jika muncul." -ForegroundColor Yellow
    Write-Host ""

    $lastReport = $null

    for ($round = 1; $round -le 72; $round++) {
        Start-Sleep -Seconds 5

        try {
            $json = & node --no-warnings $statusPath $database 2>$null
            if ($LASTEXITCODE -ne 0) { continue }
            $lastReport = ($json -join [Environment]::NewLine) | ConvertFrom-Json

            Write-Host (
                "[{0:000}s] Attempts {1}/{2} | Queued {3} | Scanning {4} | Downloading {5} | Ready {6} | Enhanced {7} | Failed {8}" -f
                ($round * 5),
                $lastReport.summary.attempts,
                $lastReport.summary.total,
                $lastReport.summary.queued,
                $lastReport.summary.scanning,
                $lastReport.summary.downloading,
                $lastReport.summary.ready,
                $lastReport.summary.enhanced,
                $lastReport.summary.failed
            ) -ForegroundColor Cyan

            $active = [int]$lastReport.summary.queued + [int]$lastReport.summary.scanning + [int]$lastReport.summary.downloading

            if ([int]$lastReport.summary.total -gt 0 -and $active -eq 0) {
                break
            }
        }
        catch {
        }
    }

    Write-Host ""
    Write-Host "=== FINAL PRODUCT MEDIA RESULT ===" -ForegroundColor Yellow

    if ($null -eq $lastReport) {
        Write-Host ""
        Write-Host "FINAL VERDICT: FAIL_STATUS" -ForegroundColor Red
        Write-Host "REASON: Database media status tidak dapat dibaca." -ForegroundColor Red
    }
    else {
        foreach ($row in $lastReport.rows) {
            Write-Host ""
            Write-Host "Product : $($row.name)"
            Write-Host "Status  : $($row.candidateStatus)"
            Write-Host "Attempts: $($row.attempts)"
            Write-Host "Images  : $($row.actualImages)/$($row.expectedImages)"
            Write-Host "Videos  : $($row.actualVideos)/$($row.expectedVideos)"
            Write-Host "Error   : $($row.error)"
        }

        $total = [int]$lastReport.summary.total
        $attempts = [int]$lastReport.summary.attempts
        $readyCount = [int]$lastReport.summary.ready
        $enhanced = [int]$lastReport.summary.enhanced
        $failed = [int]$lastReport.summary.failed
        $active = [int]$lastReport.summary.queued + [int]$lastReport.summary.scanning + [int]$lastReport.summary.downloading

        Write-Host ""

        if ($total -gt 0 -and $enhanced -eq $total -and $failed -eq 0) {
            Write-Host "FINAL VERDICT: PASS" -ForegroundColor Green
            Write-Host "REASON: Semua produk mendapat media tambahan dalam AffiFlow Vault." -ForegroundColor Green
        }
        elseif ($attempts -eq 0) {
            Write-Host "FINAL VERDICT: FAIL_RUNNER_NOT_STARTED" -ForegroundColor Red
            Write-Host "REASON: Extension masih tidak mengambil job walaupun Chrome for Testing digunakan." -ForegroundColor Red
        }
        elseif ($failed -gt 0) {
            Write-Host "FINAL VERDICT: FAIL_DISCOVERY" -ForegroundColor Red
            Write-Host "REASON: Runner hidup tetapi media discovery gagal. Error produk dipaparkan di atas." -ForegroundColor Red
        }
        elseif ($active -gt 0) {
            Write-Host "FINAL VERDICT: INCOMPLETE" -ForegroundColor Yellow
            Write-Host "REASON: Media masih diproses selepas tempoh pemeriksaan." -ForegroundColor Yellow
        }
        elseif ($readyCount -gt 0 -and $enhanced -lt $total) {
            Write-Host "FINAL VERDICT: PARTIAL" -ForegroundColor Yellow
            Write-Host "REASON: Sebahagian produk selesai tetapi belum semuanya mendapat galeri penuh." -ForegroundColor Yellow
        }
        else {
            Write-Host "FINAL VERDICT: THUMBNAIL_ONLY" -ForegroundColor Red
            Write-Host "REASON: Runner bergerak tetapi produk masih mempunyai thumbnail asal sahaja." -ForegroundColor Red
        }
    }

    Write-Host ""
    Write-Host "Browser       : $browserVersion" -ForegroundColor Cyan
    Write-Host "Extension ID  : $extensionId" -ForegroundColor Cyan
    Write-Host "Launcher fixed: $launcherPath" -ForegroundColor Cyan
    Write-Host "Diagnostics   : $logs" -ForegroundColor Cyan
    Write-Host ""
}
