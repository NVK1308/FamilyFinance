<#
  FamilyFinance - deploy Telegram bot (Phase 5a), lam theo source/docs/DEPLOY.md buoc 3 -> 7.
  Chay (tu bat ky thu muc nao):
    powershell -ExecutionPolicy Bypass -File F:\FamilyFinance\source\backend\scripts\deploy.ps1
  Cap nhat code (test + deploy, khong hoi):  ...\deploy.ps1 -From 3 -To 4 -Yes
  Chay tu buoc N (vd da deploy, chi dang ky lai webhook):
    powershell -ExecutionPolicy Bypass -File ...\deploy.ps1 -From 6
  Buoc: 1 cong cu + dang nhap Cloudflare - 2 wrangler.toml - 3 test - 4 deploy - 5 secret token + Neon
        6 secret webhook + setWebhook - 7 dang ky Telegram ID that - 8 viec con lai tren Telegram
  Secret chi nhap qua ban phim (an), giu trong bo nho phien, khong ghi file, khong in ra man hinh.
#>
param(
  [ValidateRange(1, 8)][int]$From = 1,
  [int]$To = 8,
  # Tự trả lời "có" cho mọi câu xác nhận (dùng cho cập nhật code: -From 3 -To 4 -Yes)
  [switch]$Yes
)

$ErrorActionPreference = 'Continue'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$Backend = Split-Path -Parent $PSScriptRoot
Set-Location $Backend

$script:BotToken = $null
$script:NeonUrl = $null
$script:WorkerUrl = $null

# ---------- Tien ich ----------

function Write-Step([int]$n, [string]$title) {
  Write-Host ''
  Write-Host "===== Buoc $n - $title =====" -ForegroundColor Cyan
}

function Fail([string]$msg) {
  Write-Host "LOI: $msg" -ForegroundColor Red
  exit 1
}

function Confirm-Go([string]$msg) {
  if ($Yes) { Write-Host "$msg -> co (-Yes)"; return $true }
  $a = Read-Host "$msg [C/k] (Enter = co)"
  return ($a -eq '' -or $a -match '^[cCyY]')
}

function Read-Secret([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# Chay lenh ngoai (npm.cmd / npx.cmd / node), tra output dang chuoi, in ra man hinh
function Invoke-Tool([string]$exe, [string[]]$argList, [switch]$Quiet) {
  # Dòng stderr rỗng của lệnh ngoài hiện thành "System.Management.Automation.RemoteException" → bỏ
  $lines = & $exe @argList 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -ne 'System.Management.Automation.RemoteException' }
  if (-not $Quiet) { $lines | ForEach-Object { Write-Host $_ } }
  return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($lines -join "`n") }
}

function Hide([string]$text) {
  if (-not $text) { return '' }
  foreach ($s in @($script:BotToken, $script:NeonUrl)) {
    if ($s) { $text = $text.Replace($s, '***') }
  }
  return $text
}

function Get-BotToken {
  if (-not $script:BotToken) {
    $t = Read-Secret 'Dan TELEGRAM BOT TOKEN (tu BotFather, se khong hien)'
    if ($t -notmatch '^\d+:[A-Za-z0-9_-]{30,}$') { Fail 'Token khong dung dang <so>:<chuoi>' }
    $script:BotToken = $t
  }
  return $script:BotToken
}

function Get-NeonUrl {
  if (-not $script:NeonUrl) {
    $u = Read-Secret 'Dan NEON connection string (postgresql://..., se khong hien)'
    # Chấp nhận cả dạng copy từ Neon: DATABASE_URL="postgresql://..." hoặc psql 'postgresql://...'
    $u = $u -replace '^\s*(psql\s+|[A-Za-z_][A-Za-z0-9_]*\s*=\s*)', ''
    $u = $u.Trim().Trim('"', "'")
    if ($u -notmatch '^postgres(ql)?://[^\s]+$') { Fail 'Chuoi ket noi phai bat dau bang postgresql:// (khong dan ten bien, khong xuong dong)' }
    $script:NeonUrl = $u
  }
  return $script:NeonUrl
}

