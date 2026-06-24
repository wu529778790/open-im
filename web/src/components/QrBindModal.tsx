import { useEffect, useRef } from "react";
import type { JsonRequest } from "../api.js";
import { useQrLogin, type QrLoginResult } from "../hooks/useQrLogin.js";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: QrLoginResult) => void;
  request: JsonRequest;
  platform: string;
}

/**
 * 扫码绑定模态框。打开时自动开始 QR 登录流程；
 * 成功后短暂展示「绑定成功」再回调 onClose；失败/过期展示「重新扫码」。
 *
 * 后端把登录 URL 编码成 base64 PNG，前端直接 <img src> 显示，无跨域问题。
 */
export function QrBindModal({ open, onClose, onSuccess, request, platform }: Props) {
  const lastResultRef = useRef<QrLoginResult | null>(null);
  const { state, qrImg, message, start, reset } = useQrLogin(request, platform, (r) => {
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
          aria-label="关闭"
          onClick={onClose}
        >
          ×
        </button>
        <div className="qr-modal-title">扫码绑定</div>

        {state === "loading" && (
          <div className="qr-modal-status">正在生成二维码...</div>
        )}

        {state === "scanning" && (
          <>
            <div className="qr-modal-img-wrap">
              {qrImg ? (
                <img className="qr-modal-img" src={qrImg} alt="QR" />
              ) : (
                <div className="qr-modal-status">正在生成二维码...</div>
              )}
            </div>
            <div className="qr-modal-hint">请用微信扫描下方二维码完成绑定</div>
            <div className="qr-modal-status muted">等待扫码...</div>
          </>
        )}

        {state === "success" && (
          <div className="qr-modal-status ok">✅ 绑定成功</div>
        )}

        {state === "error" && (
          <>
            <div className="qr-modal-status err">
              {message || "绑定失败"}
            </div>
            <div className="qr-modal-actions">
              <button
                type="button"
                className="btn btn-p btn-sm"
                onClick={start}
              >
                重新扫码
              </button>
              <button
                type="button"
                className="btn btn-s btn-sm"
                onClick={onClose}
              >
                关闭
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}