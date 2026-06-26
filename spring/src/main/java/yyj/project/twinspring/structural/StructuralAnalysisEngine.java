package yyj.project.twinspring.structural;

import yyj.project.twinspring.dto.BimElementDTO;
import yyj.project.twinspring.dto.StructuralAnalysisRequestDTO;
import yyj.project.twinspring.dto.StructuralAnalysisResultDTO;

import java.util.*;

/**
 * 3D 프레임 직접강성법 (Direct Stiffness Method) 구조해석 엔진.
 *
 * 좌표계: X = East, Y = North, Z = Up  (BIM Z-up 체계 그대로)
 * 자유도: 노드당 6 DOF [u_x, u_y, u_z, θ_x, θ_y, θ_z]
 * 부재당 12 DOF, 12×12 국부 강성 행렬.
 * 3D 변환 행렬로 전체 좌표계 조립.
 * 외부 라이브러리 없이 Partial-Pivoting Gaussian Elimination.
 * 대상: IfcColumn / IfcBeam / IfcMember / IfcPier
 */
public class StructuralAnalysisEngine {

    // ── 재료 물성 ──────────────────────────────────────────────────────
    private static final double E_CONCRETE  = 27_000.0;   // MPa
    private static final double E_STEEL     = 200_000.0;  // MPa
    private static final double E_TIMBER    =  11_000.0;  // MPa
    private static final double NU_CONCRETE = 0.20;
    private static final double NU_STEEL    = 0.30;
    private static final double F_CK        = 24.0;       // MPa 콘크리트 기준강도
    private static final double F_Y         = 235.0;      // MPa 강재 항복강도 S235

    private static final int    NDOF = 6;                 // DOF per node

    // 소문자 prefix 매칭 — IfcColumnStandardCase, IFCBEAM 등 변형 타입 포함
    private static final Set<String> STRUCTURAL_PREFIXES = Set.of(
            "ifccolumn","ifcbeam","ifcmember","ifcpier",
            "ifcwall","ifcslab","ifcfooting","ifcplate"
    );

    // ── 내부 모델 ──────────────────────────────────────────────────────

    private record Node(int id, double x, double y, double z) {}

    private static class Member {
        String   elementId, elementType;
        int      n1, n2;
        double   L;                // 부재 길이 (m)
        double   E, G;             // 탄성계수, 전단탄성계수 (kN/m²)
        double   A;                // 단면적 (m²)
        double   Iy, Iz;           // 단면2차모멘트 (m⁴) — y축, z축 주위
        double   J;                // Saint-Venant 비틀림 상수 (m⁴)
        double[] e1 = new double[3]; // local x (부재 축 방향)
        double[] e2 = new double[3]; // local y (약축 방향)
        double[] e3 = new double[3]; // local z (강축 방향)
        // 단면 치수 (응력 계산용)
        double   cz, cy;           // 강축/약축 중립면에서 극단 거리 (m)
    }

    // ── 공개 API ───────────────────────────────────────────────────────

    // 지진구역 → 스펙트럴 가속도 (g) 매핑  [zone 0 미사용, 1~4]
    private static final double[] ZONE_SDS = {0.0, 0.08, 0.154, 0.22, 0.32};

    public StructuralAnalysisResultDTO analyze(
            List<BimElementDTO> elements,
            Map<String, Map<String, Double>> varMap,
            StructuralAnalysisRequestDTO req) {

        String codeStandard  = req != null ? req.getCodeStandard()  : "KDS";
        String structureType = req != null ? req.getStructureType() : "BUILDING";

        List<BimElementDTO> structural = elements.stream()
                .filter(e -> {
                    if (e.getElementType() == null) return false;
                    String t = e.getElementType().toLowerCase().trim();
                    return STRUCTURAL_PREFIXES.stream().anyMatch(t::startsWith);
                })
                .toList();

        StructuralAnalysisResultDTO result = new StructuralAnalysisResultDTO();
        result.setCodeStandard(codeStandard);
        result.setStructureType(structureType);

        if (structural.isEmpty()) {
            result.setMembers(Collections.emptyList());
            result.setAppliedLoads(Map.of());
            result.setSummary(emptySummary());
            return result;
        }

        // 1. 노드/부재 토폴로지 구성
        Map<String, Integer> nodeIndex = new LinkedHashMap<>();
        List<Node>    nodes   = new ArrayList<>();
        List<Member>  members = new ArrayList<>();
        buildTopology(structural, nodeIndex, nodes, members);

        int nNodes   = nodes.size();
        int totalDof = nNodes * NDOF;

        // 2. 하중 계산 (사용자 파라미터 우선)
        LoadResult loads = computeLoads(structural, varMap, req);

        // 3. 전체 강성 행렬 조립
        double[][] K = new double[totalDof][totalDof];
        for (Member m : members) {
            double[][] ke = localStiffness12(m);
            double[][] T  = buildTransformation12(m);
            double[][] Ke = transformStiffness(ke, T);
            assembleGlobal(K, Ke, m.n1, m.n2);
        }

        // 4. 하중 벡터
        double[] F = buildLoadVector(nodes, members, structural, loads, nNodes);

        // 5. 경계 조건 (지반 절점 6-DOF 고정)
        List<Integer> fixed = identifyFixedDof(nodes);
        applyBoundaryConditions(K, F, fixed);

        // 6. Gaussian Elimination → 변위
        double[] U = gaussElimination(K, F);

        // 7. 부재력 → 응력 → 안전 판정
        List<StructuralAnalysisResultDTO.MemberResult> results = new ArrayList<>();
        for (int i = 0; i < members.size(); i++) {
            results.add(checkMember(members.get(i), U, varMap, codeStandard, structureType));
        }

        result.setMembers(results);
        result.setAppliedLoads(loads.toMap());
        result.setSummary(buildSummary(results, loads));
        return result;
    }