$UrlFile = Join-Path $Backend '.worker-url'

function Test-WorkerUrl([string]$u) {
  try {
    $h = Invoke-RestMethod "$u/health" -TimeoutSec 15
    if ($h.status -eq 'ok') { Write-Host "OK: $u/health -> $($h.service) $($h.version)" -ForegroundColor Green; return $true }
  } catch { }
  return $false
}

function Get-WorkerUrl {
  # Đã lưu từ lần trước (URL không đổi giữa các lần deploy) → dùng luôn nếu /health OK
  if (-not $script:WorkerUrl -and (Test-Path $UrlFile)) {
    $saved = ([IO.File]::ReadAllText($UrlFile)).Trim()
    if ($saved -and (Test-WorkerUrl $saved)) { $script:WorkerUrl = $saved }
  }
  while (-not $script:WorkerUrl) {
    Write-Host 'Tim URL: dong "https://family-finance-worker....workers.dev" trong ket qua deploy,' -ForegroundColor Yellow
    Write-Host '  hoac dash.cloudflare.com -> Workers & Pages -> family-finance-worker -> Settings -> Domains & Routes.' -ForegroundColor Yellow
    $u = (Read-Host 'Dan URL Worker (hoac chi ten subdomain)').Trim().TrimEnd('/')
    if (-not $u) { continue }
    if ($u -notmatch '^https?://') { $u = "https://$u" }
    $u = $u -replace '^http://', 'https://'
    # Chỉ có <subdomain>.workers.dev hoặc <subdomain> → ghép tên Worker
    if ($u -match '^https://([A-Za-z0-9-]+)\.workers\.dev$') { $u = "https://family-finance-worker.$($Matches[1]).workers.dev" }
    elseif ($u -match '^https://([A-Za-z0-9-]+)$') { $u = "https://family-finance-worker.$($Matches[1]).workers.dev" }
    if ($u -notmatch '^https://[A-Za-z0-9.-]+$') { Write-Host 'URL chua dung, nhap lai.' -ForegroundColor Red; continue }
    if (Test-WorkerUrl $u) {
      $script:WorkerUrl = $u
      [IO.File]::WriteAllText($UrlFile, $u, (New-Object System.Text.UTF8Encoding $false))
    } else {
      Write-Host "Khong goi duoc $u/health - kiem tra lai URL." -ForegroundColor Red
    }
  }
  return $script:WorkerUrl
}

# Day secret qua stdin (JSON) - khong tao file tam
$Wrangler = Join-Path $Backend 'node_modules\wrangler\bin\wrangler.js'

# Gọi wrangler qua node trực tiếp (npx.cmd không trả đúng mã lỗi)
function Invoke-Wrangler([string[]]$argList) {
  $lines = & node $Wrangler @argList 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -ne 'System.Management.Automation.RemoteException' }
  return [pscustomobject]@{ Code = $LASTEXITCODE; Text = (Hide ($lines -join "`n")) }
}

# PS 5.1 chèn BOM khi pipe vào stdin → ghi file tạm trong %TEMP% (chỉ user này đọc được), xoá ngay sau khi dùng
function Set-WorkerSecrets([hashtable]$secrets) {
  $tmp = Join-Path $env:TEMP ('ff-secrets-' + [guid]::NewGuid().ToString('N') + '.json')
  try {
    [IO.File]::WriteAllText($tmp, ($secrets | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding $false))
    $r = Invoke-Wrangler @('secret', 'bulk', $tmp)
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
  Write-Host $r.Text
  if ($r.Code -ne 0 -or $r.Text -match '\[ERROR\]|No content') { Fail 'wrangler secret bulk loi' }
  $list = Invoke-Wrangler @('secret', 'list')
  foreach ($name in $secrets.Keys) {
    if ($list.Text -notmatch [regex]::Escape($name)) { Fail "Secret $name chua co tren Worker sau khi ghi" }
  }
  Write-Host ('Da ghi secret: ' + (($secrets.Keys | Sort-Object) -join ', ')) -ForegroundColor Green
}

function New-WebhookSecret {
  $chars = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Invoke-Telegram([string]$method, $body) {
  $token = Get-BotToken
  try {
    $req = @{ Method = 'Post'; Uri = "https://api.telegram.org/bot$token/$method"; ContentType = 'application/json; charset=utf-8' }
    if ($body) { $req.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress)) }
    return Invoke-RestMethod @req
  } catch {
    # Telegram trả lý do trong body JSON (description)
    $detail = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    Fail ("Telegram $method loi: " + (Hide $detail))
  }
}

