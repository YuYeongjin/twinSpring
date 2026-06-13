package yyj.project.twinspring.storage;

import io.minio.*;
import io.minio.errors.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;

/**
 * MinIO(S3 API 호환) 기반 StorageService 구현체.
 *
 * - 비즈니스 로직에서 MinIO SDK를 직접 사용하지 않도록 이 클래스에 격리
 * - StorageConfig 에서 Spring Bean으로 등록됨
 * - AWS S3로 교체 시 AwsS3StorageService 구현 후 StorageConfig에서 @Bean 교체
 */
public class MinioStorageService implements StorageService {

    private static final Logger log = LoggerFactory.getLogger(MinioStorageService.class);

    private final MinioClient minioClient;
    private final String bucket;

    public MinioStorageService(MinioClient minioClient, String bucket) {
        this.minioClient = minioClient;
        this.bucket = bucket;
    }

    @Override
    public String upload(String key, InputStream inputStream, long size, String contentType) {
        try {
            ensureBucketExists();
            minioClient.putObject(
                    PutObjectArgs.builder()
                            .bucket(bucket)
                            .object(key)
                            .stream(inputStream, size, -1)
                            .contentType(contentType)
                            .build()
            );
            log.info("[Storage] 업로드 완료: bucket={}, key={}, size={}bytes", bucket, key, size);
            return key;
        } catch (Exception e) {
            throw new StorageException("파일 업로드 실패: key=" + key, e);
        }
    }

    @Override
    public InputStream download(String key) {
        try {
            return minioClient.getObject(
                    GetObjectArgs.builder()
                            .bucket(bucket)
                            .object(key)
                            .build()
            );
        } catch (ErrorResponseException e) {
            if ("NoSuchKey".equals(e.errorResponse().code())) {
                throw new StorageException("파일이 존재하지 않습니다: key=" + key, e);
            }
            throw new StorageException("파일 다운로드 실패: key=" + key, e);
        } catch (Exception e) {
            throw new StorageException("파일 다운로드 실패: key=" + key, e);
        }
    }

    @Override
    public void delete(String key) {
        try {
            minioClient.removeObject(
                    RemoveObjectArgs.builder()
                            .bucket(bucket)
                            .object(key)
                            .build()
            );
            log.info("[Storage] 삭제 완료: bucket={}, key={}", bucket, key);
        } catch (ErrorResponseException e) {
            if ("NoSuchKey".equals(e.errorResponse().code())) {
                log.debug("[Storage] 삭제 대상 없음(무시): key={}", key);
                return;
            }
            log.warn("[Storage] 삭제 실패: key={}, error={}", key, e.getMessage());
        } catch (Exception e) {
            log.warn("[Storage] 삭제 실패: key={}, error={}", key, e.getMessage());
        }
    }

    @Override
    public boolean exists(String key) {
        try {
            minioClient.statObject(
                    StatObjectArgs.builder()
                            .bucket(bucket)
                            .object(key)
                            .build()
            );
            return true;
        } catch (ErrorResponseException e) {
            if ("NoSuchKey".equals(e.errorResponse().code())) {
                return false;
            }
            throw new StorageException("오브젝트 상태 조회 실패: key=" + key, e);
        } catch (Exception e) {
            throw new StorageException("오브젝트 상태 조회 실패: key=" + key, e);
        }
    }

    private void ensureBucketExists() throws Exception {
        boolean found = minioClient.bucketExists(
                BucketExistsArgs.builder().bucket(bucket).build()
        );
        if (!found) {
            minioClient.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
            log.info("[Storage] 버킷 생성: {}", bucket);
        }
    }
}
