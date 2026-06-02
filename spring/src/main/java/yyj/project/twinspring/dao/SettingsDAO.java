package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;

import java.util.List;
import java.util.Map;

@Mapper
public interface SettingsDAO {
    List<Map<String, Object>> getAllSettings();
    Map<String, Object> getSetting(String key);
    void upsertSetting(Map<String, Object> params);

    // 대화 히스토리
    List<Map<String, Object>> getChatHistory(Map<String, Object> params);
    void insertChatMessages(List<Map<String, Object>> messages);
    void deleteExpiredChatHistory(Map<String, Object> params);
    void deleteChatHistoryBySession(String sessionId);
    int countChatHistory(String sessionId);
}
