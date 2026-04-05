package yyj.project.twinspring.service;


import org.springframework.http.ResponseEntity;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.BimElementDTO;
import yyj.project.twinspring.dto.BimProjectDTO;

import java.util.List;

public interface BimService {

    Mono<String> getModelData(String projectId);

    Mono<List<BimProjectDTO>> getProjectList();

    ResponseEntity<Mono<List<BimElementDTO>>> getModelElements(String projectId);

    ResponseEntity<Mono<Void>> deleteProject(String projectId);

    ResponseEntity<Mono<Void>> updateElement(BimElementDTO element);

    Mono<ResponseEntity<Void>> newProject(String category);

    Mono<BimProjectDTO> createProject(BimProjectDTO project);

    ResponseEntity<Mono<List<BimElementDTO>>> getProject(String projectId);

    /** 단일 부재 신규 생성 (C# POST /api/bim/element 호출) */
    Mono<BimElementDTO> createElement(BimElementDTO element);

    /** 특정 좌표에 부재 생성 (elementType·projectId·좌표 지정, 크기는 타입별 기본값 적용) */
    Mono<BimElementDTO> createElementAt(String projectId, String elementType, String material,
                                        double x, double y, double z);

    /** 복합 구조물 배치 생성 (교각·골조 등 다수 부재 일괄 생성) */
    Mono<List<BimElementDTO>> createElements(List<BimElementDTO> elements);

    /** 단일 부재 삭제 (C# DELETE /api/bim/element/{elementId} 호출) */
    ResponseEntity<Mono<Void>> deleteElement(String elementId);
}
