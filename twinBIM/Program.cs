using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MySql.EntityFrameworkCore.Extensions;
using BimProcessorApi.Data;
using BimProcessorApi.Services;
using BimProcessorApi.Models; // WeatherForecast record를 위해 필요
using System.Text.Json.Serialization; // JSON 직렬화 설정
using System.IO; // ⚠️ [추가] 파일 I/O를 위한 네임스페이스
using Microsoft.Extensions.Configuration; // ⚠️ [추가] 설정 관리를 위한 네임스페이스

var builder = WebApplication.CreateBuilder(args);


builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy =
            System.Text.Json.JsonNamingPolicy.CamelCase;

        options.JsonSerializerOptions.DefaultIgnoreCondition =
            System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
    });
builder.Services.AddOpenApi();
builder.Services.AddAuthorization();

// 2. ⚠️ [핵심 추가] MySQL DB Context 등록
var connectionString = builder.Configuration.GetConnectionString("MySqlConnection");

if (string.IsNullOrEmpty(connectionString))
{
    // DB 연결 문자열이 없을 경우 예외 발생 (이전 오류 해결 코드)
    throw new InvalidOperationException("MySQL Connection string 'MySqlConnection' not found in configuration. Please ensure appsettings.json is present and includes the 'MySqlConnection' connection string.");
}

builder.Services.AddDbContext<BimDbContext>(options =>
    // MySQL Provider를 사용하여 연결 문자열 설정
    options.UseMySQL(connectionString)
);

// 3. BIM 서비스 등록 (DbContext 주입이 가능하도록 Scoped으로 등록)
builder.Services.AddScoped<BimService>();

// =========================================================================
// Build and Configure (앱 빌드 및 파이프라인 구성)
// =========================================================================

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// app.UseHttpsRedirection(); // (주석 처리된 상태 유지)

var summaries = new[]
{
    "Freezing", "Bracing", "Chilly", "Cool", "Mild", "Warm", "Balmy", "Hot", "Sweltering", "Scorching"
};

// MapGet은 Web API 개발 시 Controllers를 사용하는 것이 일반적입니다.
// 여기서는 기존 코드를 유지하되, 핵심 기능은 Controllers로 구현되어 있습니다.
app.MapGet("/weatherforecast", () =>
{
    var forecast = Enumerable.Range(1, 5).Select(index =>
        new WeatherForecast
        (
            DateOnly.FromDateTime(DateTime.Now.AddDays(index)),
            Random.Shared.Next(-20, 55),
            summaries[Random.Shared.Next(summaries.Length)]
        ))
        .ToArray();
    return forecast;
})
.WithName("GetWeatherForecast");

app.UseAuthorization();
app.MapControllers(); // 컨트롤러 (BimController) 라우팅 활성화
app.Run();

record WeatherForecast(DateOnly Date, int TemperatureC, string? Summary)
{
    public int TemperatureF => 32 + (int)(TemperatureC / 0.5556);
}
