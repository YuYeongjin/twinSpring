package yyj.project.twinspring.config;

import io.minio.MinioClient;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import yyj.project.twinspring.storage.MinioStorageService;
import yyj.project.twinspring.storage.StorageProperties;
import yyj.project.twinspring.storage.StorageService;

@Configuration
@EnableConfigurationProperties(StorageProperties.class)
public class StorageConfig {

    @Bean
    public StorageService storageService(StorageProperties props) {
        MinioClient client = MinioClient.builder()
                .endpoint(props.getEndpoint())
                .credentials(props.getAccessKey(), props.getSecretKey())
                .build();
        return new MinioStorageService(client, props.getBucket());
    }
}
