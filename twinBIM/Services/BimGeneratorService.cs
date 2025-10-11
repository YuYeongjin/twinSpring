
using BimProcessorApi.Models;
using System.Collections.Generic;

namespace BimProcessorApi.Services
{
    public class BimGeneratorService
    {
        // Spring으로부터 프로젝트 ID를 받아 가상의 BIM 모델 데이터를 생성합니다.
        public BimModelData GenerateDummyModel(string projectId)
        {
            var model = new BimModelData
            {
                ModelName = $"BIM Model for {projectId}",
                Elements = new List<BimElement>()
            };

            // 1. 기둥 생성 (IfcColumn 흉내)
            for (int i = 0; i < 4; i++) // 4개의 기둥 생성
            {
                model.Elements.Add(new BimElement
                {
                    Id = $"COL_{projectId}_{i+1}",
                    Type = "IfcColumn",
                    Position = new float[] { (i % 2) * 10 - 5, 0, (i / 2) * 10 - 5 }, // 3D 격자 위치
                    Size = new float[] { 0.5f, 5.0f, 0.5f }, // 크기: 5.0f는 높이
                    Material = "Concrete C40",
                    ProjectId = projectId
                });
            }

            // 2. 벽 생성 (IfcWall 흉내)
            model.Elements.Add(new BimElement
            {
                Id = $"WAL_{projectId}_A",
                Type = "IfcWall",
                Position = new float[] { 0, 2.5f, -5f }, // 중앙에 위치 (높이 2.5)
                Size = new float[] { 12f, 5.0f, 0.2f }, // 벽의 길이 12f, 높이 5.0f
                Material = "Brick_Standard",
                ProjectId = projectId
            });

            return model;
        }
    }
}