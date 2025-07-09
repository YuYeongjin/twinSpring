package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import yyj.project.twinspring.dto.SensorDTO;

import java.util.List;
import java.util.Map;


@Mapper
public interface SpotDAO {
    void insertData(SensorDTO data);

    List<Map<String, Object>> getAll();
}
