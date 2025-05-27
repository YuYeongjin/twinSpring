package yyj.project.twinspring.dto;

import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter
@Setter
public class SensorDTO {
    private String location;
    private int temperature;
    private LocalDateTime timestamp;

    @Override
    public String toString(){
        return "SensorDTO => " + "location : " + location + ", temperature : " + temperature + ", time: " + timestamp;
    };
}
