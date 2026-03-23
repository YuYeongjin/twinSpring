package yyj.project.twinspring.dto;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

// @Data = @Getter + @Setter + @EqualsAndHashCode + @ToString + @RequiredArgsConstructor
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SensorDTO {
    private String location;
    private double temperature;
    private double humidity;
    private String timestamp;

    // 생성자 인자 순서를 명시적으로 유지하기 위한 커스텀 생성자
    public SensorDTO(String location, double temperature, String timestamp, double humidity) {
        this.location = location;
        this.temperature = temperature;
        this.timestamp = timestamp;
        this.humidity = humidity;
    }

    @Override
    public String toString() {
        return "location=" + location + ", temperature=" + temperature + ", humidity=" + humidity + ", time=" + timestamp;
    }
}
