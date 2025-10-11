package yyj.project.twinspring.controller;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.BimModelDTO;
import yyj.project.twinspring.dto.SensorDTO;
import yyj.project.twinspring.service.BimService;
import yyj.project.twinspring.service.MqttService;

@RestController
@RequestMapping("/api/bim")
@CrossOrigin(origins = "*")
public class BimController {
    private final BimService bimService;

    public BimController(BimService bimService) {
        this.bimService = bimService;
    }

    @GetMapping(value = "/model",produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<ResponseEntity<String>> getModel(@RequestParam String projectId) {

        // C# 서비스로 요청을 위임하고 응답을 받습니다.
        return bimService.getModelData(projectId)
                .map(data -> ResponseEntity.ok(data)) // 성공 시 200 OK
                .defaultIfEmpty(ResponseEntity.notFound().build()); // C# 응답이 없을 경우 404
    }

}
