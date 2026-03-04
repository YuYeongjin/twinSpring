# sendZipFile.ps1

# ======================
# 환경 설정
# ======================
$projectPath = "D:\user\twinSpring\twinSpring\twinBIM"
$publishPath = "$projectPath\publish"
$zipFile = "$projectPath\publish.zip"
$remoteUser = "user"
$remoteHost = "192.168.219.108"
$remotePath = "/home/user/Desktop/project"

# ======================
# 압축 생성
# ======================
if (Test-Path $zipFile) {
    Remove-Item -Force $zipFile
}
Compress-Archive -Path "$publishPath\*" -DestinationPath $zipFile
Write-Host "✅ 압축 완료: $zipFile"

# ======================
# SSH 비밀번호 입력받기
# ======================
$securePwd = Read-Host "🔑 라즈베리파이 비밀번호 입력" -AsSecureString
$plainPwd = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePwd)
)

# ======================
# 파일 전송 (scp 사용)
# ======================
Write-Host "🚀 파일 전송 중..."
Start-Process -Wait -NoNewWindow `
    -FilePath "cmd.exe" `
    -ArgumentList "/c echo $plainPwd | scp -o StrictHostKeyChecking=no $zipFile $remoteUser@$remoteHost:`"$remotePath`""

Write-Host "✅ 파일 전송 완료!"