function Invoke-Neon([string[]]$argList) {
  $env:FF_NEON_URL = Get-NeonUrl
  try {
    $r = Invoke-Tool 'node' (@('scripts/neon-members.mjs') + $argList) -Quiet
  } finally {
    Remove-Item Env:FF_NEON_URL -ErrorAction SilentlyContinue
  }
  if ($r.Code -ne 0) { Fail (Hide $r.Text) }
  return ($r.Text -split "`n" | Where-Object { $_ -match '^[\[{]' } | Select-Object -Last 1) | ConvertFrom-Json
}

# ---------- Cac buoc ----------

function Step1 {
  Write-Step 1 'Kiem tra cong cu + dang nhap Cloudflare'
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Chua cai Node.js (can >= 22)' }
  Write-Host ('Node ' + (& node --version))
  if (-not (Test-Path 'node_modules')) {
    Write-Host 'Chua co node_modules -> npm install'
    if ((Invoke-Tool 'npm.cmd' @('install')).Code -ne 0) { Fail 'npm install loi' }
  }
  $who = Invoke-Wrangler @('whoami')
  if ($who.Code -ne 0 -or $who.Text -match 'not authenticated|You are not logged in') {
    Write-Host 'Chua dang nhap Cloudflare -> mo trinh duyet de dang nhap'
    if ((Invoke-Tool 'node' @($Wrangler, 'login')).Code -ne 0) { Fail 'wrangler login loi' }
  } else {
    Write-Host 'Da dang nhap Cloudflare.' -ForegroundColor Green
  }
}

