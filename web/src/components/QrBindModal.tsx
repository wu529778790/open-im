import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import type { JsonRequest } from "../api.js";
import { useQrLogin, type QrLoginResult } from "../hooks/useQrLogin.js";

type T = (k: string, p?: Record<string, string | number>) => string;

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: QrLoginResult) => void;
  request: JsonRequest;
  t: T;
}

/**
 * 扫码绑定模态框。打开时自动开始 ClawBot QR 登录流程；
 * 成功后短暂展示「绑定成功」再回调 onClose；失败/过期展示「重新扫码」。
 *
 * iLink 返回的 qrcodeUrl 是一个 HTML 中转页 URL（带 X-Frame-Options，
 * 且 Content-Type 是 text/html），既不能用 <img> 也不能 iframe。
 * 因此用 qrcode 库把这个 URL 本身渲染成 canvas 二维码——
 * 用户扫码后微信会打开该中转页完成绑定确认。
 */
export function QrBindModal({ open, onClose, onSuccess, request, t }: Props) {
  const lastResultRef = useRef<QrLoginResult | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { state, qrUrl, message, start, reset } = useQrLogin(request, (r) => {
    lastResultRef.current = r;
  });

  // 打开时自动开始；关闭时重置
  useEffect(() => {
    if (open) {
      lastResultRef.current = null;
      start();
    } else {
      reset();
    }
  }, [open, start, reset]);

  // 把 qrcodeUrl 渲染成 canvas 二维码
  useEffect(() => {
    if (state !== "scanning" || !qrUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, qrUrl, { width: 220, margin: 1 }, (err) => {
      if (err) {
        // 渲染失败时清空 canvas
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx && canvasRef.current) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
    });
  }, [state, qrUrl]);

  // 成功后延迟回调 + 关闭
  useEffect(() => {
    if (state !== "success") return;
    const id = window.setTimeout(() => {
      if (lastResultRef.current) onSuccess(lastResultRef.current);
      onClose();
    }, 1200);
    return () => window.clearTimeout(id);
  }, [state, onSuccess, onClose]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="qr-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="qr-modal" role="dialog" aria-modal="true">
        <button
          type="button"
          className="qr-modal-close"
          aria-label={t("qrModalClose")}
          onClick={onClose}
        >
          ×
        </button>
        <div className="qr-modal-title">{t("qrModalTitle")}</div>

        {state === "loading" && (
          <div className="qr-modal-status">{t("qrModalGenerating")}</div>
        )}

        {state === "scanning" && (
          <>
            <div className="qr-modal-img-wrap">
              <canvas ref={canvasRef} className="qr-modal-img" />
            </div>
            <div className="qr-modal-hint">{t("qrModalHint")}</div>
            <div className="qr-modal-status muted">{t("qrModalScanning")}</div>
          </>
        )}

        {state === "success" && (
          <div className="qr-modal-status ok">✅ {t("qrModalSuccess")}</div>
        )}

        {state === "error" && (
          <>
            <div className="qr-modal-status err">
              {message || t("qrModalError")}
            </div>
            <div className="qr-modal-actions">
              <button
                type="button"
                className="btn btn-p btn-sm"
                onClick={start}
              >
                {t("qrModalRetry")}
              </button>
              <button
                type="button"
                className="btn btn-s btn-sm"
                onClick={onClose}
              >
                {t("qrModalClose")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
