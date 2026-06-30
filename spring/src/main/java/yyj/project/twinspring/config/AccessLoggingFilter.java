package yyj.project.twinspring.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import yyj.project.twinspring.service.RecentAccessService;

import java.io.IOException;

@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AccessLoggingFilter extends OncePerRequestFilter {

    private final RecentAccessService recentAccessService;

    public AccessLoggingFilter(RecentAccessService recentAccessService) {
        this.recentAccessService = recentAccessService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        long startTime = System.currentTimeMillis();
        try {
            filterChain.doFilter(request, response);
        } finally {
            long duration = System.currentTimeMillis() - startTime;
            String clientIp = getClientIp(request);
            String uri = request.getRequestURI();
            int status = response.getStatus();
            log.info("ACCESS_LOG | IP: {} | Method: {} | URI: {} | Status: {} | Duration: {}ms",
                    clientIp, request.getMethod(), uri, status, duration);
            recentAccessService.record(clientIp, request.getMethod(), uri, status);
        }
    }

    private String getClientIp(HttpServletRequest request) {
        String ip = request.getHeader("CF-Connecting-IP");
        if (ip == null) ip = request.getHeader("X-Forwarded-For");
        if (ip == null) ip = request.getRemoteAddr();
        return ip != null ? ip.split(",")[0].trim() : "unknown";
    }
}
