param([Parameter(Mandatory = $true)][string]$ReleaseDirectory)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or !$env:RUNNER_TEMP) {
    throw '此用例会写入测试用户的安装登记，只能在一次性 Windows CI 运行器中执行。'
}

$base = Join-Path $env:RUNNER_TEMP "qingzhou-install-$([Guid]::NewGuid().ToString('N'))"
New-Item -Path $base -ItemType Directory | Out-Null
$setup = (Resolve-Path (Join-Path $ReleaseDirectory 'Qingzhou-win-x64-setup.exe')).Path
$portable = (Resolve-Path (Join-Path $ReleaseDirectory 'Qingzhou-win-x64-portable.zip')).Path
$guid = 'b217ef67-1b56-53a8-ae48-833d59642d92'
$legacyInstall = "HKCU:\Software\$guid"
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$legacyUninstall = Join-Path $uninstallRoot $guid
$shell = New-Object -ComObject WScript.Shell

function Start-Installer([string]$Installer, [string[]]$Options) {
    $process = Start-Process -FilePath $Installer -ArgumentList $Options -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "安装程序退出码 $($process.ExitCode)" }
}

function Assert-Path([string]$Path) {
    if (!(Test-Path -LiteralPath $Path)) { throw "缺少文件 $Path" }
}

function Assert-UpdateTarget([string]$Expected) {
    $registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::CurrentUser,
        [Microsoft.Win32.RegistryView]::Registry32
    )
    try {
        $key = $registry.OpenSubKey('Software\qingzhou\Qingzhou')
        try {
            if (!$key -or $key.GetValue('') -ine $Expected) { throw "应用内更新登记未指向 $Expected。" }
        } finally {
            if ($key) { $key.Dispose() }
        }
    } finally {
        $registry.Dispose()
    }
}

function Set-TestProfile([string]$Case) {
    $root = Join-Path $base $Case
    $env:QINGZHOU_HOME_DIR = Join-Path $root 'home'
    $env:QINGZHOU_DATA_DIR = Join-Path $root 'data'
    $env:QINGZHOU_DESKTOP_LOG_DIR = Join-Path $root 'logs'
    $env:QINGZHOU_E2E = '1'
    New-Item -Path $env:QINGZHOU_HOME_DIR, $env:QINGZHOU_DATA_DIR -ItemType Directory -Force | Out-Null
    $settings = Join-Path $env:QINGZHOU_DATA_DIR 'settings.json'
    if (!(Test-Path -LiteralPath $settings)) {
        '{"autoCheckForUpdates":false}' | Set-Content -LiteralPath $settings -Encoding ascii
    }
    return $settings
}

function Stop-TestApp([System.Diagnostics.Process]$App) {
    if (!$App.HasExited) {
        if (!$App.CloseMainWindow() -or !$App.WaitForExit(15000)) { Stop-Process -Id $App.Id -ErrorAction SilentlyContinue }
        $App.WaitForExit(15000) | Out-Null
    }
}

function Assert-StockApp([string]$Binary, [string]$Case) {
    Assert-Path $Binary
    $settings = Set-TestProfile $Case
    $original = (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash
    $app = Start-Process -FilePath $Binary -PassThru
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(60)
        $preferences = Join-Path $env:QINGZHOU_DATA_DIR 'desktop-ui.json'
        while (!(Test-Path -LiteralPath $preferences)) {
            if ($app.HasExited -or [DateTime]::UtcNow -ge $deadline) {
                $log = Join-Path $env:QINGZHOU_DESKTOP_LOG_DIR 'service.log'
                if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log | Write-Output }
                throw "$Case 未完成 WebView2 和本机服务握手。"
            }
            Start-Sleep -Milliseconds 250
        }
        $snapshot = Get-Content -LiteralPath $preferences -Raw | ConvertFrom-Json
        if (!$snapshot.PSObject.Properties['qingzhou.ui.leftPinned']) { throw "$Case 未保存窗口偏好。" }
        if ((Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash -ne $original) { throw "$Case 改写了原始资料。" }
    } finally {
        Stop-TestApp $app
    }
    Write-Output "通过 $Case 的成品启动与资料读取"
}

$portableRoot = Join-Path $base 'Portable App'
Expand-Archive -LiteralPath $portable -DestinationPath $portableRoot
Assert-StockApp (Join-Path $portableRoot 'Qingzhou.exe') 'portable'

$cleanRoot = Join-Path $base 'Clean Install'
Start-Installer $setup @('/S', "/D=$cleanRoot")
Assert-Path (Join-Path $cleanRoot 'uninstall.exe')
Assert-UpdateTarget $cleanRoot
Assert-StockApp (Join-Path $cleanRoot 'Qingzhou.exe') 'clean'
Assert-StockApp (Join-Path $portableRoot 'Qingzhou.exe') 'portable-with-installation'
Assert-UpdateTarget $cleanRoot
$uninstall = Start-Process -FilePath (Join-Path $cleanRoot 'uninstall.exe') -ArgumentList '/S' -PassThru -Wait
if ($uninstall.ExitCode -ne 0 -or (Test-Path -LiteralPath (Join-Path $cleanRoot 'Qingzhou.exe'))) {
    throw '全新安装的候选未成功卸载。'
}

