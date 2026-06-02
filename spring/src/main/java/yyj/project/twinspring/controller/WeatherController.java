package yyj.project.twinspring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.service.WeatherService;

import java.util.Map;

/**
 * 날씨 API 프록시
 *
 * GET /api/weather?lat=37.5&lon=127.0   — 좌표 기반
 * GET /api/weather?city=Seoul           — 도시명 기반 (city 파라미터 우선)
 */
@RestController
@RequestMapping("/api/weather")
public class WeatherController {

    private final WeatherService weatherService;

    public WeatherController(WeatherService weatherService) {
        this.weatherService = weatherService;
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> getWeather(
            @RequestParam(required = false) String city,
            @RequestParam(defaultValue = "37.5665") double lat,
            @RequestParam(defaultValue = "126.9780") double lon) {

        Map<String, Object> result = (city != null && !city.isBlank())
                ? weatherService.getWeatherByCity(city)
                : weatherService.getWeatherByCoords(lat, lon);

        return ResponseEntity.ok(result);
    }
}