    // ── 토폴로지 구성 ──────────────────────────────────────────────────

    private void buildTopology(List<BimElementDTO> elements,
                                Map<String, Integer> nodeIndex,
                                List<Node>   nodes,
                                List<Member> members) {
        int nIdx = 0;

        for (BimElementDTO e : elements) {
            double px = safe(e.getPositionX(), 0.0);
            double py = safe(e.getPositionY(), 0.0);
            double pz = safe(e.getPositionZ(), 0.0);
            double sx = safe(e.getSizeX(), 0.3);
            double sy = safe(e.getSizeY(), 0.3);
            double sz = safe(e.getSizeZ(), 3.0);

            // 부재 방향 결정 (가장 긴 치수 = 부재 축)
            double x1, y1, z1, x2, y2, z2;
            double bw, bh; // 단면 폭, 높이

            if (sz >= sx * 1.1 && sz >= sy * 1.1) {
                // 수직 기둥 (Z축 방향)
                x1 = px; y1 = py; z1 = pz;
                x2 = px; y2 = py; z2 = pz + sz;
                bw = Math.min(sx, sy); bh = Math.max(sx, sy);
            } else if (sx >= sy) {
                // X 방향 보
                x1 = px; y1 = py; z1 = pz;
                x2 = px + sx; y2 = py; z2 = pz;
                bw = sy; bh = sz;
            } else {
                // Y 방향 보
                x1 = px; y1 = py; z1 = pz;
                x2 = px; y2 = py + sy; z2 = pz;
                bw = sx; bh = sz;
            }

            String k1 = nk(x1, y1, z1), k2 = nk(x2, y2, z2);
            if (!nodeIndex.containsKey(k1)) { nodeIndex.put(k1, nIdx); nodes.add(new Node(nIdx++, x1, y1, z1)); }
            if (!nodeIndex.containsKey(k2)) { nodeIndex.put(k2, nIdx); nodes.add(new Node(nIdx++, x2, y2, z2)); }

            int i1 = nodeIndex.get(k1), i2 = nodeIndex.get(k2);
            Node n1 = nodes.get(i1),     n2 = nodes.get(i2);

            double L = Math.max(dist3(n1, n2), 1e-6);

            double E  = elasticity(e.getMaterial());
            double nu = isSteel(e.getMaterial()) ? NU_STEEL : NU_CONCRETE;
            double G  = E / (2 * (1 + nu));

            // 단면 특성 (직사각형 단면 가정, 강축 = h방향)
            double b = Math.min(bw, bh);
            double h = Math.max(bw, bh);
            double A  = b * h;
            double Iz = b * h * h * h / 12.0; // 강축 (중력 방향 휨)
            double Iy = h * b * b * b / 12.0; // 약축
            double J  = torsionJ(b, h);         // Saint-Venant

            Member mem = new Member();
            mem.elementId   = e.getElementId();
            mem.elementType = e.getElementType();
            mem.n1 = i1; mem.n2 = i2;
            mem.L  = L;
            mem.E  = E * 1000.0; // MPa → kN/m²
            mem.G  = G * 1000.0;
            mem.A  = A; mem.Iy = Iy; mem.Iz = Iz; mem.J = J;
            mem.cz = h / 2.0;   // 강축 극단 거리
            mem.cy = b / 2.0;   // 약축 극단 거리

            computeLocalAxes(mem, n1, n2, L);
            members.add(mem);
        }
    }

