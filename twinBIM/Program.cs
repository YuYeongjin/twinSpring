using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql.EntityFrameworkCore.PostgreSQL;
using BimProcessorApi.Data;
using BimProcessorApi.Services;
using BimProcessorApi.Models; 
using System.Text.Json.Serialization; 
using System.IO; 
using Microsoft.Extensions.Configuration; 

var builder = WebApplication.CreateBuilder(args);

// React 개발 서버(3000)에서 C# 서버(5112)로의 직접 호출 허용
builder.Services.AddCors(opt => opt.AddPolicy("AllowFrontend", p =>
    p.WithOrigins("http://localhost:3000", "http://localhost:8080")
     .AllowAnyHeader()
     .AllowAnyMethod()));

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy =
            System.Text.Json.JsonNamingPolicy.CamelCase;

        options.JsonSerializerOptions.DefaultIgnoreCondition =
            System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddAuthorization();


// 2. PostgreSQL DB Context 등록
// 우선순위: 환경변수 DB_CONNECTION_STRING > appsettings.json ConnectionStrings:PostgreSQLConnection
// Kubernetes: Secret에서 DB_CONNECTION_STRING 환경변수로 주입
// 로컬 개발: appsettings.json의 localhost 기본값 사용
var connectionString = Environment.GetEnvironmentVariable("DB_CONNECTION_STRING")
    ?? builder.Configuration.GetConnectionString("PostgreSQLConnection");

if (string.IsNullOrEmpty(connectionString))
{
    throw new InvalidOperationException(
        "DB 연결 문자열을 찾을 수 없습니다. " +
        "환경변수 'DB_CONNECTION_STRING' 또는 appsettings.json의 'ConnectionStrings:PostgreSQLConnection'을 설정하세요.");
}

var logger = LoggerFactory.Create(b => b.AddConsole()).CreateLogger("Startup");
if (Environment.GetEnvironmentVariable("DB_CONNECTION_STRING") != null)
    logger.LogInformation("[DB] 환경변수 DB_CONNECTION_STRING 사용");
else
    logger.LogInformation("[DB] appsettings.json 기본값 사용 (로컬 개발)");

builder.Services.AddDbContext<BimDbContext>(options =>
    options.UseNpgsql(connectionString)
);

// 3. BIM 서비스 등록
builder.Services.AddScoped<BimService>();
builder.Services.AddScoped<SimulationService>();
// PhysicsService: 요청마다 BEPUphysics2 시뮬레이션을 생성/해제하므로 Scoped
builder.Services.AddScoped<PhysicsService>();

// =========================================================================
// Build and Configure (앱 빌드 및 파이프라인 구성)
// =========================================================================

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// app.UseHttpsRedirection(); // (주석 처리된 상태 유지)

app.UseCors("AllowFrontend");

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
app.MapControllers();

// simulation_excavator 테이블 자동 생성
using (var scope = app.Services.CreateScope())
{
    var simService = scope.ServiceProvider.GetRequiredService<SimulationService>();
    await simService.EnsureTableAsync();
}

app.Run();

record WeatherForecast(DateOnly Date, int TemperatureC, string? Summary)
{
    public int TemperatureF => 32 + (int)(TemperatureC / 0.5556);
}
