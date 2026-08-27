$log = "dev_diag.log"
Remove-Item $log -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath "npx" -ArgumentList "electron-vite","dev" -RedirectStandardOutput $log -RedirectStandardError $log -PassThru -NoNewWindow
Start-Sleep -Seconds 15
$content = Get-Content $log -Raw
if ($content) { $content } else { "NO OUTPUT" }
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