    private void computeLocalAxes(Member mem, Node n1, Node n2, double L) {
        // local x: 부재 방향 단위벡터
        double[] ex = {(n2.x()-n1.x())/L, (n2.y()-n1.y())/L, (n2.z()-n1.z())/L};

        // 기준 벡터 선택 (부재와 거의 평행하면 교체)
        double[] ref = (Math.abs(ex[2]) < 0.9)
                ? new double[]{0, 0, 1}   // 비수직 부재 → global Z
                : new double[]{1, 0, 0};  // 수직 기둥   → global X

        // local z = ex × ref  (강축 방향, 중력 하중 평면에 수직)
        double[] ez = cross(ex, ref);
        double ez_n = norm(ez);
        if (ez_n < 1e-10) ez = new double[]{0, 1, 0};
        else              scale_ip(ez, 1.0 / norm(ez));

        // local y = ez × ex  (우수좌표계 완성)
        double[] ey = cross(ez, ex);
        scale_ip(ey, 1.0 / norm(ey));

        mem.e1 = ex; mem.e2 = ey; mem.e3 = ez;
    }

    // ── 12×12 국부 강성 행렬 (3D Euler-Bernoulli) ─────────────────────

    private double[][] localStiffness12(Member m) {
        double E = m.E, G = m.G;
        double A = m.A, Iy = m.Iy, Iz = m.Iz, J = m.J, L = m.L;

        double EAL   = E * A / L;
        double GJL   = G * J / L;

        // y축 주위 휨 (x-z 평면)
        double Ay1   = 12 * E * Iy / (L * L * L);
        double Ay2   =  6 * E * Iy / (L * L);
        double Ay3   =  4 * E * Iy / L;
        double Ay4   =  2 * E * Iy / L;

        // z축 주위 휨 (x-y 평면)
        double Az1   = 12 * E * Iz / (L * L * L);
        double Az2   =  6 * E * Iz / (L * L);
        double Az3   =  4 * E * Iz / L;
        double Az4   =  2 * E * Iz / L;

        double[][] k = new double[12][12];

        // ── 축력 (DOF 0, 6) ──
        k[0][0]  =  EAL; k[0][6]  = -EAL;
        k[6][0]  = -EAL; k[6][6]  =  EAL;

        // ── 비틀림 (DOF 3, 9) ──
        k[3][3]  =  GJL; k[3][9]  = -GJL;
        k[9][3]  = -GJL; k[9][9]  =  GJL;

        // ── z축 주위 휨 (v: DOF 1,7; θz: DOF 5,11) ──
        k[1][1]  =  Az1; k[1][5]  =  Az2; k[1][7]  = -Az1; k[1][11] =  Az2;
        k[5][1]  =  Az2; k[5][5]  =  Az3; k[5][7]  = -Az2; k[5][11] =  Az4;
        k[7][1]  = -Az1; k[7][5]  = -Az2; k[7][7]  =  Az1; k[7][11] = -Az2;
        k[11][1] =  Az2; k[11][5] =  Az4; k[11][7] = -Az2; k[11][11]=  Az3;

        // ── y축 주위 휨 (w: DOF 2,8; θy: DOF 4,10) ──
        // 주의: θy 부호 반전 (우수계 규약)
        k[2][2]  =  Ay1; k[2][4]  = -Ay2; k[2][8]  = -Ay1; k[2][10] = -Ay2;
        k[4][2]  = -Ay2; k[4][4]  =  Ay3; k[4][8]  =  Ay2; k[4][10] =  Ay4;
        k[8][2]  = -Ay1; k[8][4]  =  Ay2; k[8][8]  =  Ay1; k[8][10] =  Ay2;
        k[10][2] = -Ay2; k[10][4] =  Ay4; k[10][8] =  Ay2; k[10][10]=  Ay3;

        return k;
    }

    // ── 12×12 변환 행렬 T (local → global) ─────────────────────────────

    private double[][] buildTransformation12(Member mem) {
        // R (3×3): 행 = local 축의 global 성분
        double[][] R = {{mem.e1[0],mem.e1[1],mem.e1[2]},
                        {mem.e2[0],mem.e2[1],mem.e2[2]},
                        {mem.e3[0],mem.e3[1],mem.e3[2]}};

        double[][] T = new double[12][12];
        for (int b = 0; b < 4; b++) {
            for (int i = 0; i < 3; i++) {
                for (int j = 0; j < 3; j++) {
                    T[b*3+i][b*3+j] = R[i][j];
                }
            }
        }
        return T;
    }

    // Ke = Tᵀ · ke · T
    private double[][] transformStiffness(double[][] ke, double[][] T) {
        double[][] Tt  = transpose(T);
        double[][] tmp = multiply(Tt, ke);
        return multiply(tmp, T);
    }

    // 전체 강성 조립
    private void assembleGlobal(double[][] K, double[][] Ke, int n1, int n2) {
        int[] d = new int[12];
        for (int i = 0; i < 6; i++) { d[i] = n1*6+i; d[i+6] = n2*6+i; }
        for (int i = 0; i < 12; i++)
            for (int j = 0; j < 12; j++)
                K[d[i]][d[j]] += Ke[i][j];
    }

