import { useEffect, useRef } from "react";
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
 * 后端把 iLink 返回的 qrcodeUrl（HTML 中转页）编码成 base64 PNG，
 * 前端直接 <img src="data:image/png;base64,..."> 显示，无跨域问题。
 */
export function QrBindModal({ open, onClose, onSuccess, request, t }: Props) {
  const lastResultRef = useRef<QrLoginResult | null>(null);
  const { state, qrImg, message, start, reset } = useQrLogin(request, (r) => {
    lastResultRef.current = r;
  });

  useEffect(() => {
    if (open) {
      lastResultRef.current = null;
      start();
    } else {
      reset();
    }
  }, [open, start, reset]);

  useEffect(() => {
    if (state !== "success") return;
    const id = window.setTimeout(() => {
      if (lastResultRef.current) onSuccess(lastResultRef.current);
      onClose();
    }, 1200);
    return () => window.clearTimeout(id);
  }, [state, onSuccess, onClose]);

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
              {qrImg ? (
                <img className="qr-modal-img" src={qrImg} alt="QR" />
              ) : (
                <div className="qr-modal-status">{t("qrModalGenerating")}</div>
              )}
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
