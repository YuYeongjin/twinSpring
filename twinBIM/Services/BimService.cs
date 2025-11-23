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
            // 프로젝트 저장/업데이트
            var existingProject = await _context.Projects.FindAsync(project.ProjectId);
            if (existingProject == null)
            {
                _context.Projects.Add(project);
            }
            else
            {
                existingProject.ProjectId = project.ProjectId;
                existingProject.ProjectName = project.ProjectName;
                existingProject.StructureType = project.StructureType;
                existingProject.SpanCount = project.SpanCount;
            }

            // 기존 부재 삭제 (간단한 전체 덮어쓰기 로직)
            _context.Elements.RemoveRange(_context.Elements.Where(e => e.ProjectId == project.ProjectId));

            foreach (var element in elements)
            {
                element.ProjectId = project.ProjectId;
            }

            // 새 부재 저장
            _context.Elements.AddRange(elements);

            await _context.SaveChangesAsync();
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

            existing.Material = updatedElement.Material;
            existing.Material = updatedElement.Material;

            existing.PositionX = updatedElement.PositionX;
            existing.PositionY = updatedElement.PositionY;
            existing.PositionZ = updatedElement.PositionZ;

            existing.SizeX = updatedElement.SizeX;
            existing.SizeY = updatedElement.SizeY;
            existing.SizeZ = updatedElement.SizeZ;

            _context.Entry(existing).State = EntityState.Modified;
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

            _context.Projects.Remove(projectToDelete);
            await _context.SaveChangesAsync();
            return true;
        }


        public List<Element> GenerateInitialElements(Project project)
        {
            var elements = new List<Element>();

            int spanCount = 1;
            if (!string.IsNullOrEmpty(project.SpanCount))
            {
                int.TryParse(project.SpanCount, out spanCount); // 안전하고 CS1503 없음
            }



            if (project.StructureType == "Bridge")
            {
                // 1. 교량 부재 생성
                for (int i = 0; i < spanCount + 1; i++) // 교각
                {
                    float px = i * 20f - 30f;
                    float sy = 10f; // size Y

                    elements.Add(new Element
                    {
                        ElementId = $"P-{project.ProjectId}-{i + 1}",
                        ElementType = "IfcPier",
                        Material = "Concrete C50",
                        PositionX = px,
                        PositionY = 0f,
                        PositionZ = 0f,
                        SizeX = 3f,
                        SizeY = sy,
                        SizeZ = 3f
                    });
                }

                // 슬래브 생성
                elements.Add(new Element
                {
                    ElementId = $"DECK-{project.ProjectId}",
                    ElementType = "IfcSlab",
                    Material = "Prestressed Concrete",
                    PositionX = 0f,
                    PositionY = 10f,
                    PositionZ = 0f,
                    SizeX = (spanCount * 20f),
                    SizeY = 1f,
                    SizeZ = 10f
                });
            }
            else if (project.StructureType == "Building")
            {
                // 2. 건물 부재 생성 (기둥 4개)
                for (int i = 0; i < 4; i++)
                {
                    elements.Add(new Element
                    {
                        ElementId = $"COL-{project.ProjectId}-{i + 1}",
                        ElementType = "IfcColumn",
                        Material = "Steel Grade A",
                        PositionX = ((i % 2) * 8f - 4f),
                        PositionY = 0f,
                        PositionZ = ((i / 2) * 8f - 4f),
                        SizeX = 0.5f,
                        SizeY = 6f,
                        SizeZ = 0.5f
                    });
                }
            }

            return elements;
        }

    }
}