    // ── 하중 벡터 ─────────────────────────────────────────────────────

    private double[] buildLoadVector(List<Node> nodes, List<Member> members,
                                     List<BimElementDTO> elements,
                                     LoadResult loads, int nNodes) {
        double[] F = new double[nNodes * 6];
        if (nNodes == 0) return F;

        // 중력 (−Z), 풍 (+X), 지진 (100%X + 30%Y 조합)
        double gravPerNode  = -(loads.totalDeadLoad() + loads.totalLiveLoad()) / nNodes;
        double windPerNode  =  loads.totalWindLoad()    / nNodes;
        double seisXPerNode =  loads.totalSeismicForce() * 1.0 / nNodes;
        double seisYPerNode =  loads.totalSeismicForce() * 0.3 / nNodes;

        for (int i = 0; i < nNodes; i++) {
            F[i*6 + 0] += windPerNode + seisXPerNode; // X
            F[i*6 + 1] += seisYPerNode;               // Y
            F[i*6 + 2] += gravPerNode;                 // Z (하향)
        }
        return F;
    }

    // 지반 절점 식별 (최저 Z 레벨)
    private List<Integer> identifyFixedDof(List<Node> nodes) {
        double minZ = nodes.stream().mapToDouble(Node::z).min().orElse(0);
        List<Integer> fixed = new ArrayList<>();
        for (Node n : nodes) {
            if (Math.abs(n.z() - minZ) < 0.5) {
                for (int d = 0; d < 6; d++) fixed.add(n.id()*6 + d);
            }
        }
        return fixed;
    }

    // 페널티법 경계 조건
    private void applyBoundaryConditions(double[][] K, double[] F, List<Integer> fixed) {
        double P = 1e15;
        for (int d : fixed) {
            for (int j = 0; j < K[d].length; j++) K[d][j] = 0;
            for (int i = 0; i < K.length;    i++) K[i][d] = 0;
            K[d][d] = P; F[d] = 0;
        }
    }

    // ── Gaussian Elimination (부분 피벗팅) ────────────────────────────

    private double[] gaussElimination(double[][] A, double[] b) {
        int n = b.length;
        double[][] aug = new double[n][n + 1];
        for (int i = 0; i < n; i++) {
            System.arraycopy(A[i], 0, aug[i], 0, n);
            aug[i][n] = b[i];
        }
        for (int col = 0; col < n; col++) {
            int pivot = col;
            for (int row = col+1; row < n; row++)
                if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row;
            double[] tmp = aug[col]; aug[col] = aug[pivot]; aug[pivot] = tmp;

            if (Math.abs(aug[col][col]) < 1e-14) continue;
            for (int row = col+1; row < n; row++) {
                double f = aug[row][col] / aug[col][col];
                for (int k = col; k <= n; k++) aug[row][k] -= f * aug[col][k];
            }
        }
        double[] x = new double[n];
        for (int i = n-1; i >= 0; i--) {
            if (Math.abs(aug[i][i]) < 1e-14) continue;
            x[i] = aug[i][n];
            for (int j = i+1; j < n; j++) x[i] -= aug[i][j] * x[j];
            x[i] /= aug[i][i];
        }
        return x;
    }

    // ── 부재력 → 응력 → 안전율 ───────────────────────────────────────

