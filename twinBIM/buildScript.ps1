$projectPath = "D:\user\twinSpring\twinSpring\twinBIM"
$outputPath = "$projectPath\publish"

# 기존 폴더 삭제
if (Test-Path $outputPath) {
    Remove-Item -Recurse -Force $outputPath
}

# 빌드 실행
dotnet publish "$projectPath\twinBIM.csproj" -c Release -r linux-arm --self-contained true -p:PublishTrimmed=false -o $outputPath

Write-Host "✅ Publish 완료: $outputPath"