# Use the immutable 0.1.26 release asset and pin its published checksum.
$legacySetup = Join-Path $base 'Qingzhou-0.1.26-setup.exe'
Invoke-WebRequest -Uri 'https://github.com/Yunz93/Qingzhou/releases/download/v0.1.26/Qingzhou-win-x64-setup.exe' -OutFile $legacySetup -TimeoutSec 300
if ((Get-FileHash -LiteralPath $legacySetup -Algorithm SHA256).Hash -ine 'e7f887418027b6694e859154114daaf43f3a0a683ae507d9e1f435bbd41fef40') {
    throw '历史安装包校验失败。'
}
$legacyRoot = Join-Path $base 'Legacy Custom Install'
$legacyExecutable = Join-Path $legacyRoot 'Qingzhou.exe'
$legacyResources = Join-Path $legacyRoot 'resources'
Start-Installer $legacySetup @('/S', "/D=$legacyRoot")
Assert-Path $legacyExecutable
Assert-Path (Join-Path $legacyResources 'app.asar')
if ((Get-ItemPropertyValue -LiteralPath $legacyInstall -Name InstallLocation) -ine $legacyRoot) {
    throw '旧版本的安装登记未指向自定义目录。'
}
if ((Get-ItemPropertyValue -LiteralPath $legacyUninstall -Name DisplayVersion) -ne '0.1.26') {
    throw '旧版本的卸载登记不正确。'
}
$retained = Join-Path $legacyRoot 'user-note.txt'
'retain' | Set-Content -LiteralPath $retained -Encoding ascii
$desktopLink = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Qingzhou.lnk'
$startLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'Qingzhou.lnk'
foreach ($link in @($desktopLink, $startLink)) {
    Assert-Path $link
    if ($shell.CreateShortcut($link).TargetPath -ine $legacyExecutable) { throw "旧版快捷方式指向了其他文件 $link" }
}

$legacySettings = Set-TestProfile 'legacy-in-place'
$legacyProfile = Join-Path $base 'Electron Profile'
$env:PORT = '4374'
$preferencesUri = 'http://127.0.0.1:4374/api/update/preferences'
$legacy = Start-Process -FilePath $legacyExecutable -ArgumentList ('"--user-data-dir=' + $legacyProfile + '"') -PassThru
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    do {
        if ($legacy.HasExited -or [DateTime]::UtcNow -ge $deadline) { throw '旧版桌面服务未就绪。' }
        $preferences = $null
        try { $preferences = Invoke-RestMethod -Uri $preferencesUri -TimeoutSec 3 } catch { Start-Sleep -Milliseconds 250 }
    } until ($preferences.current -eq '0.1.26')
    $saved = Invoke-RestMethod -Uri $preferencesUri -TimeoutSec 5 -Method Post -ContentType 'application/json' -Body '{"skippedUpdateVersion":"0.1.27"}'
    if ($saved.skippedUpdateVersion -ne '0.1.27') { throw '旧版未写入升级测试资料。' }
} finally {
    Stop-TestApp $legacy
    Remove-Item Env:PORT
}
$legacyHash = (Get-FileHash -LiteralPath $legacySettings -Algorithm SHA256).Hash

# The legacy in-app updater passes only /S and opens its original executable path.
Start-Installer $setup @('/S')
if (Test-Path -LiteralPath (Join-Path $legacyResources 'app.asar')) { throw '旧运行时仍留在原目录。' }
if (Test-Path -LiteralPath $legacyUninstall) { throw '旧卸载登记仍在。' }
if ((Get-FileHash -LiteralPath $legacySettings -Algorithm SHA256).Hash -ne $legacyHash) { throw '安装器改写了旧资料。' }
Assert-Path $retained
Assert-Path (Join-Path $legacyRoot 'uninstall.exe')
Assert-UpdateTarget $legacyRoot
$registered = Get-ChildItem -LiteralPath $uninstallRoot | Get-ItemProperty | Where-Object {
    $_.DisplayName -eq 'Qingzhou' -and $_.InstallLocation -and $_.InstallLocation.Trim('"') -ieq $legacyRoot
}
if (!$registered) { throw '新版卸载登记未指向原安装目录。' }
foreach ($link in @($desktopLink, $startLink)) {
    if ($shell.CreateShortcut($link).TargetPath -ine $legacyExecutable) { throw "升级后快捷方式指向了其他文件 $link" }
}
Assert-StockApp $legacyExecutable 'legacy-in-place'
Start-Installer (Join-Path $legacyRoot 'uninstall.exe') @('/S')
if (Test-Path -LiteralPath $legacyExecutable) { throw '升级后的候选未成功卸载。' }
