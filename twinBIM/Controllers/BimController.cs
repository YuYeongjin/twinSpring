
using Microsoft.AspNetCore.Mvc;
using BimProcessorApi.Models;
using BimProcessorApi.Services;
using Google.Protobuf;
using System.Text.Json;
using System.Text;
[ApiController]
[Route("api/[controller]")] // 이 컨트롤러의 기본 경로: /api/bim
public class BimController : ControllerBase
{
    private readonly BimService _bimService;

    // 생성자 주입 (Spring의 @Autowired와 동일)
    public BimController(BimService bimService)
    {
        _bimService = bimService;
    }

    // Spring 서버가 호출할 엔드포인트: GET /api/bim/model/{projectId}
    [HttpGet("model/{projectId}")]
    public async Task<ActionResult<List<Element>>> GetModelElements(string projectId)
    {
        var elements = await _bimService.GetElementsByProjectIdAsync(projectId);
        if (elements == null || elements.Count == 0) return NotFound("Elements not found.");
        return Ok(elements);
    }

    [HttpGet("projects")]
    public async Task<ActionResult<List<Project>>> GetProjectList()
    {
        var projects = await _bimService.GetProjectListAsync();
        return Ok(projects);
    }
    [HttpPost("model")]
    public async Task<ActionResult> SaveModel([FromBody] BimModelRequest request)
    {

        // 임시로 DB에 저장
        // await _bimService.SaveModelAsync(project, elements);
        return Ok(); // 200 OK
    }
    [HttpPut("element")]
    public async Task<ActionResult> UpdateElement([FromBody] Element element)
    {
        if (await _bimService.UpdateElementAsync(element))
        {
            return NoContent(); // 204 No Content
        }
        return NotFound();
    }
    [HttpDelete("project/{projectId}")]
    public async Task<ActionResult> DeleteProject(string projectId)
    {
        if (await _bimService.DeleteProjectAsync(projectId))
        {
            return NoContent(); // 204 No Content
        }
        return NotFound();
    }


    [HttpPost("project")]
    public async Task<ActionResult<Project>> CreateProject(
        [FromBody] string req
        )
    {
        Console.WriteLine("project :@@@@@@@@ " + req);
        var project = JsonSerializer.Deserialize<Project>(req);
        // 1. 초기 요소 생성
        var initialElements = _bimService.GenerateInitialElements(project);

        // 2. 프로젝트와 요소 모두 저장 (SaveModelAsync 재활용)
        await _bimService.SaveModelAsync(project, initialElements);

        // C# 컨트롤러는 저장된 Project 객체를 JSON으로 반환합니다.    
        return CreatedAtAction(nameof(GetProjectList), new { projectId = project.ProjectId }, project);
        
    }

    // public async Task<ActionResult<Project>> CreateProject() 
    //     {
    //         // 1. HTTP 요청 본문 스트림을 읽어 Raw String으로 변환
    //         using var reader = new StreamReader(Request.Body, Encoding.UTF8);
    //         var req = await reader.ReadToEndAsync();

    //         Console.WriteLine($"project :@@@@@@@@ Raw Request Body: {req}");

    //         if (string.IsNullOrEmpty(req))
    //         {
    //             return BadRequest("Request body is empty or invalid.");
    //         }

    //         // 2. 수동으로 JSON 파싱 (역직렬화)
    //         var project = JsonSerializer.Deserialize<Project>(req);

    //         if (project == null)
    //         {
    //             return BadRequest("Invalid project data format for Project model.");
    //         }

    //         // 3. 비즈니스 로직 실행
    //         // 1. 초기 요소 생성
    //         // (주의: 이 부분은 가상의 서비스이므로 실제 서비스 의존성 주입이 필요합니다.)
    //         // var initialElements = _bimService.GenerateInitialElements(project);

    //         // 2. 프로젝트와 요소 모두 저장 (SaveModelAsync 재활용)
    //         // await _bimService.SaveModelAsync(project, initialElements);
            
    //         // 임시 데이터
    //         var initialElements = new List<Element>();
            
    //         // C# 컨트롤러는 저장된 Project 객체를 JSON으로 반환합니다.    
    //         return CreatedAtAction(nameof(GetProjectList), new { projectId = project.ProjectId }, project);
    //     }
}