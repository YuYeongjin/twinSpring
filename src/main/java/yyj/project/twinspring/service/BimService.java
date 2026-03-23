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

    /** 단일 부재 신규 생성 (C# POST /api/bim/element/new 호출) */
    Mono<BimElementDTO> createElement(BimElementDTO element);

    /** 단일 부재 삭제 (C# DELETE /api/bim/element/{elementId} 호출) */
    ResponseEntity<Mono<Void>> deleteElement(String elementId);
}
