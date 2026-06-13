package yyj.project.twinspring.storage;

import java.io.InputStream;

/**
 * Object Storage 추상화 인터페이스.
 *
 * 현재 구현체: MinioStorageService (MinIO / S3 API 호환)
 * 향후 교체 가능: AwsS3StorageService, GcsStorageService 등
 *
 * 저장 대상:
 *  - IFC 원본 파일    (projects/{projectId}/original.ifc)
 *  - 드론 이미지      (projects/{projectId}/drone/{filename})
 *  - PDF 보고서       (projects/{projectId}/reports/{filename})
 *  - 생성 문서        (projects/{projectId}/docs/{filename})
 *  - 기타 첨부 파일   (projects/{projectId}/attachments/{filename})
 */
public interface StorageService {

    /**
     * 오브젝트를 업로드한다.
     *
     * @param key         스토리지 내 경로 (예: "projects/P-001/original.ifc")
     * @param inputStream 파일 스트림
     * @param size        바이트 크기 (-1 이면 스트리밍 업로드, 단 버킷 정책에 따라 제한 가능)
     * @param contentType MIME 타입 (예: "application/octet-stream")
     * @return 저장된 key (입력값과 동일)
     */
    String upload(String key, InputStream inputStream, long size, String contentType);

    /**
     * 오브젝트를 스트림으로 다운로드한다.
     * 호출자가 스트림을 닫아야 한다.
     *
     * @param key 스토리지 내 경로
     * @return InputStream (파일 없음 시 StorageException 발생)
     */
    InputStream download(String key);

    /**
     * 오브젝트를 삭제한다.
     * 키가 존재하지 않아도 예외를 던지지 않는다.
     *
     * @param key 스토리지 내 경로
     */
    void delete(String key);

    /**
     * 오브젝트 존재 여부를 확인한다.
     *
     * @param key 스토리지 내 경로
     * @return 존재하면 true
     */
    boolean exists(String key);
}
