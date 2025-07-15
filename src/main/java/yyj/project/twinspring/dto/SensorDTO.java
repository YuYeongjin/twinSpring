package yyj.project.twinspring.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SensorDTO {
    private String location;
    private int temperature;

    private String timestamp;
    public SensorDTO(){}
    public SensorDTO(String location, int temperature, String timestamp) {
        this.location = location;
        this.temperature = temperature;
        this.timestamp = timestamp;
    }
    public String getLocation() { return location; }
    public int getTemperature() { return temperature; }
    public String getTimestamp() { return timestamp; }
    @Override
    public String toString(){
        return "location : " + location + ", temperature : " + temperature + ", time: " + timestamp;
    };
}
