# Скриншоты экранов для сверки с макетами (docs/design/reference/mockups).
# Нужен запущенный `pnpm dev` (http://localhost:1420) и Google Chrome.
# Запуск: powershell -File scripts/screenshots.ps1 [-Out <папка>]
#
# Приложение открывается внутри ui/screen-frame.html — в iframe точного размера:
# headless Chrome раскладывает страницу в окне меньше заданного, и usePageSize считал бы не те размеры.
param(
  [string]$Out = (Join-Path $env:TEMP 'poe-manager-screens'),
  [string]$Chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe',
  [string]$BaseUrl = 'http://localhost:1420',
  # Снять только кадры, в имени которых есть эта строка.
  [string]$Only = ''
)

Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $Out | Out-Null
# splash=0 — без экрана запуска; dev=1 — режим разработчика (Режим разработки, Витрина); budget — сколько миллисекунд «прожить» до снимка.
$shots = @(
  @{ name = 'splash-1440'; w = 1440; h = 900; q = 'module=price-check'; budget = 1100 },
  @{ name = 'price-1440'; w = 1440; h = 900; q = 'module=price-check&splash=0' },
  @{ name = 'price-1280'; w = 1280; h = 720; q = 'module=price-check&splash=0' },
  @{ name = 'problems-1440'; w = 1440; h = 900; q = 'module=price-check&demo=problems&splash=0' },
  @{ name = 'palette-1440'; w = 1440; h = 900; q = 'module=price-check&palette=1&splash=0' },
  @{ name = 'collapsed-1280'; w = 1280; h = 720; q = 'module=settings&collapsed=1&splash=0' },
  @{ name = 'settings-1280'; w = 1280; h = 720; q = 'module=settings&splash=0' },
  @{ name = 'showcase-1440'; w = 1440; h = 900; q = 'dev=1&module=showcase&splash=0' },
  @{ name = 'example-price-1440'; w = 1440; h = 900; q = 'dev=1&module=showcase&screen=price&splash=0' },
  @{ name = 'example-craft-1440'; w = 1440; h = 900; q = 'dev=1&module=showcase&screen=craft&splash=0' },
  @{ name = 'example-catalog-1440'; w = 1440; h = 900; q = 'dev=1&module=showcase&screen=catalog&splash=0' },
  @{ name = 'developer-1440'; w = 1440; h = 900; q = 'dev=1&module=developer&splash=0' },
  @{ name = 'developer-1280'; w = 1280; h = 720; q = 'dev=1&module=developer&splash=0' },
  @{ name = 'developer-discord-1440'; w = 1440; h = 900; q = 'dev=1&module=developer&section=discord&splash=0' },
  @{ name = 'developer-discord-1280'; w = 1280; h = 720; q = 'dev=1&module=developer&section=discord&splash=0' }
) | Where-Object { -not $Only -or $_.name -like "*$Only*" }
foreach ($s in $shots) {
  $profile = Join-Path $env:TEMP ("pm-chrome-" + [guid]::NewGuid())
  $raw = Join-Path $env:TEMP "pm-raw-$($s.name).png"
  $file = Join-Path $Out "$($s.name).png"
  $q = [uri]::EscapeDataString($s.q)
  $url = "$BaseUrl/screen-frame.html?w=$($s.w)&h=$($s.h)&q=$q"
  Start-Process -Wait -NoNewWindow -FilePath $Chrome -RedirectStandardError (Join-Path $env:TEMP 'pm-chrome-err.txt') -ArgumentList @(
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    "--user-data-dir=$profile", "--window-size=$($s.w + 100),$($s.h + 200)", "--virtual-time-budget=$(if ($s.budget) { $s.budget } else { 5000 })",
    "--screenshot=$raw", $url)
  Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
  if (Test-Path $raw) {
    # Обрезаем до размера iframe.
    $img = [System.Drawing.Image]::FromFile($raw)
    $crop = New-Object System.Drawing.Bitmap $s.w, $s.h
    $g = [System.Drawing.Graphics]::FromImage($crop)
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $s.w, $s.h), (New-Object System.Drawing.Rectangle 0, 0, $s.w, $s.h), [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose(); $img.Dispose()
    $crop.Save($file, [System.Drawing.Imaging.ImageFormat]::Png); $crop.Dispose()
    Remove-Item $raw
    "{0,-22} ok" -f $s.name
  } else {
    "{0,-22} FAILED" -f $s.name
  }
}
"Saved to $Out"