    private StructuralAnalysisResultDTO.MemberResult checkMember(
            Member m, double[] U,
            Map<String, Map<String, Double>> varMap,
            String std, String structType) {

        // 절점 변위 추출 (12 DOF)
        double[] u = new double[12];
        for (int i = 0; i < 6; i++) {
            int d1 = m.n1*6+i, d2 = m.n2*6+i;
            u[i]   = (U != null && d1 < U.length) ? U[d1] : 0;
            u[i+6] = (U != null && d2 < U.length) ? U[d2] : 0;
        }

        // local 변위 = T · u_global
        double[][] T  = buildTransformation12(m);
        double[]   ul = multiplyVec(T, u);

        // 부재력 (local) = ke · ul
        double[][] ke = localStiffness12(m);
        double[]   fl = multiplyVec(ke, ul);

        // 단부 힘 추출
        double N      = -fl[0];                                       // 축력 (kN, +압축)
        double Vy     = fl[1];                                        // 전단 y (kN)
        double Vz     = fl[2];                                        // 전단 z (kN)
        double Tx     = fl[3];                                        // 비틀림 (kN·m)
        double My_max = Math.max(Math.abs(fl[4]),  Math.abs(fl[10]));// y축 모멘트 최대 (kN·m)
        double Mz_max = Math.max(Math.abs(fl[5]),  Math.abs(fl[11]));// z축 모멘트 최대 (kN·m)
        double V_res  = Math.sqrt(Vy*Vy + Vz*Vz);                   // 합성 전단력

        // 단면 물성
        double A  = m.A, Iy = m.Iy, Iz = m.Iz;
        double cz = m.cz, cy = m.cy;                                 // 극단 거리

        // MPa 환산 (kN, m → kN/m² = kPa, ÷1000 → MPa)
        double eps = 1e-12;
        double sigmaN  = N      / Math.max(A,  eps) / 1000.0;       // 축응력
        double sigmaBy = My_max * cz / Math.max(Iz, eps) / 1000.0; // 강축 휨응력
        double sigmaBz = Mz_max * cy / Math.max(Iy, eps) / 1000.0; // 약축 휨응력
        double tauV    = 1.5 * V_res / Math.max(A, eps) / 1000.0;  // 전단응력
        double tauT    = Tx * Math.max(cz, cy)
                         / Math.max(2*Iy*Iz/(Iy+Iz), eps) / 1000.0;// 비틀림 응력 (근사)

        // 조합응력 (선형 상관 관계식)
        double sigmaComb = Math.abs(sigmaN) + sigmaBy + sigmaBz;    // 복합 수직응력
        double tauComb   = Math.sqrt(tauV*tauV + tauT*tauT);        // 복합 전단응력

        // ── 안전 판정 ──────────────────────────────────────────────────
        var r = new StructuralAnalysisResultDTO.MemberResult();
        r.setElementId(m.elementId);
        r.setElementType(m.elementType);
        r.setAxialForce(r2(N));
        r.setShearForce(r2(V_res));
        r.setBendingMoment(r2(Math.max(My_max, Mz_max)));
        r.setNormalStress(r2(sigmaComb));
        r.setShearStress(r2(tauComb));

        boolean steel = (m.E > 100_000_000); // 강재: E > 100 GPa (kN/m² 단위)

        if ("KDS".equals(std)) {
            double sfSafe = varVal(varMap, "KDS_BLDG_SAFETY", "SF_safe", 2.0);
            double sfWarn = varVal(varMap, "KDS_BLDG_SAFETY", "SF_warn", 1.0);
            double fAllow = steel ? F_Y / sfSafe : F_CK / sfSafe;
            double fAllowV= steel ? F_Y / (Math.sqrt(3.0) * sfSafe)
                                  : 0.4 * Math.sqrt(F_CK);

            double ratio = (sigmaComb / Math.max(fAllow,  eps))
                         + (tauComb   / Math.max(fAllowV, eps));

            double sf = ratio > 1e-9 ? 1.0 / ratio : 999.0;
            String status = sf >= sfSafe ? "Safe" : sf >= sfWarn ? "Warning" : "Danger";

            r.setAllowStress(r2(fAllow));
            r.setSafetyFactor(r2(sf));
            r.setUtilization(r2(ratio));
            r.setStatus(status);

            if (!"Safe".equals(status)) {
                String dom = dominantType(Math.abs(sigmaN), sigmaBy, sigmaBz, tauComb);
                r.setDominantStressType(dom);
                r.setFailureReason(buildReason(dom, Math.abs(sigmaN), sigmaBy, sigmaBz, tauComb, fAllow, fAllowV, status));
                r.setRemediation(buildRemediation(dom, m.elementType, status));
            }

        } else {
            double uSafe = varVal(varMap, "EC2_BLDG_SAFETY", "U_safe", 0.7);
            double uWarn = varVal(varMap, "EC2_BLDG_SAFETY", "U_warn", 1.0);
            double gammaC = steel ? 1.0 : 1.5;
            double fRd    = steel ? F_Y : F_CK / gammaC;
            double fRdV   = steel ? F_Y / Math.sqrt(3.0)
                                  : 0.6 * (1 - F_CK / 250.0) * F_CK / gammaC;

            double utilN = sigmaComb / Math.max(fRd,  eps);
            double utilV = tauComb   / Math.max(fRdV, eps);
            double util  = Math.max(utilN, utilV);

            String status = util <= uSafe ? "Safe" : util <= uWarn ? "Warning" : "Danger";
            r.setAllowStress(r2(fRd));
            r.setSafetyFactor(r2(fRd / Math.max(sigmaComb, eps)));
            r.setUtilization(r2(util));
            r.setStatus(status);

            if (!"Safe".equals(status)) {
                String dom = dominantType(Math.abs(sigmaN), sigmaBy, sigmaBz, tauComb);
                r.setDominantStressType(dom);
                r.setFailureReason(buildReason(dom, Math.abs(sigmaN), sigmaBy, sigmaBz, tauComb, fRd, fRdV, status));
                r.setRemediation(buildRemediation(dom, m.elementType, status));
            }
        }

        return r;
    }

