
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
    [HttpPost("element")]
    public async Task<ActionResult> UpdateElement([FromBody] Element element)
    {

        if (!ModelState.IsValid)
        {
            // 400 Bad Request와 함께 어떤 필드가 잘못되었는지 반환
            return BadRequest(ModelState);
        }
        Console.WriteLine("element :@@@@@@@@ " + element);
        if (await _bimService.UpdateElementAsync(element))
        {
            return NoContent(); // 204 No Content
        }
        return NotFound();
    }
    /// <summary>
    /// 단일 부재 신규 생성 (Revit "부재 배치"에 해당)
    /// POST /api/bim/element/new
    /// </summary>
    [HttpPost("element/new")]
    public async Task<ActionResult<Element>> CreateElement([FromBody] Element element)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);

        var created = await _bimService.CreateElementAsync(element);
        return CreatedAtAction(nameof(GetModelElements), new { projectId = created.ProjectId }, created);
    }

    /// <summary>
    /// 단일 부재 삭제 (Revit Delete 키에 해당)
    /// DELETE /api/bim/element/{elementId}
    /// </summary>
    [HttpDelete("element/{elementId}")]
    public async Task<ActionResult> DeleteElement(string elementId)
    {
        if (await _bimService.DeleteElementAsync(elementId))
            return NoContent();
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
        [FromBody] Project project
        )
    {

        Console.WriteLine("project :@@@@@@@@ " + project);
        var initialElements = _bimService.GenerateInitialElements(project);

        // 2. 프로젝트와 요소 모두 저장 (SaveModelAsync 재활용)
        await _bimService.SaveModelAsync(project, initialElements);

        // C# 컨트롤러는 저장된 Project 객체를 JSON으로 반환.
        return CreatedAtAction(nameof(GetProjectList), new { projectId = project.ProjectId }, project);

    }

    [HttpGet("project/{projectId}")]
    public async Task<ActionResult<List<Element>>> getProjectElement(
        string projectId
    )
    {
        var elements = await _bimService.GetElementsByProjectIdAsync(projectId);

        return elements;
    }
}