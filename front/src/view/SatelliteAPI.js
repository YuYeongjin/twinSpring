import React, { useEffect, useMemo, useState, useRef } from "react";
import SockJS from "sockjs-client";
import { Client } from "@stomp/stompjs";

export default function SatelliteAPI() {
  const clientRef = useRef(null);
  const [data, setData] = useState([]);
  const [mode, setMode] = useState("NORMAL");
  const [rssi, setRssi] = useState(-92);
  const [batt, setBatt] = useState({ v: 7.6, i: 0.42 });
  const [latest, setLatest] = useState();
  // Spring 부트 포트로 변경하세요. (예: 8080 또는 7011)
  const SOCKET_HTTP_URL = "http://localhost:8080/ws/sensor";

  useEffect(() => {
    const client = new Client({
      webSocketFactory: () => new SockJS(SOCKET_HTTP_URL),
      reconnectDelay: 3000, // 자동 재연결
      onConnect: (frame) => {
        // console.log("STOMP Connected:", frame);

        client.subscribe("/topic/sensor", (msg) => {
          // console.log("Received:", msg.body);
          try {
            const data = JSON.parse(msg.body);
            setLatest(data);
            setData((prev) => [...prev, data]);
          } catch {
            setLatest(msg.body);
            setData((prev) => [...prev, msg.body]);
          }
        });
      },
      onDisconnect: () => {
        console.log("STOMP Disconnected");
      },
      onStompError: (frame) => {
        console.error("STOMP Error:", frame.headers["message"], frame.body);
      },
      onWebSocketClose: (evt) => {
        console.warn("WebSocket Closed:", evt);
      },
      onWebSocketError: (evt) => {
        console.error("WebSocket Error:", evt);
      },
    });

    client.activate();
    clientRef.current = client;

    return () => {
      client.deactivate();
      clientRef.current = null;
    };
  }, []);
  return {
    data,
    mode, setMode,
    batt,
    rssi,
    latest
  };
}
