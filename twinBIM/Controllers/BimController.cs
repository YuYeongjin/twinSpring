
using Microsoft.AspNetCore.Mvc;
using BimProcessorApi.Models;
using BimProcessorApi.Services;

[ApiController]
[Route("api/[controller]")] // 이 컨트롤러의 기본 경로: /api/bim
public class BimController : ControllerBase
{
    private readonly BimGeneratorService _bimService;

    // 생성자 주입 (Spring의 @Autowired와 동일)
    public BimController(BimGeneratorService bimService)
    {
        _bimService = bimService;
    }

    // Spring 서버가 호출할 엔드포인트: GET /api/bim/model/{projectId}
    [HttpGet("model/{projectId}")]
    public ActionResult<BimModelData> GetModel(string projectId)
    {
        if (string.IsNullOrEmpty(projectId))
        {
            return BadRequest("Project ID is required.");
        }

        // 서비스 로직을 호출하여 더미 데이터 생성
        var modelData = _bimService.GenerateDummyModel(projectId);
        Console.WriteLine("modelData: "+modelData);
        // ASP.NET Core는 자동으로 이 객체를 JSON으로 직렬화하여 반환합니다.
        return Ok(modelData); 
    }
}