    // ── 하중 계산 ─────────────────────────────────────────────────────

    private record LoadResult(
            double totalDeadLoad, double totalLiveLoad,
            double totalWindLoad, double totalSeismicForce,
            double governingCombo
    ) {
        Map<String, Double> toMap() {
            var m = new LinkedHashMap<String, Double>();
            m.put("deadLoad",      totalDeadLoad);
            m.put("liveLoad",      totalLiveLoad);
            m.put("windLoad",      totalWindLoad);
            m.put("seismicForce",  totalSeismicForce);
            m.put("governingCombo",governingCombo);
            return m;
        }
    }

    private LoadResult computeLoads(List<BimElementDTO> members,
                                     Map<String, Map<String, Double>> varMap,
                                     StructuralAnalysisRequestDTO req) {
        String std   = req.getCodeStandard();
        String sType = req.getStructureType();

        // 구조 자중 (kN)
        double selfWeight = 0;
        for (var e : members) {
            double gamma = density(e.getMaterial());
            double vol   = safe(e.getSizeX(),0.3) * safe(e.getSizeY(),0.3) * safe(e.getSizeZ(),3.0);
            selfWeight += gamma * vol;
        }

        // 사용자 입력 하중: 슈퍼임포즈드 고정 + 적설 (지배면적 × 층수)
        double trib     = Math.max(req.getTributaryArea(), 1.0);
        int    floors   = Math.max(req.getNumFloors(), 1);
        double dead     = selfWeight
                        + req.getDeadLoad() * trib * floors   // 마감재 등 고정하중
                        + req.getSnowLoad() * estFloorArea(members); // 적설 (지붕)

        // 활하중 (kN)
        double live     = req.getLiveLoad() * trib * floors;

        // 풍하중 (kN) — 사용자 풍속 사용
        double wind     = computeWind(members, varMap, req);

        // 지진력 (kN) — 사용자 지진구역 사용
        double seismic  = computeSeismic(dead + live, varMap, req);

        // 지배 하중 조합 (KDS LRFD)
        double[] combos = {
            1.4 * dead,
            1.2 * dead + 1.6 * live,
            1.2 * dead + 1.0 * wind    + live,
            1.2 * dead + 1.0 * seismic + live,
            0.9 * dead + 1.0 * wind,
        };
        int govIdx = 0;
        for (int i = 1; i < combos.length; i++)
            if (combos[i] > combos[govIdx]) govIdx = i;

        return new LoadResult(dead, live, wind, seismic, govIdx + 1);
    }

    private double computeWind(List<BimElementDTO> members,
                                Map<String, Map<String, Double>> varMap,
                                StructuralAnalysisRequestDTO req) {
        String std   = req.getCodeStandard();
        String sType = req.getStructureType();
        String fid = std.equals("KDS")
                ? (sType.equals("BRIDGE") ? "KDS_BRDG_WIND" : "KDS_BLDG_WIND")
                : (sType.equals("BRIDGE") ? "EC2_BRDG_WIND" : "EC2_BLDG_WIND");
        double expArea = estExpArea(members);
        double Cf = varVal(varMap, fid, "Cf", 1.3);

        // 사용자 설계풍속 우선 적용 (0이면 formula DB fallback)
        if (std.equals("KDS")) {
            double V0  = req.getWindSpeed() > 0 ? req.getWindSpeed()
                                                : varVal(varMap, fid, "V0",  30.0);
            double Kd  = varVal(varMap, fid, "Kd",  0.85);
            double Kzt = varVal(varMap, fid, "Kzt", 1.0);
            double G   = varVal(varMap, fid, "G",   1.5);
            return 0.6125 * V0*V0 / 1000.0 * Kd * Kzt * Cf * G * expArea;
        } else {
            double vb  = req.getWindSpeed() > 0 ? req.getWindSpeed()
                                                : varVal(varMap, fid, "vb", 28.0);
            double rho = varVal(varMap, fid, "rho", 1.25);
            double Ce  = varVal(varMap, fid, "Ce",  2.5);
            return 0.5 * rho * vb*vb / 1000.0 * Ce * Cf * expArea;
        }
    }

