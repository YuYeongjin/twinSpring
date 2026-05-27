package yyj.project.twinspring.dto;

/**
 * WBS Agent RAG 증거 검색 요청 DTO
 *
 * 이벤트 유형 + 상세 정보를 Python Agent /wbs-rag-suggest 로 전달한다.
 */
public class WbsRagRequestDTO {

    /** 이벤트 유형: COLLISION | CRACK | SAFE_ZONE | SAFETY */
    private String eventType;

    /** 이벤트 제목 (선택) */
    private String title;

    /** 이벤트 상세 설명 (선택) */
    private String detail;

    public WbsRagRequestDTO() {}

    public WbsRagRequestDTO(String eventType, String title, String detail) {
        this.eventType = eventType;
        this.title     = title;
        this.detail    = detail;
    }

    public String getEventType() { return eventType; }
    public void setEventType(String eventType) { this.eventType = eventType; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getDetail() { return detail; }
    public void setDetail(String detail) { this.detail = detail; }
}
