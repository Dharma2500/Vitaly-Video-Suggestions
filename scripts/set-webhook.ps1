$ErrorActionPreference = "Stop"

$botToken = $null
$webhookSecret = $null
$botTokenSecure = $null
$webhookSecretSecure = $null

try {
    $botTokenSecure = Read-Host "BotFather token (input is hidden)" -AsSecureString
    $webhookSecretSecure = Read-Host "TELEGRAM_WEBHOOK_SECRET (input is hidden)" -AsSecureString
    $worker = (Read-Host "Worker base URL, e.g. https://name.account.workers.dev").Trim().TrimEnd("/")

    $tokenCredential = New-Object System.Net.NetworkCredential("", $botTokenSecure)
    $secretCredential = New-Object System.Net.NetworkCredential("", $webhookSecretSecure)
    $botToken = $tokenCredential.Password
    $webhookSecret = $secretCredential.Password

    $workerUri = [Uri]$worker
    if ($workerUri.Scheme -ne "https" -or $workerUri.AbsolutePath -ne "/" -or $workerUri.Query -or $workerUri.Fragment) {
        throw "Invalid Worker URL"
    }
    if ([string]::IsNullOrWhiteSpace($botToken) -or [string]::IsNullOrWhiteSpace($webhookSecret)) {
        throw "Missing credentials"
    }

    $body = @{
        url = "$worker/telegram/webhook"
        secret_token = $webhookSecret
        allowed_updates = @("message")
    } | ConvertTo-Json -Depth 3

    $requestParameters = @{
        Method = "Post"
        Uri = "https://api.telegram.org/bot$botToken/setWebhook"
        ContentType = "application/json"
        Body = $body
        ErrorAction = "Stop"
    }
    $response = Invoke-RestMethod @requestParameters

    if (-not $response.ok) {
        throw "Telegram API refused the webhook"
    }

    Write-Host "Webhook registered successfully. The bot token and webhook secret were not printed."
}
catch {
    Write-Host "Webhook registration failed. Check the Worker URL and the BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET values in Cloudflare. Detailed errors are hidden to avoid exposing credentials." -ForegroundColor Red
    exit 1
}
finally {
    $botToken = $null
    $webhookSecret = $null
    $botTokenSecure = $null
    $webhookSecretSecure = $null
}
