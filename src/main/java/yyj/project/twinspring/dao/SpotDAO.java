package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import yyj.project.twinspring.dto.SensorDTO;

@Mapper
public interface SpotDAO {


    void insertData(SensorDTO data);
}
