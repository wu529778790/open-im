import { useCallback, useEffect, useRef, useState } from "react";
import type { JsonRequest } from "../api.js";

export type QrLoginState = "idle" | "loading" | "scanning" | "success" | "error";

/** 扫码成功后的凭据，由调用方按平台自行取字段 */
export type QrLoginResult = Record<string, string>;

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
 * 扫码登录状态机。封装 /api/${platform}/qr-login/start + /wait。
 *
 * - start() 触发新一轮：loading → scanning → success/error
 * - reset() 中断进行中的请求并回到 idle
 * - 组件卸载时自动 abort 进行中的 /wait 长轮询
 *
 * start 响应取 qrcodeImage 显示；整个 start 响应原样作为 wait 请求 body
 * 发送（后端自己取需要的字段）。wait 响应透传给 onSuccess。
 */
export function useQrLogin(
  request: JsonRequest,
  platform: string,
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
        const s = (await request(`/api/${platform}/qr-login/start`, {
          method: "POST",
        })) as Record<string, unknown>;
        if (runId !== runIdRef.current) return;
        if (!s.success || !s.qrcodeImage) {
          setState("error");
          setMessage(String(s.error || "qrLoginFailed"));
          return;
        }
        setQrImg(String(s.qrcodeImage));
        setState("scanning");

        const w = (await request(`/api/${platform}/qr-login/wait`, {
          method: "POST",
          body: JSON.stringify(s),
          signal: controller.signal,
        })) as Record<string, unknown>;
        if (runId !== runIdRef.current) return;
        if (w.success) {
          setState("success");
          setMessage("");
          // 透传整个响应，由调用方取字段
          const result: QrLoginResult = {};
          for (const [k, v] of Object.entries(w)) {
            if (typeof v === "string") result[k] = v;
          }
          onSuccessRef.current(result);
        } else {
          setState("error");
          setMessage(String(w.message || w.error || "qrLoginFailed"));
        }
      } catch (e) {
        if (runId !== runIdRef.current) return;
        if (e instanceof Error && e.name === "AbortError") return;
        setState("error");
        setMessage(toMsg(e));
      }
    })();
  }, [request, platform]);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  return { state, qrImg, message, start, reset };
}
