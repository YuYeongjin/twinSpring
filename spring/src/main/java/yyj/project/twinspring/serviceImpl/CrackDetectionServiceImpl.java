package yyj.project.twinspring.serviceImpl;

import org.springframework.stereotype.Service;
import yyj.project.twinspring.service.CrackDetectionService;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.*;

/**
 * Spring 내장 균열 감지 폴백.
 *
 * 알고리즘:
 *  1. 그레이스케일 변환
 *  2. Sobel 엣지 강도 계산
 *  3. 어두운 픽셀(밝기 < DARK_THR) 연결 컴포넌트 분석 (BFS)
 *  4. 가로/세로 비율이 높거나 세로 방향으로 길쭉한 영역 → 균열 후보
 *  5. 엣지 밀도(전체 중 강한 엣지 비율) + 균열 후보 수로 confidence 계산
 */
@Service
public class CrackDetectionServiceImpl implements CrackDetectionService {

    private static final int   DARK_THR        = 55;   // 균열 픽셀 밝기 임계값
    private static final int   MIN_CRACK_LEN    = 18;   // 최소 균열 픽셀 수
    private static final double ASPECT_THR      = 3.5;  // 가로:세로 또는 세로:가로 비율 임계값
    private static final double EDGE_DENSITY_THR = 0.07; // 엣지 밀도 임계값 (7%)
    private static final int   SAMPLE_STEP     = 2;    // 샘플링 간격(속도 최적화)

    @Override
    public Map<String, Object> analyze(byte[] imageBytes) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("method", "spring_fallback");

        BufferedImage img;
        try {
            img = ImageIO.read(new ByteArrayInputStream(imageBytes));
            if (img == null) throw new IllegalArgumentException("이미지 파싱 실패");
        } catch (Exception e) {
            result.put("hasCrack", false);
            result.put("confidence", 0.0);
            result.put("detail", "image parse error: " + e.getMessage());
            return result;
        }

        int w = img.getWidth();
        int h = img.getHeight();

        // ── 1. 그레이스케일 + Sobel 엣지 ─────────────────────────────
        int sw = w / SAMPLE_STEP;
        int sh = h / SAMPLE_STEP;
        int[][] gray = new int[sh][sw];

        for (int y = 0; y < sh; y++) {
            for (int x = 0; x < sw; x++) {
                int rgb = img.getRGB(x * SAMPLE_STEP, y * SAMPLE_STEP);
                int r = (rgb >> 16) & 0xFF;
                int g = (rgb >> 8)  & 0xFF;
                int b =  rgb        & 0xFF;
                gray[y][x] = (int)(0.299 * r + 0.587 * g + 0.114 * b);
            }
        }

        // Sobel 엣지 강도
        long strongEdges = 0;
        long totalPixels = (long)(sw - 2) * (sh - 2);
        int edgeThr = 80;

        for (int y = 1; y < sh - 1; y++) {
            for (int x = 1; x < sw - 1; x++) {
                int gx = -gray[y-1][x-1] + gray[y-1][x+1]
                         - 2*gray[y][x-1]  + 2*gray[y][x+1]
                         - gray[y+1][x-1] + gray[y+1][x+1];
                int gy = -gray[y-1][x-1] - 2*gray[y-1][x] - gray[y-1][x+1]
                         + gray[y+1][x-1] + 2*gray[y+1][x] + gray[y+1][x+1];
                int mag = (int) Math.sqrt(gx * gx + gy * gy);
                if (mag > edgeThr) strongEdges++;
            }
        }
        double edgeDensity = totalPixels > 0 ? (double) strongEdges / totalPixels : 0;

        // ── 2. 어두운 픽셀 연결 컴포넌트 분석 ─────────────────────────
        boolean[][] dark = new boolean[sh][sw];
        for (int y = 0; y < sh; y++)
            for (int x = 0; x < sw; x++)
                dark[y][x] = gray[y][x] < DARK_THR;

        boolean[][] visited = new boolean[sh][sw];
        int crackCandidates = 0;
        List<Map<String, Object>> regions = new ArrayList<>();

        for (int y = 0; y < sh; y++) {
            for (int x = 0; x < sw; x++) {
                if (!dark[y][x] || visited[y][x]) continue;

                // BFS
                int minX = x, maxX = x, minY = y, maxY = y;
                int size = 0;
                Queue<int[]> queue = new ArrayDeque<>();
                queue.add(new int[]{x, y});
                visited[y][x] = true;

                while (!queue.isEmpty()) {
                    int[] p = queue.poll();
                    int px = p[0], py = p[1];
                    size++;
                    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
                    minY = Math.min(minY, py); maxY = Math.max(maxY, py);

                    int[][] dirs = {{1,0},{-1,0},{0,1},{0,-1}};
                    for (int[] d : dirs) {
                        int nx = px + d[0], ny = py + d[1];
                        if (nx >= 0 && nx < sw && ny >= 0 && ny < sh
                            && dark[ny][nx] && !visited[ny][nx]) {
                            visited[ny][nx] = true;
                            queue.add(new int[]{nx, ny});
                        }
                    }
                }

                if (size < MIN_CRACK_LEN) continue;

                int bboxW = maxX - minX + 1;
                int bboxH = maxY - minY + 1;
                double aspect = bboxW > 0 && bboxH > 0
                    ? (double) Math.max(bboxW, bboxH) / Math.min(bboxW, bboxH)
                    : 1;

                if (aspect >= ASPECT_THR) {
                    crackCandidates++;
                    // 원본 이미지 좌표로 스케일 복원
                    Map<String, Object> region = new LinkedHashMap<>();
                    region.put("x1", minX * SAMPLE_STEP);
                    region.put("y1", minY * SAMPLE_STEP);
                    region.put("x2", maxX * SAMPLE_STEP);
                    region.put("y2", maxY * SAMPLE_STEP);
                    regions.add(region);
                }
            }
        }

        // ── 3. 판정 ────────────────────────────────────────────────────
        double confidence = 0.0;
        if (crackCandidates >= 3) confidence += 0.5;
        else if (crackCandidates >= 1) confidence += 0.3;

        if (edgeDensity >= EDGE_DENSITY_THR * 2) confidence += 0.3;
        else if (edgeDensity >= EDGE_DENSITY_THR) confidence += 0.15;

        confidence = Math.min(confidence, 0.95);

        boolean hasCrack = crackCandidates >= 1 && edgeDensity >= EDGE_DENSITY_THR;

        result.put("hasCrack",    hasCrack);
        result.put("confidence",  Math.round(confidence * 100.0) / 100.0);
        result.put("detail", String.format(
            "crackRegions=%d, edgeDensity=%.3f, imageSize=%dx%d",
            crackCandidates, edgeDensity, w, h));
        result.put("regions",     regions);

        return result;
    }
}