    private double computeSeismic(double W,
                                   Map<String, Map<String, Double>> varMap,
                                   StructuralAnalysisRequestDTO req) {
        String std   = req.getCodeStandard();
        String sType = req.getStructureType();

        if (sType.equals("BRIDGE")) return W * 0.05;

        // 지진구역 → 스펙트럴 가속도 (사용자 입력 우선, fallback: formula DB)
        int zone = Math.max(1, Math.min(4, req.getSeismicZone()));

        if (std.equals("KDS")) {
            double SDS = ZONE_SDS[zone] > 0 ? ZONE_SDS[zone]
                                            : varVal(varMap, "KDS_BLDG_SEISMIC", "SDS", 0.22);
            double R   = varVal(varMap, "KDS_BLDG_SEISMIC", "R",  5.0);
            double Ie  = varVal(varMap, "KDS_BLDG_SEISMIC", "Ie", 1.0);
            double Cs  = Math.max(Math.min(SDS / (R / Ie), 0.5), 0.01);
            return Cs * W;
        } else {
            double ag  = ZONE_SDS[zone] > 0 ? ZONE_SDS[zone]
                                            : varVal(varMap, "EC2_BLDG_SEISMIC", "ag", 0.1);
            double S   = varVal(varMap, "EC2_BLDG_SEISMIC", "S",       1.5);
            double q   = varVal(varMap, "EC2_BLDG_SEISMIC", "q_f",     3.9);
            double lam = varVal(varMap, "EC2_BLDG_SEISMIC", "lambda_s", 0.85);
            return ag * S * 2.5 / q * W * lam;
        }
    }

    // ── 요약 ──────────────────────────────────────────────────────────

    private StructuralAnalysisResultDTO.Summary buildSummary(
            List<StructuralAnalysisResultDTO.MemberResult> results, LoadResult loads) {
        var s = new StructuralAnalysisResultDTO.Summary();
        s.setTotalMembers(results.size());
        s.setSafeCount   ((int) results.stream().filter(r -> "Safe"   .equals(r.getStatus())).count());
        s.setWarningCount((int) results.stream().filter(r -> "Warning".equals(r.getStatus())).count());
        s.setDangerCount ((int) results.stream().filter(r -> "Danger" .equals(r.getStatus())).count());
        s.setMaxUtilization(results.stream().mapToDouble(r -> r.getUtilization() != null ? r.getUtilization() : 0).max().orElse(0));
        s.setTotalDeadLoad(r2(loads.totalDeadLoad()));
        s.setTotalLiveLoad(r2(loads.totalLiveLoad()));
        s.setTotalWindLoad(r2(loads.totalWindLoad()));
        s.setTotalSeismicForce(r2(loads.totalSeismicForce()));
        s.setGoverningCombo(loads.governingCombo());
        return s;
    }

    private StructuralAnalysisResultDTO.Summary emptySummary() {
        var s = new StructuralAnalysisResultDTO.Summary();
        s.setTotalMembers(0); s.setSafeCount(0); s.setWarningCount(0); s.setDangerCount(0);
        s.setMaxUtilization(0.0);
        s.setTotalDeadLoad(0.0); s.setTotalLiveLoad(0.0);
        s.setTotalWindLoad(0.0); s.setTotalSeismicForce(0.0);
        s.setGoverningCombo(0.0);
        return s;
    }

    // ── 수학 유틸 ─────────────────────────────────────────────────────

    private double[][] transpose(double[][] A) {
        int m = A.length, n = A[0].length;
        double[][] T = new double[n][m];
        for (int i = 0; i < m; i++) for (int j = 0; j < n; j++) T[j][i] = A[i][j];
        return T;
    }

    private double[][] multiply(double[][] A, double[][] B) {
        int m = A.length, p = A[0].length, n = B[0].length;
        double[][] C = new double[m][n];
        for (int i = 0; i < m; i++)
            for (int k = 0; k < p; k++) if (A[i][k] != 0)
                for (int j = 0; j < n; j++) C[i][j] += A[i][k] * B[k][j];
        return C;
    }

    private double[] multiplyVec(double[][] A, double[] v) {
        int m = A.length, n = v.length;
        double[] r = new double[m];
        for (int i = 0; i < m; i++)
            for (int j = 0; j < n && j < A[i].length; j++) r[i] += A[i][j] * v[j];
        return r;
    }

