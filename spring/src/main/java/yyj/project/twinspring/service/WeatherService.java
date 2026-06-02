package yyj.project.twinspring.service;

import java.util.Map;

public interface WeatherService {
    Map<String, Object> getWeatherByCoords(double lat, double lon);
    Map<String, Object> getWeatherByCity(String city);
}
