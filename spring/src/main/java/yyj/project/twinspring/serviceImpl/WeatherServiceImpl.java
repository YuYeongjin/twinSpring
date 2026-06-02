package yyj.project.twinspring.serviceImpl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import yyj.project.twinspring.service.WeatherService;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class WeatherServiceImpl implements WeatherService {

    private static final Logger log = LoggerFactory.getLogger(WeatherServiceImpl.class);

    @Value("${weather.api.key:}")
    private String apiKey;

    @Value("${weather.api.url:https://api.openweathermap.org/data/2.5}")
    private String apiUrl;

    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public Map<String, Object> getWeatherByCoords(double lat, double lon) {
        if (apiKey == null || apiKey.isBlank()) {
            return mockWeather("API 키 미설정", lat, lon);
        }
        try {
            String url = apiUrl + "/weather?lat=" + lat + "&lon=" + lon
                    + "&appid=" + apiKey + "&units=metric&lang=kr";
            @SuppressWarnings("unchecked")
            Map<String, Object> raw = restTemplate.getForObject(url, Map.class);
            return parseWeather(raw);
        } catch (Exception e) {
            log.warn("날씨 API 호출 실패 (coords): {}", e.getMessage());
            return mockWeather("API 오류", lat, lon);
        }
    }

    @Override
    public Map<String, Object> getWeatherByCity(String city) {
        if (apiKey == null || apiKey.isBlank()) {
            return mockWeather("API 키 미설정", 37.5665, 126.9780);
        }
        try {
            String url = apiUrl + "/weather?q=" + city
                    + "&appid=" + apiKey + "&units=metric&lang=kr";
            @SuppressWarnings("unchecked")
            Map<String, Object> raw = restTemplate.getForObject(url, Map.class);
            return parseWeather(raw);
        } catch (Exception e) {
            log.warn("날씨 API 호출 실패 (city={}): {}", city, e.getMessage());
            return mockWeather("API 오류", 37.5665, 126.9780);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseWeather(Map<String, Object> raw) {
        if (raw == null) return new HashMap<>();
        Map<String, Object> result = new HashMap<>();

        Map<String, Object> main = (Map<String, Object>) raw.getOrDefault("main", Map.of());
        result.put("temp",      main.getOrDefault("temp", 0));
        result.put("feelsLike", main.getOrDefault("feels_like", 0));
        result.put("humidity",  main.getOrDefault("humidity", 0));
        result.put("tempMin",   main.getOrDefault("temp_min", 0));
        result.put("tempMax",   main.getOrDefault("temp_max", 0));

        Map<String, Object> wind = (Map<String, Object>) raw.getOrDefault("wind", Map.of());
        result.put("windSpeed", wind.getOrDefault("speed", 0));

        List<Map<String, Object>> weatherList = (List<Map<String, Object>>) raw.getOrDefault("weather", List.of());
        if (!weatherList.isEmpty()) {
            Map<String, Object> w = weatherList.get(0);
            result.put("description", w.getOrDefault("description", ""));
            result.put("icon",        w.getOrDefault("icon", "01d"));
            result.put("main",        w.getOrDefault("main", ""));
        }

        result.put("cityName",   raw.getOrDefault("name", ""));
        result.put("visibility", raw.getOrDefault("visibility", 0));
        result.put("mock",       false);
        return result;
    }

    private Map<String, Object> mockWeather(String reason, double lat, double lon) {
        Map<String, Object> m = new HashMap<>();
        m.put("temp",        22.0);
        m.put("feelsLike",   21.0);
        m.put("humidity",    60);
        m.put("windSpeed",   2.5);
        m.put("description", reason);
        m.put("icon",        "02d");
        m.put("main",        "Clouds");
        m.put("cityName",    "현장");
        m.put("tempMin",     18.0);
        m.put("tempMax",     26.0);
        m.put("visibility",  10000);
        m.put("mock",        true);
        m.put("mockReason",  reason);
        return m;
    }
}
