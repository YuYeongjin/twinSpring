package yyj.project.twinspring.storage;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
@ConfigurationProperties(prefix = "storage")
public class StorageProperties {

    /** MinIO / S3 endpoint URL (예: http://minio:9000) */
    private String endpoint;

    /** Access Key (MinIO root user 또는 IAM 서비스 계정) */
    private String accessKey;

    /** Secret Key */
    private String secretKey;

    /** 버킷 이름 */
    private String bucket = "twinspring";

    /** HTTPS 사용 여부 (MinIO의 경우 내부망이면 false) */
    private boolean secure = false;
}
