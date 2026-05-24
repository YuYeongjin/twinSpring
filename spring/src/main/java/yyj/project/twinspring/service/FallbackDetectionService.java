package yyj.project.twinspring.service;

import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.*;

/**
 * Python Detect 서버 오프라인 시 Spring 단독으로 동작하는 기본 탐지 서비스.
 * YCbCr 피부색 + 헬멧 색상(노란/흰/파란/빨간) 분석을 사용하며,
 * YOLO 수준의 정확도는 아니지만 사람 존재 여부와 헬멧 착용 여부를 추정한다.
 */
@Service
public interface FallbackDetectionService {

    public List<Map<String, Object>> analyze(byte[] imageBytes);

    public List<Map<String, Object>> detectPersons(BufferedImage img);

    /** BFS flood fill — 인접 피부 셀 탐색, bounds 업데이트 */
    public int bfs(float[][] ratio, boolean[][] visited, int startX, int startY, int[] bounds) ;

    /** YCbCr 기반 피부색 판별 */
    public boolean isSkin(int r, int g, int b);

    /** 헬멧 색상 판별 — 노란/주황, 흰색, 파란색, 빨간색 */
    public boolean isHat(int r, int g, int b);

    public float[] rgbToHsv(int r, int g, int b);
}
