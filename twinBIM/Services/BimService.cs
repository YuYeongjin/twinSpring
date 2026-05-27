using BimProcessorApi.Data;
using BimProcessorApi.Models;
using System.Text.Json; // JSON 직렬화/역직렬화를 위한 임시 도구
using System.Threading.Tasks;
using System.Linq;
using Microsoft.EntityFrameworkCore;

namespace BimProcessorApi.Services
{
    public class BimService
    {
        private readonly BimDbContext _context;

        public BimService(BimDbContext context)
        {
            _context = context;
        }

        // ---------------------------------------------------------------------
        // C - CREATE (모델 전체 저장)
        // ---------------------------------------------------------------------
        public async Task SaveModelAsync(Project project, List<Element> elements)
        {
            // ── 프로젝트 저장/업데이트 ────────────────────────────────
            var existingProject = await _context.Projects.FindAsync(project.ProjectId);
            if (existingProject == null)
            {
                _context.Projects.Add(project);
                await _context.SaveChangesAsync(); // 부재 FK 제약 전에 프로젝트를 먼저 커밋
            }
            else
            {
                existingProject.ProjectName   = project.ProjectName;
                existingProject.StructureType = project.StructureType;
                existingProject.SpanCount     = project.SpanCount;
                await _context.SaveChangesAsync();
            }

            // ── 기존 부재 일괄 삭제 (ExecuteDeleteAsync → 단일 DELETE SQL) ─
            // EF Core 7+ : 엔티티를 메모리에 로드하지 않고 직접 DELETE 실행
            await _context.Elements
                .Where(e => e.ProjectId == project.ProjectId)
                .ExecuteDeleteAsync();

            // ── 새 부재 일괄 삽입 ────────────────────────────────────
            if (elements.Count > 0)
            {
                foreach (var element in elements)
                {
                    element.ProjectId = project.ProjectId;
                    if (string.IsNullOrEmpty(element.ElementId))
                        element.ElementId = $"EL-{Guid.NewGuid().ToString()[..8].ToUpper()}";
                }
                _context.Elements.AddRange(elements);
                await _context.SaveChangesAsync();
            }
        }

        // ---------------------------------------------------------------------
        // R - READ (프로젝트 목록 및 부재 목록 조회)
        // ---------------------------------------------------------------------
        public async Task<List<Project>> GetProjectListAsync()
        {
            return await _context.Projects.ToListAsync();
        }

        public async Task<List<Element>> GetElementsByProjectIdAsync(string projectId)
        {
            return await _context.Elements
                .AsNoTracking()
                .Where(e => e.ProjectId == projectId)
                .ToListAsync();
        }

        // ---------------------------------------------------------------------
        // U - UPDATE (단일 부재 수정)
        // ---------------------------------------------------------------------
        public async Task<bool> UpdateElementAsync(Element updatedElement)
        {
            var existing = await _context.Elements.FindAsync(updatedElement.ElementId);
            if (existing == null) return false;

            // 부재 유형 및 재료 업데이트 (Revit Properties 창과 동일)
            existing.ElementType = updatedElement.ElementType;
            existing.Material    = updatedElement.Material;

            // 위치 업데이트 (X/Y/Z)
            existing.PositionX = updatedElement.PositionX;
            existing.PositionY = updatedElement.PositionY;
            existing.PositionZ = updatedElement.PositionZ;

            // 치수 업데이트 (폭/높이/깊이)
            existing.SizeX = updatedElement.SizeX;
            existing.SizeY = updatedElement.SizeY;
            existing.SizeZ = updatedElement.SizeZ;

            // 회전 업데이트 (라디안)
            existing.RotationX = updatedElement.RotationX ?? 0;
            existing.RotationY = updatedElement.RotationY ?? 0;
            existing.RotationZ = updatedElement.RotationZ ?? 0;

            _context.Entry(existing).State = EntityState.Modified;
            await _context.SaveChangesAsync();
            return true;
        }

