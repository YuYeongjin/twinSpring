package yyj.project.twinspring.controller;

import dev.samstevens.totp.code.DefaultCodeGenerator;
import dev.samstevens.totp.code.DefaultCodeVerifier;
import dev.samstevens.totp.code.HashingAlgorithm;
import dev.samstevens.totp.qr.QrData;
import dev.samstevens.totp.secret.DefaultSecretGenerator;
import dev.samstevens.totp.time.SystemTimeProvider;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dao.SettingsDAO;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/auth/totp")
public class TotpController {

    private final SettingsDAO settingsDAO;
    private final DefaultSecretGenerator secretGenerator = new DefaultSecretGenerator();
    private final DefaultCodeVerifier codeVerifier =
            new DefaultCodeVerifier(new DefaultCodeGenerator(), new SystemTimeProvider());

    // setup/reset은 서버 로컬(127.0.0.1 / ::1)에서만 허용
    private static final Set<String> LOCAL_ADDRS = Set.of("127.0.0.1", "::1", "0:0:0:0:0:0:0:1");

    // 단일 사용자(로컬) 환경이므로 in-memory로 임시 보관
    private volatile String pendingSecret = null;

    public TotpController(SettingsDAO settingsDAO) {
        this.settingsDAO = settingsDAO;
    }

    private boolean isLocal(HttpServletRequest request) {
        String addr = request.getRemoteAddr();
        return LOCAL_ADDRS.contains(addr);
    }

    /** TOTP 설정 여부 확인 */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status() {
        Map<String, Object> setting = settingsDAO.getSetting("totp_secret");
        boolean configured = setting != null
                && setting.get("settingValue") != null
                && !setting.get("settingValue").toString().isBlank();
        return ResponseEntity.ok(Map.of("configured", configured));
    }

    /** 새 TOTP 비밀키 생성 + QR URI 반환 — localhost만 허용 */
    @GetMapping("/setup")
    public ResponseEntity<Map<String, Object>> setup(HttpServletRequest request) {
        if (!isLocal(request)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        pendingSecret = secretGenerator.generate();
        QrData qrData = new QrData.Builder()
                .label("twinSpring")
                .secret(pendingSecret)
                .issuer("twinSpring")
                .algorithm(HashingAlgorithm.SHA1)
                .digits(6)
                .period(30)
                .build();
        return ResponseEntity.ok(Map.of(
                "secret", pendingSecret,
                "uri", qrData.getUri()
        ));
    }

    /** 첫 코드 입력으로 설정 확정 → DB 저장 — localhost만 허용 */
    @PostMapping("/setup/confirm")
    public ResponseEntity<Map<String, Object>> confirmSetup(HttpServletRequest request,
                                                            @RequestBody Map<String, String> body) {
        if (!isLocal(request)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        if (pendingSecret == null) {
            return ResponseEntity.badRequest().body(Map.of("ok", false));
        }
        String code = body.getOrDefault("code", "");
        boolean valid = codeVerifier.isValidCode(pendingSecret, code);
        if (valid) {
            Map<String, Object> params = new HashMap<>();
            params.put("settingKey", "totp_secret");
            params.put("settingValue", pendingSecret);
            settingsDAO.upsertSetting(params);
            pendingSecret = null;
        }
        return ResponseEntity.ok(Map.of("ok", valid));
    }

    /** 6자리 코드 검증 (로그인 시) */
    @PostMapping("/verify")
    public ResponseEntity<Map<String, Object>> verify(@RequestBody Map<String, String> body) {
        Map<String, Object> setting = settingsDAO.getSetting("totp_secret");
        if (setting == null || setting.get("settingValue") == null
                || setting.get("settingValue").toString().isBlank()) {
            return ResponseEntity.ok(Map.of("ok", false));
        }
        String secret = setting.get("settingValue").toString();
        String code = body.getOrDefault("code", "");
        boolean valid = codeVerifier.isValidCode(secret, code);
        return ResponseEntity.ok(Map.of("ok", valid));
    }

    /** TOTP 초기화 (재설정용) — localhost만 허용 */
    @PostMapping("/reset")
    public ResponseEntity<Map<String, Object>> reset(HttpServletRequest request) {
        if (!isLocal(request)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        Map<String, Object> params = new HashMap<>();
        params.put("settingKey", "totp_secret");
        params.put("settingValue", "");
        settingsDAO.upsertSetting(params);
        pendingSecret = null;
        return ResponseEntity.ok(Map.of("ok", true));
    }
}
