package yyj.project.twinspring.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
public class GeoLookupService {

    private final ConcurrentHashMap<String, Map<String, Object>> cache = new ConcurrentHashMap<>();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();
    private final ObjectMapper objectMapper;

    public GeoLookupService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /** IP → { country, city, regionName, lat, lon, countryCode } — 결과는 영구 캐시 */
    public Map<String, Object> lookup(String ip) {
        return cache.computeIfAbsent(ip, this::fetch);
    }

    private Map<String, Object> fetch(String ip) {
        if (isLocalOrPrivate(ip)) {
            return Map.of("country", "Local", "city", "Server",
                    "lat", 0.0, "lon", 0.0, "countryCode", "--", "status", "local");
        }
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create("http://ip-api.com/json/" + ip
                            + "?fields=status,country,city,regionName,lat,lon,countryCode"))
                    .timeout(Duration.ofSeconds(5))
                    .GET().build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 200) {
                return objectMapper.readValue(res.body(), new TypeReference<>() {});
            }
        } catch (Exception e) {
            log.warn("[GeoLookup] {} → {}", ip, e.getMessage());
        }
        return Map.of();
    }

    private boolean isLocalOrPrivate(String ip) {
        if (ip == null || ip.isBlank() || ip.equals("unknown")) return true;
        return ip.equals("::1") || ip.equals("0:0:0:0:0:0:0:1")
                || ip.startsWith("127.")
                || ip.startsWith("10.")
                || ip.startsWith("192.168.")
                || ip.startsWith("172.16.") || ip.startsWith("172.17.")
                || ip.startsWith("172.18.") || ip.startsWith("172.19.")
                || ip.startsWith("172.2")   || ip.startsWith("172.3");
    }
}