    private double[] cross(double[] a, double[] b) {
        return new double[]{a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]};
    }

    private double norm(double[] v) {
        return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    }

    private void scale_ip(double[] v, double s) { v[0]*=s; v[1]*=s; v[2]*=s; }

    private double dist3(Node a, Node b) {
        return Math.sqrt(sq(b.x()-a.x()) + sq(b.y()-a.y()) + sq(b.z()-a.z()));
    }

    private double sq(double x) { return x * x; }
    private double r2(double v) { return Math.round(v * 100.0) / 100.0; }
    private String nk(double x, double y, double z) { return String.format("%.3f_%.3f_%.3f", x, y, z); }

    // ── 재료 / 단면 유틸 ──────────────────────────────────────────────

    private double elasticity(String mat) {
        if (mat == null) return E_CONCRETE;
        String m = mat.toLowerCase();
        if (m.contains("steel") || m.contains("강") || m.contains("금속")) return E_STEEL;
        if (m.contains("wood")  || m.contains("목"))                        return E_TIMBER;
        return E_CONCRETE;
    }

    private double density(String mat) {
        if (mat == null) return 24.0;
        String m = mat.toLowerCase();
        if (m.contains("steel") || m.contains("강"))  return 78.5;
        if (m.contains("wood")  || m.contains("목"))  return 6.0;
        return 24.0;
    }

    private boolean isSteel(String mat) {
        if (mat == null) return false;
        String m = mat.toLowerCase();
        return m.contains("steel") || m.contains("강") || m.contains("금속");
    }

    /** Saint-Venant 비틀림 상수 (직사각형 단면) — b ≤ h */
    private double torsionJ(double b0, double h0) {
        double b = Math.min(b0, h0), h = Math.max(b0, h0);
        double ratio = b / h;
        double beta  = 1.0/3.0 * (1 - 0.63 * ratio + 0.052 * ratio*ratio*ratio*ratio*ratio);
        return beta * b * b * b * h;
    }

    private double estFloorArea(List<BimElementDTO> members) {
        OptionalDouble maxX = members.stream().mapToDouble(e -> safe(e.getPositionX(),0)+safe(e.getSizeX(),0)).max();
        OptionalDouble maxY = members.stream().mapToDouble(e -> safe(e.getPositionY(),0)+safe(e.getSizeY(),0)).max();
        return maxX.orElse(10) * maxY.orElse(10);
    }

    private double estExpArea(List<BimElementDTO> members) {
        OptionalDouble maxX = members.stream().mapToDouble(e -> safe(e.getPositionX(),0)+safe(e.getSizeX(),0)).max();
        OptionalDouble maxZ = members.stream().mapToDouble(e -> safe(e.getPositionZ(),0)+safe(e.getSizeZ(),0)).max();
        return maxX.orElse(10) * maxZ.orElse(10);
    }

    private String dominantType(double sigmaN, double sigmaBy, double sigmaBz, double tau) {
        double maxNormal = Math.max(Math.max(sigmaN, sigmaBy), sigmaBz);
        if (tau >= maxNormal) return "SHEAR";
        if (sigmaN >= sigmaBy && sigmaN >= sigmaBz) return "AXIAL";
        if (sigmaBy >= sigmaBz) return "BENDING_STRONG";
        return "BENDING_WEAK";
    }

    private String buildReason(String dom, double sigmaN, double sigmaBy, double sigmaBz,
                                double tau, double fAllow, double fAllowV, String status) {
        String verb = "Danger".equals(status) ? "exceeds" : "approaches";
        return switch (dom) {
            case "SHEAR"         -> String.format(
                "Shear stress τ=%.2f MPa %s allowable τ_allow=%.2f MPa (ratio %.0f%%)",
                tau, verb, fAllowV, tau / Math.max(fAllowV, 1e-9) * 100);
            case "AXIAL"         -> String.format(
                "Axial stress σ_N=%.2f MPa %s allowable f=%.2f MPa (ratio %.0f%%)",
                sigmaN, verb, fAllow, sigmaN / Math.max(fAllow, 1e-9) * 100);
            case "BENDING_STRONG"-> String.format(
                "Strong-axis bending σ_By=%.2f MPa %s allowable f=%.2f MPa (ratio %.0f%%)",
                sigmaBy, verb, fAllow, sigmaBy / Math.max(fAllow, 1e-9) * 100);
            default              -> String.format(
                "Weak-axis bending σ_Bz=%.2f MPa %s allowable f=%.2f MPa (ratio %.0f%%)",
                sigmaBz, verb, fAllow, sigmaBz / Math.max(fAllow, 1e-9) * 100);
        };
    }

    private String buildRemediation(String dom, String elementType, String status) {
        boolean isColumn = elementType != null && elementType.toLowerCase().contains("column");
        boolean isBeam   = elementType != null && elementType.toLowerCase().contains("beam");
        return switch (dom) {
            case "SHEAR"          -> "Add shear reinforcement (stirrups/links) or increase section width";
            case "AXIAL"          -> isColumn
                ? "Increase column cross-section or use higher-grade concrete/steel"
                : "Check load path — high axial may indicate unintended compression in beam";
            case "BENDING_STRONG" -> isBeam
                ? "Increase section depth, reduce span, or add intermediate supports"
                : "Check lateral force magnitude; consider moment-resisting connections";
            case "BENDING_WEAK"   -> "Add lateral bracing or increase weak-axis dimension";
            default               -> "Review applied loads and section properties";
        };
    }

    private double safe(Double v, double def) { return (v == null || v == 0.0) ? def : v; }

    private double varVal(Map<String, Map<String, Double>> vm,
                          String fid, String vn, double fallback) {
        if (vm == null) return fallback;
        var fv = vm.get(fid);
        return fv == null ? fallback : fv.getOrDefault(vn, fallback);
    }
}
