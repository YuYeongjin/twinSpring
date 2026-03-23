import React, { useEffect, useMemo, useState, useRef } from "react";
import SockJS from "sockjs-client";
import { Client } from "@stomp/stompjs";
import axios from "axios";

export default function SatelliteAPI() {
  const clientRef = useRef(null);
  const [data, setData] = useState([]);
  const [mode, setMode] = useState("NORMAL");
  const [rssi, setRssi] = useState(-92);
  const [batt, setBatt] = useState({ v: 7.6, i: 0.42 });
  const [latest, setLatest] = useState();
  const [bimMenu, setBimMenu] = useState('default');
  // WebSocket 연결 상태: 'connecting' | 'connected' | 'disconnected' | 'error'
  const [wsStatus, setWsStatus] = useState('connecting');
  const SOCKET_HTTP_URL = "http://localhost:8080/ws/sensor";


  const addNewProject = (category) => {
    axios.post("http://localhost:8080/api/bim/project", {
      structureType: category,
      projectName: category + " project",
      spanCount: 0
    })
      .then((response) => {
        console.log(response.data);
      })
      .catch((error) => {
        console.log(error)
      })
  }

  useEffect(() => {
    const client = new Client({
      webSocketFactory: () => new SockJS(SOCKET_HTTP_URL),
      reconnectDelay: 3000, // 자동 재연결
      onConnect: (frame) => {
        setWsStatus('connected');
        console.log("[WS] STOMP Connected:", frame.headers['server'] ?? 'ok');

        client.subscribe("/topic/sensor", (msg) => {
          console.log("[WS] 메시지 수신:", msg.body);
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
        setWsStatus('disconnected');
        console.warn("[WS] STOMP Disconnected");
      },
      onStompError: (frame) => {
        setWsStatus('error');
        console.error("[WS] STOMP Error:", frame.headers["message"], frame.body);
      },
      onWebSocketClose: (evt) => {
        setWsStatus('disconnected');
        console.warn("[WS] WebSocket Closed - code:", evt.code, "reason:", evt.reason);
      },
      onWebSocketError: (evt) => {
        setWsStatus('error');
        console.error("[WS] WebSocket Error:", evt);
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
    latest, addNewProject,
    bimMenu, setBimMenu,
    wsStatus,  // 'connecting' | 'connected' | 'disconnected' | 'error'
  };
}
