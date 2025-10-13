package yyj.project.twinspring.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@ToString
public class BimProjectDTO {

    private String projectId;
    private String projectName;
    private String structureType;
    private int spanCount;
//    public void setProjectId(String projectId) {
//        this.projectId = projectId;
//    }
//    public void setProjectName(String projectName) {
//        this.projectName = projectName;
//    }
//    public void setStructureType(String structureType) {
//        this.structureType = structureType;
//    }
//    public void setSpanCount(int spanCount) {
//        this.spanCount = spanCount;
//    }
//    @Override
//    public String toString(){
//        return "projectId : " + projectId  + ", projectName : " + projectName + " , structureType : " + structureType + " , spanCount :" + spanCount;
//    }
}
