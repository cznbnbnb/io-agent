$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../rebuild/android-app/.private/fixture-tls'))
New-Item -ItemType Directory -Force $taskRoot|Out-Null
$taskOpenSsl='C:/Program Files/Git/usr/bin/openssl.exe'
if(-not(Test-Path -LiteralPath $taskOpenSsl)){throw 'OpenSSL from installed Git is required'}
$taskCert=Join-Path $taskRoot 'server.pem'
$taskKey=Join-Path $taskRoot 'server.key'
$taskTrust=Join-Path $taskRoot 'truststore.jks'
$taskPassFile=Join-Path $taskRoot 'truststore-pass.txt'
if(-not(Test-Path -LiteralPath $taskCert)){
 if(Test-Path -LiteralPath $taskKey){throw 'Existing partial fixture key requires inspection'}
 & $taskOpenSsl req -x509 -newkey rsa:2048 -nodes -keyout $taskKey -out $taskCert -days 7 -subj '/CN=io-agent-local-fixture' -addext 'subjectAltName=IP:127.0.0.1,DNS:localhost' -addext 'basicConstraints=critical,CA:TRUE' -addext 'extendedKeyUsage=serverAuth' 2>$null
 if($LASTEXITCODE -ne 0){throw 'Fixture certificate generation failed'}
}
$taskHash=(& $taskOpenSsl x509 -in $taskCert -noout -subject_hash_old).Trim()
if($taskHash -notmatch '^[a-f0-9]{8}$'){throw 'Invalid certificate subject hash'}
Copy-Item -LiteralPath $taskCert -Destination (Join-Path $taskRoot ($taskHash+'.0'))
if(-not(Test-Path -LiteralPath $taskTrust)){
 if(Test-Path -LiteralPath $taskPassFile){throw 'Partial fixture truststore requires inspection'}
 [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))|Set-Content -LiteralPath $taskPassFile -NoNewline -Encoding ascii
 $env:IO_AGENT_FIXTURE_PASS=Get-Content -LiteralPath $taskPassFile -Raw
 try{& keytool -importcert -noprompt -alias io-agent-local-fixture -file $taskCert -keystore $taskTrust -storetype JKS -storepass:env IO_AGENT_FIXTURE_PASS 2>$null;if($LASTEXITCODE -ne 0){throw 'Fixture truststore failed'}}finally{Remove-Item Env:IO_AGENT_FIXTURE_PASS}
}
[pscustomobject]@{subject_hash_old=$taskHash;role='local synthetic HTTPS integration tests only';shipped_in_apk=$false;real_phone_modified=$false}|ConvertTo-Json|Set-Content -Encoding utf8 (Join-Path $taskRoot 'metadata.json')
Write-Output 'Local fixture TLS material ready; key and password remain private'