function Step2 {
  Write-Step 2 'Tao wrangler.toml (production, cron 1h sang VN)'
  $path = Join-Path $Backend 'wrangler.toml'
  if (-not (Test-Path $path)) {
    Copy-Item (Join-Path $Backend 'wrangler.toml.example') $path
    Write-Host 'Da tao wrangler.toml tu wrangler.toml.example'
  }
  $text = [IO.File]::ReadAllText($path)
  $new = $text -replace 'ENVIRONMENT\s*=\s*"[^"]*"', 'ENVIRONMENT = "production"'
  if ($new -notmatch 'crons\s*=') { $new += "`n[triggers]`ncrons = [`"0 18 * * *`"]`n" }
  if ($new -ne $text) {
    [IO.File]::WriteAllText($path, $new, (New-Object System.Text.UTF8Encoding $false))
    Write-Host 'Da dat ENVIRONMENT = "production"'
  }
  if ($new -match '(?im)^\s*(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|NEON_DATABASE_URL)\s*=') {
    Fail 'wrangler.toml dang chua secret - xoa dong do, secret chi nhap qua wrangler secret'
  }
  Write-Host 'wrangler.toml OK (file nay khong commit).' -ForegroundColor Green
}

function Step3 {
  Write-Step 3 'Chay test + typecheck'
  if ((Invoke-Tool 'npm.cmd' @('run', 'typecheck')).Code -ne 0) { Fail 'typecheck loi' }
  $t = Invoke-Tool 'npm.cmd' @('test') -Quiet
  ($t.Text -split "`n" | Where-Object { $_ -match '(tests|pass|fail) \d+$' }) | ForEach-Object { Write-Host $_ }
  if ($t.Code -ne 0) { Fail 'Co test loi - chay npm test de xem' }
}

function Step4 {
  Write-Step 4 'Deploy Worker len Cloudflare'
  if (-not (Confirm-Go 'Deploy code hien tai len Cloudflare?')) { Fail 'Da dung' }
  # Chạy trực tiếp (không bắt output) để wrangler hỏi được, vd đăng ký subdomain workers.dev lần đầu
  Write-Host 'Neu wrangler hoi "register a workers.dev subdomain" -> chon Yes va dat ten (chi 1 lan cho tai khoan).' -ForegroundColor Yellow
  & node $Wrangler deploy
  if ($LASTEXITCODE -ne 0) { Fail 'wrangler deploy loi (xem thong bao ngay tren)' }
  [void](Get-WorkerUrl)
}

function Step5 {
  Write-Step 5 'Nhap secret TELEGRAM_BOT_TOKEN + NEON_DATABASE_URL'
  $token = Get-BotToken
  $me = Invoke-Telegram 'getMe' $null
  Write-Host "Bot: @$($me.result.username) ($($me.result.first_name))" -ForegroundColor Green
  $neon = Get-NeonUrl
  $c = Invoke-Neon @('check')
  Write-Host "Neon: $($c.so_bang) bang, $($c.so_danh_muc) danh muc, $($c.so_thanh_vien) thanh vien"
  if ($c.so_bang -lt 17 -or $c.so_danh_muc -lt 25 -or $c.so_thanh_vien -lt 2) {
    Fail 'DB Neon chua du bang/du lieu - chay temp/neon/03_setup_db_moi.sql truoc'
  }
  if ($c.co_cac_con -lt 1) { Fail 'Neon chua co doi tuong CAC_CON (Phase 5b) - chay temp/neon/04_them_cac_con.sql truoc' }
  if ($c.co_hu_tiet_kiem -lt 1) { Fail 'Neon chua co bang hu_tiet_kiem (Phase 5c) - chay temp/neon/05_hu_tiet_kiem.sql truoc' }
  if ($c.co_nhieu_hu -lt 1) { Fail 'Neon chua co nhieu hu (migration 0005) - chay temp/neon/06_nhieu_hu.sql truoc' }
  if ($c.hu_dung_kieu -lt 1) { Fail 'Bang hu tren Neon sai kieu (lo chay ban SQLite) - chay temp/neon/07_sua_bang_hu.sql' }
  if (-not (Confirm-Go 'Ghi 2 secret nay vao Worker?')) { Fail 'Da dung' }
  Set-WorkerSecrets @{ TELEGRAM_BOT_TOKEN = $token; NEON_DATABASE_URL = $neon }
}

function Step6 {
  Write-Step 6 'Tao secret webhook moi + dang ky webhook voi Telegram'
  $url = Get-WorkerUrl
  [void](Get-BotToken)
  if (-not (Confirm-Go "Dang ky webhook $url/telegram/webhook (secret moi, bo cac tin dang cho)?")) { Fail 'Da dung' }
  # Secret webhook sinh moi moi lan va ghi vao Worker ngay truoc setWebhook -> hai ben luon khop
  $secret = New-WebhookSecret
  Set-WorkerSecrets @{ TELEGRAM_WEBHOOK_SECRET = $secret }
  Start-Sleep -Seconds 3
  $r = Invoke-Telegram 'setWebhook' @{
    url = "$url/telegram/webhook"
    secret_token = $secret
    allowed_updates = @('message', 'edited_message', 'callback_query')
    drop_pending_updates = $true
  }
  if (-not $r.ok) { Fail "setWebhook tra ok=false: $($r.description)" }
  $info = (Invoke-Telegram 'getWebhookInfo' $null).result
  Write-Host "Webhook: $($info.url) - dang cho: $($info.pending_update_count)" -ForegroundColor Green
  if ($info.last_error_message) { Write-Host "Loi gan nhat: $($info.last_error_message)" -ForegroundColor Yellow }
}

function Step7 {
  Write-Step 7 'Dang ky Telegram ID that cho chong va vo'
  Write-Host 'Luc nay bot coi ca hai la nguoi la: chi luu tin, KHONG tra loi.'
  Write-Host 'Moi nguoi mo bot tren Telegram, nhan 1 tin, vd: "chong day" va "vo day".'
  while ($true) {
    [void](Read-Host 'Nhan xong thi Enter')
    $d = Invoke-Neon @('list')
    Write-Host 'Tin nguoi la gan nhat (ID = Telegram ID nguoi nhan):'
    $d.tin | Format-Table id, tin, luc -AutoSize | Out-String | Write-Host
    Write-Host 'Thanh vien hien tai:'
    $d.thanh_vien | Format-Table id, ten, telegram_user_id -AutoSize | Out-String | Write-Host
    if (@($d.tin).Count -gt 0) { break }
    Write-Host 'Chua thay tin nao - kiem tra lai webhook (buoc 6) roi nhan lai.' -ForegroundColor Yellow
  }
  Write-Host 'Bo trong o nao thi bo qua nguoi do (dang ky sau bang -From 7).'
  $chong = (Read-Host 'Telegram ID cua CHONG (Enter = bo qua)').Trim()
  $vo = (Read-Host 'Telegram ID cua VO (Enter = bo qua)').Trim()
  $pairs = @()
  if ($chong) { $pairs += ,@('CHONG', $chong) }
  if ($vo) { $pairs += ,@('VO', $vo) }
  if ($pairs.Count -eq 0) { Fail 'Chua nhap ID nao' }
  foreach ($p in $pairs) { if ($p[1] -notmatch '^\d{5,15}$') { Fail "ID cua $($p[0]) phai la so" } }
  if ($chong -and $chong -eq $vo) { Fail 'Hai ID phai khac nhau' }
  $desc = ($pairs | ForEach-Object { "$($_[0]) = $($_[1])" }) -join ', '
  if (-not (Confirm-Go "Cap nhat $desc tren Neon?")) { Fail 'Da dung' }
  $argList = @('set')
  foreach ($p in $pairs) { $argList += $p[0]; $argList += $p[1] }
  $rows = Invoke-Neon $argList
  $rows | Format-Table id, ten, telegram_user_id -AutoSize | Out-String | Write-Host
  Write-Host 'Da dang ky.' -ForegroundColor Green
}

function Step8 {
  Write-Step 8 'Viec con lai tren Telegram'
  Write-Host '1. Moi nguoi nhan /start -> bot chao theo ten.'
  Write-Host '2. Mot nguoi nhap so du ban dau (1 lan, truoc khi ghi giao dich):  /sodudau <vo> <chong> <quy chung>   vd /sodudau 5tr 3tr 2tr'
  Write-Host '3. Thu: "tien an 50k" -> Huy; "cafe 30k" -> chon danh muc; chong nhan "chuyen vo 100k" -> vo bam Da nhan; /sodu, /thang, /cho.'
  Write-Host 'Xem log truc tiep: npx wrangler tail     -  Tat bot: chay lai script -From 6 sau khi xu ly, hoac deleteWebhook.'
}

$steps = @{ 1 = ${function:Step1}; 2 = ${function:Step2}; 3 = ${function:Step3}; 4 = ${function:Step4}
            5 = ${function:Step5}; 6 = ${function:Step6}; 7 = ${function:Step7}; 8 = ${function:Step8} }
try {
  for ($i = $From; $i -le [Math]::Min($To, 8); $i++) { & $steps[$i] }
  Write-Host ''
  Write-Host 'Xong.' -ForegroundColor Green
} finally {
  $script:BotToken = $null
  $script:NeonUrl = $null
}
