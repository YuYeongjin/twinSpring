package yyj.project.twinspring.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SensorDTO {
    public String location;
    public int temperature;

    public String timestamp;
    public SensorDTO(){}
    public SensorDTO(String location, int temperature, String timestamp) {
        this.location = location;
        this.temperature = temperature;
        this.timestamp = timestamp;
    }

    @Override
    public String toString(){
        return "location : " + location + ", temperature : " + temperature + ", time: " + timestamp;
    };
}
