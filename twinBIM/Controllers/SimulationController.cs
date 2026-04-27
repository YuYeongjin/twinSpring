using Microsoft.AspNetCore.Mvc;
using BimProcessorApi.Models;
using BimProcessorApi.Services;

[ApiController]
[Route("api/[controller]")]
public class SimulationController : ControllerBase
{
    private readonly SimulationService _sim;

    public SimulationController(SimulationService sim)
    {
        _sim = sim;
    }

    // GET /api/simulation/excavator  → 기본 장비(EX-001) 상태 조회
    [HttpGet("excavator")]
    public async Task<ActionResult<ExcavatorState>> GetDefault()
    {
        var state = await _sim.GetStateAsync();
        return Ok(state);
    }

    // GET /api/simulation/excavator/{id}
    [HttpGet("excavator/{excavatorId}")]
    public async Task<ActionResult<ExcavatorState>> Get(string excavatorId)
    {
        var state = await _sim.GetStateAsync(excavatorId);
        return Ok(state);
    }

    // PUT /api/simulation/excavator  → 상태 갱신 (프론트에서 주기적으로 호출)
    [HttpPut("excavator")]
    public async Task<ActionResult<ExcavatorState>> Update([FromBody] ExcavatorState state)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        var updated = await _sim.UpdateStateAsync(state);
        return Ok(updated);
    }

    // POST /api/simulation/excavator/reset
    [HttpPost("excavator/reset")]
    public async Task<ActionResult<ExcavatorState>> Reset(
        [FromQuery] string excavatorId = "EX-001")
    {
        var state = await _sim.ResetAsync(excavatorId);
        return Ok(state);
    }

    // GET /api/simulation/excavator/kinematics  → 버킷 끝 위치 계산
    [HttpGet("excavator/kinematics")]
    public async Task<ActionResult> Kinematics(
        [FromQuery] string excavatorId = "EX-001")
    {
        var state      = await _sim.GetStateAsync(excavatorId);
        var kinematics = _sim.CalculateKinematics(state);
        return Ok(new { state, kinematics });
    }
}
