package yyj.project.twinspring.config;

import io.minio.MinioClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import yyj.project.twinspring.storage.MinioStorageService;
import yyj.project.twinspring.storage.StorageProperties;
import yyj.project.twinspring.storage.StorageService;

@Configuration
@EnableConfigurationProperties(StorageProperties.class)
public class StorageConfig {

    private static final Logger log = LoggerFactory.getLogger(StorageConfig.class);

    @Bean
    public StorageService storageService(StorageProperties props) {
        log.info("[Storage] MinIO endpoint={}, bucket={}", props.getEndpoint(), props.getBucket());
        MinioClient client = MinioClient.builder()
                .endpoint(props.getEndpoint())
                .credentials(props.getAccessKey(), props.getSecretKey())
                .build();
        return new MinioStorageService(client, props.getBucket());
    }
}
