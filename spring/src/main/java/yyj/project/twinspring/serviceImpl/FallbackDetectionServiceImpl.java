package yyj.project.twinspring.serviceImpl;

import org.springframework.stereotype.Service;
import yyj.project.twinspring.service.FallbackDetectionService;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.*;

@Service
public class FallbackDetectionServiceImpl implements FallbackDetectionService {

    private static final int  GRID        = 10;   // 10×10 셀 격자
    private static final int  MAX_RESULTS = 4;    // 최대 탐지 수
    private static final float SKIN_THR   = 0.18f;
    private static final float HAT_THR    = 0.12f;

    @Override
    public List<Map<String, Object>> analyze(byte[] imageBytes) {
        try {
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(imageBytes));
            if (img == null) return List.of();
            return detectPersons(img);
        } catch (IOException e) {
            return List.of();
        }
    }
    @Override
    public List<Map<String, Object>> detectPersons(BufferedImage img) {
        int W = img.getWidth(), H = img.getHeight();
        if (W == 0 || H == 0) return List.of();

        int cellW = Math.max(W / GRID, 1);
        int cellH = Math.max(H / GRID, 1);

        float[][] skinRatio = new float[GRID][GRID];
        float[][] hatRatio  = new float[GRID][GRID];

        for (int gy = 0; gy < GRID; gy++) {
            for (int gx = 0; gx < GRID; gx++) {
                int x0 = gx * cellW, y0 = gy * cellH;
                int x1 = Math.min(x0 + cellW, W);
                int y1 = Math.min(y0 + cellH, H);
                int skinCnt = 0, hatCnt = 0, total = 0;

                for (int py = y0; py < y1; py++) {
                    for (int px = x0; px < x1; px++) {
                        int rgb = img.getRGB(px, py);
                        int r = (rgb >> 16) & 0xFF;
                        int g = (rgb >> 8)  & 0xFF;
                        int b =  rgb        & 0xFF;
                        if (isSkin(r, g, b)) skinCnt++;
                        if (isHat(r, g, b))  hatCnt++;
                        total++;
                    }
                }
                if (total > 0) {
                    skinRatio[gy][gx] = (float) skinCnt / total;
                    hatRatio[gy][gx]  = (float) hatCnt  / total;
                }
            }
        }

        boolean[][] visited = new boolean[GRID][GRID];
        List<Map<String, Object>> results = new ArrayList<>();

        for (int gy = 0; gy < GRID && results.size() < MAX_RESULTS; gy++) {
            for (int gx = 0; gx < GRID && results.size() < MAX_RESULTS; gx++) {
                if (skinRatio[gy][gx] >= SKIN_THR && !visited[gy][gx]) {
                    int[] bounds = {gx, gy, gx, gy};
                    int size = bfs(skinRatio, visited, gx, gy, bounds);
                    if (size < 2) continue;

                    // 피부 영역 바로 위 셀에서 헬멧 색 탐색
                    boolean hasHat = false;
                    outer:
                    for (int ty = Math.max(0, bounds[1] - 1); ty <= bounds[1]; ty++) {
                        for (int tx = bounds[0]; tx <= bounds[2]; tx++) {
                            if (hatRatio[ty][tx] >= HAT_THR) { hasHat = true; break outer; }
                        }
                    }

                    int bx1 = bounds[0] * cellW;
                    int by1 = Math.max(0, bounds[1] * cellH - cellH / 2); // 머리 공간 추가
                    int bx2 = Math.min((bounds[2] + 1) * cellW, W);
                    int by2 = Math.min((bounds[3] + 1) * cellH, H);

                    double conf = Math.round((0.25 + Math.min(size * 0.06, 0.45)) * 100.0) / 100.0;

                    Map<String, Object> det = new LinkedHashMap<>();
                    det.put("class",      hasHat ? "Person" : "no-hard-hat");
                    det.put("confidence", conf);
                    det.put("bbox",       List.of(bx1, by1, bx2, by2));
                    results.add(det);
                }
            }
        }
        return results;
    }

    /** BFS flood fill — 인접 피부 셀 탐색, bounds 업데이트 */
    @Override
    public int bfs(float[][] ratio, boolean[][] visited, int startX, int startY, int[] bounds) {
        Deque<int[]> queue = new ArrayDeque<>();
        queue.add(new int[]{startX, startY});
        visited[startY][startX] = true;
        int count = 0;
        int[][] dirs = {{1,0},{-1,0},{0,1},{0,-1}};
        while (!queue.isEmpty()) {
            int[] cur = queue.poll();
            int cx = cur[0], cy = cur[1];
            count++;
            bounds[0] = Math.min(bounds[0], cx);
            bounds[1] = Math.min(bounds[1], cy);
            bounds[2] = Math.max(bounds[2], cx);
            bounds[3] = Math.max(bounds[3], cy);
            for (int[] d : dirs) {
                int nx = cx + d[0], ny = cy + d[1];
                if (nx >= 0 && nx < GRID && ny >= 0 && ny < GRID
                        && !visited[ny][nx] && ratio[ny][nx] >= SKIN_THR) {
                    visited[ny][nx] = true;
                    queue.add(new int[]{nx, ny});
                }
            }
        }
        return count;
    }

    /** YCbCr 기반 피부색 판별 */
    @Override
    public boolean isSkin(int r, int g, int b) {
        double y  =  0.299 * r + 0.587 * g + 0.114 * b;
        double cb = -0.169 * r - 0.331 * g + 0.500 * b + 128;
        double cr =  0.500 * r - 0.419 * g - 0.081 * b + 128;
        return y > 50 && cb >= 80 && cb <= 120 && cr >= 135 && cr <= 175;
    }

    /** 헬멧 색상 판별 — 노란/주황, 흰색, 파란색, 빨간색 */
    @Override
    public boolean isHat(int r, int g, int b) {
        float[] hsv = rgbToHsv(r, g, b);
        float h = hsv[0], s = hsv[1], v = hsv[2];
        if (h >= 25 && h <= 70  && s > 0.40f && v > 0.45f) return true; // 노란/주황
        if (s < 0.15f && v > 0.82f)                         return true; // 흰색
        if (h >= 190 && h <= 255 && s > 0.35f && v > 0.30f) return true; // 파란색
        if ((h <= 10 || h >= 350) && s > 0.50f && v > 0.40f) return true; // 빨간색
        return false;
    }

    @Override
    public float[] rgbToHsv(int r, int g, int b) {
        float rf = r / 255f, gf = g / 255f, bf = b / 255f;
        float max = Math.max(rf, Math.max(gf, bf));
        float min = Math.min(rf, Math.min(gf, bf));
        float delta = max - min;
        float h = 0f, s = max == 0 ? 0 : delta / max;
        if (delta > 0) {
            if      (max == rf) h = 60f * (((gf - bf) / delta) % 6);
            else if (max == gf) h = 60f * ((bf - rf) / delta + 2);
            else                h = 60f * ((rf - gf) / delta + 4);
            if (h < 0) h += 360f;
        }
        return new float[]{h, s, max};
    }
}