        // ---------------------------------------------------------------------
        // C - CREATE (단일 부재 신규 추가)
        // Revit의 "부재 배치" 기능에 해당 — 새 elementId를 부여하여 DB에 삽입
        // ---------------------------------------------------------------------
        public async Task<Element> CreateElementAsync(Element element)
        {
            // elementId가 없으면 자동 생성
            if (string.IsNullOrEmpty(element.ElementId))
            {
                element.ElementId = $"EL-{Guid.NewGuid().ToString()[..6].ToUpper()}";
            }

            _context.Elements.Add(element);
            await _context.SaveChangesAsync();
            return element; // 생성된 element 반환 (프론트에서 ID 확인용)
        }

        // ---------------------------------------------------------------------
        // D - DELETE (단일 부재 삭제)
        // Revit의 "Delete" 키 삭제 기능에 해당
        // ---------------------------------------------------------------------
        public async Task<bool> DeleteElementAsync(string elementId)
        {
            var element = await _context.Elements.FindAsync(elementId);
            if (element == null) return false;

            _context.Elements.Remove(element);
            await _context.SaveChangesAsync();
            return true;
        }

        // ---------------------------------------------------------------------
        // D - DELETE (단일 프로젝트 삭제)
        // ---------------------------------------------------------------------
        public async Task<bool> DeleteProjectAsync(string projectId)
        {
            var projectToDelete = await _context.Projects.FindAsync(projectId);
            if (projectToDelete == null) return false;

            // FK 제약 위반 방지: 프로젝트에 속한 부재를 먼저 삭제 (Cascade Delete)
            var elements = _context.Elements.Where(e => e.ProjectId == projectId);
            _context.Elements.RemoveRange(elements);

            _context.Projects.Remove(projectToDelete);
            await _context.SaveChangesAsync();
            return true;
        }


        public List<Element> GenerateInitialElements(Project project)
        {
            return new List<Element>();
        }

        // ---------------------------------------------------------------------
        // 구조 분석 — 프로젝트 부재를 타입별로 집계하여 통계 반환
        // ---------------------------------------------------------------------
        public async Task<object> GetStructuralAnalysisAsync(string projectId)
        {
            var elements = await _context.Elements
                .AsNoTracking()
                .Where(e => e.ProjectId == projectId)
                .ToListAsync();

            if (elements.Count == 0)
                return new { projectId, totalCount = 0, groups = Array.Empty<object>() };

            var groups = elements
                .GroupBy(e => e.ElementType ?? "Unknown")
                .Select(g =>
                {
                    var xs = g.Where(e => e.PositionX.HasValue).Select(e => e.PositionX!.Value).ToList();
                    var ys = g.Where(e => e.PositionY.HasValue).Select(e => e.PositionY!.Value).ToList();
                    var zs = g.Where(e => e.PositionZ.HasValue).Select(e => e.PositionZ!.Value).ToList();

                    return new
                    {
                        elementType  = g.Key,
                        count        = g.Count(),
                        materials    = g.GroupBy(e => e.Material ?? "Unknown")
                                        .Select(m => new { material = m.Key, count = m.Count() })
                                        .ToList(),
                        positionRange = new
                        {
                            xMin = xs.Count > 0 ? xs.Min() : 0.0,
                            xMax = xs.Count > 0 ? xs.Max() : 0.0,
                            yMin = ys.Count > 0 ? ys.Min() : 0.0,
                            yMax = ys.Count > 0 ? ys.Max() : 0.0,
                            zMin = zs.Count > 0 ? zs.Min() : 0.0,
                            zMax = zs.Count > 0 ? zs.Max() : 0.0,
                        },
                        avgSizeY = g.Where(e => e.SizeY.HasValue)
                                    .Select(e => e.SizeY!.Value)
                                    .DefaultIfEmpty(0)
                                    .Average(),
                    };
                })
                .OrderByDescending(g => g.count)
                .ToList();

            return new
            {
                projectId,
                totalCount = elements.Count,
                groups,
            };
        }

    }
}