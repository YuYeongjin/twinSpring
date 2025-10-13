
using Microsoft.AspNetCore.Mvc;
using BimProcessorApi.Models;
using BimProcessorApi.Services;

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
    public async Task<ActionResult<Project>> CreateProject([FromBody] Project project)
    {
        Console.WriteLine("project : "+ project);
        // 1. 초기 요소 생성
        var initialElements = _bimService.GenerateInitialElements(project);

        // 2. 프로젝트와 요소 모두 저장 (SaveModelAsync 재활용)
        await _bimService.SaveModelAsync(project, initialElements);

        // C# 컨트롤러는 저장된 Project 객체를 JSON으로 반환합니다.    
        return CreatedAtAction(nameof(GetProjectList), new { projectId = project.ProjectId }, project);

    }
}