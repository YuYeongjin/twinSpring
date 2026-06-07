package yyj.project.twinspring.controller;

import dev.samstevens.totp.code.DefaultCodeGenerator;
import dev.samstevens.totp.code.DefaultCodeVerifier;
import dev.samstevens.totp.code.HashingAlgorithm;
import dev.samstevens.totp.qr.QrData;
import dev.samstevens.totp.secret.DefaultSecretGenerator;
import dev.samstevens.totp.time.SystemTimeProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dao.SettingsDAO;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/auth/totp")
public class TotpController {

    private final SettingsDAO settingsDAO;
    private final String setupPassword;
    private final DefaultSecretGenerator secretGenerator = new DefaultSecretGenerator();
    private final DefaultCodeVerifier codeVerifier =
            new DefaultCodeVerifier(new DefaultCodeGenerator(), new SystemTimeProvider());

    private volatile String pendingSecret = null;

    public TotpController(SettingsDAO settingsDAO,
                          @Value("${totp.setup-password:}") String setupPassword) {
        this.settingsDAO = settingsDAO;
        this.setupPassword = setupPassword;
    }

    private String getStoredSecret() {
        Map<String, Object> setting = settingsDAO.getSetting("totp_secret");
        if (setting == null || setting.get("settingValue") == null) return null;
        String v = setting.get("settingValue").toString();
        return v.isBlank() ? null : v;
    }

    /** TOTP 설정 여부 확인 */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status() {
        return ResponseEntity.ok(Map.of("configured", getStoredSecret() != null));
    }

    /**
     * QR 코드 발급 — TOTP_SETUP_PASSWORD 일치해야 허용
     * 이미 설정된 경우 409 반환
     */
    @PostMapping("/setup")
    public ResponseEntity<Map<String, Object>> setup(@RequestBody Map<String, String> body) {
        // 이미 설정된 경우
        if (getStoredSecret() != null) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "already_configured"));
        }
        // 비밀번호 미설정 또는 불일치
        if (setupPassword.isBlank() || !setupPassword.equals(body.getOrDefault("password", ""))) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "invalid_password"));
        }
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

    /** 첫 코드 입력으로 설정 확정 → DB 저장 */
    @PostMapping("/setup/confirm")
    public ResponseEntity<Map<String, Object>> confirmSetup(@RequestBody Map<String, String> body) {
        if (pendingSecret == null) {
            return ResponseEntity.badRequest().body(Map.of("ok", false));
        }
        boolean valid = codeVerifier.isValidCode(pendingSecret, body.getOrDefault("code", ""));
        if (valid) {
            Map<String, Object> params = new HashMap<>();
            params.put("settingKey", "totp_secret");
            params.put("settingValue", pendingSecret);
            settingsDAO.upsertSetting(params);
            pendingSecret = null;
        }
        return ResponseEntity.ok(Map.of("ok", valid));
    }

    /** 6자리 코드 검증 */
    @PostMapping("/verify")
    public ResponseEntity<Map<String, Object>> verify(@RequestBody Map<String, String> body) {
        String secret = getStoredSecret();
        if (secret == null) return ResponseEntity.ok(Map.of("ok", false));
        boolean valid = codeVerifier.isValidCode(secret, body.getOrDefault("code", ""));
        return ResponseEntity.ok(Map.of("ok", valid));
    }

    /** TOTP 초기화 — 현재 유효한 OTP 코드 + 설정 비밀번호 둘 다 필요 */
    @PostMapping("/reset")
    public ResponseEntity<Map<String, Object>> reset(@RequestBody Map<String, String> body) {
        String secret = getStoredSecret();
        if (secret == null) return ResponseEntity.ok(Map.of("ok", false));
        // OTP 코드 검증
        boolean validCode = codeVerifier.isValidCode(secret, body.getOrDefault("code", ""));
        if (!validCode) return ResponseEntity.ok(Map.of("ok", false));
        Map<String, Object> params = new HashMap<>();
        params.put("settingKey", "totp_secret");
        params.put("settingValue", "");
        settingsDAO.upsertSetting(params);
        pendingSecret = null;
        return ResponseEntity.ok(Map.of("ok", true));
    }
}
