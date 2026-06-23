import { useCallback, useEffect, useRef, useState } from "react";
import type { JsonRequest } from "../api.js";

export type QrLoginState = "idle" | "loading" | "scanning" | "success" | "error";

export interface QrLoginResult {
  botToken: string;
  baseUrl?: string;
}

export interface UseQrLogin {
  state: QrLoginState;
  qrImg: string;
  message: string;
  start: () => void;
  reset: () => void;
}

function toMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * ClawBot 扫码登录状态机。封装 /api/clawbot/qr-login/start + /wait。
 *
 * - start() 触发新一轮：loading → scanning → success/error
 * - reset() 中断进行中的请求并回到 idle
 * - 组件卸载时自动 abort 进行中的 /wait 长轮询
 */
export function useQrLogin(
  request: JsonRequest,
  onSuccess: (result: QrLoginResult) => void,
): UseQrLogin {
  const [state, setState] = useState<QrLoginState>("idle");
  const [qrImg, setQrImg] = useState("");
  const [message, setMessage] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current += 1;
    setState("idle");
    setQrImg("");
    setMessage("");
  }, []);

  const start = useCallback(() => {
    const runId = ++runIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState("loading");
    setQrImg("");
    setMessage("");

    (async () => {
      try {
        const s = (await request("/api/clawbot/qr-login/start", {
          method: "POST",
        })) as {
          success?: boolean;
          qrcodeImage?: string;
          qrcodeUrl?: string;
          qrcode?: string;
          sessionKey?: string;
          error?: string;
        };
        if (runId !== runIdRef.current) return;
        if (!s.success || !s.qrcodeImage || !s.sessionKey || !s.qrcode) {
          setState("error");
          setMessage(s.error || "qrLoginFailed");
          return;
        }
        setQrImg(s.qrcodeImage);
        setState("scanning");

        const w = (await request("/api/clawbot/qr-login/wait", {
          method: "POST",
          body: JSON.stringify({
            sessionKey: s.sessionKey,
            qrcode: s.qrcode,
            qrcodeUrl: s.qrcodeUrl,
          }),
          signal: controller.signal,
        })) as {
          success?: boolean;
          botToken?: string;
          baseUrl?: string;
          message?: string;
          error?: string;
        };
        if (runId !== runIdRef.current) return;
        if (w.success && w.botToken) {
          setState("success");
          setMessage("");
          onSuccessRef.current({ botToken: w.botToken, baseUrl: w.baseUrl });
        } else {
          setState("error");
          setMessage(w.message || w.error || "qrLoginFailed");
        }
      } catch (e) {
        if (runId !== runIdRef.current) return;
        if (e instanceof Error && e.name === "AbortError") return;
        setState("error");
        setMessage(toMsg(e));
      }
    })();
  }, [request]);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  return { state, qrImg, message, start, reset };
}
