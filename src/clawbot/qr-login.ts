/**
 * ClawBot QR Code Login - WeChat iLink API
 *
 * Calls https://ilinkai.weixin.qq.com to get QR code and poll for login confirmation.
 * Returns bot_token on success.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../logger.js';

const log = createLogger('ClawBotQR');

const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com';
const ILINK_APP_ID = 'bot';
const BOT_TYPE = '3';
const POLL_TIMEOUT_MS = 35_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface QRLoginSession {
  sessionKey: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
}

export interface QRLoginResult {
  connected: boolean;
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
  message: string;
}

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': randomUUID(),
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': '131588', // 2.4.4 encoded
  };
}

export async function fetchQRCode(): Promise<{ qrcode: string; qrcodeUrl: string }> {
  const url = `${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ local_token_list: [] }),
  });
  const data = await res.json() as { qrcode: string; qrcode_img_content: string };
  if (!data.qrcode) {
    throw new Error('Failed to get QR code from iLink API');
  }
  return { qrcode: data.qrcode, qrcodeUrl: data.qrcode_img_content };
}

async function pollQRStatus(qrcode: string): Promise<{
  status: string;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}> {
  const url = `${ILINK_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
  try {
    const headers = buildHeaders();
    delete headers['Content-Type'];
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return await res.json() as {
      status: string;
      bot_token?: string;
      ilink_bot_id?: string;
      baseurl?: string;
      ilink_user_id?: string;
      redirect_host?: string;
    };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'wait' };
    }
    throw err;
  }
}

/**
 * Start QR code login session. Returns QR code URL for display.
 */
export async function startQRLogin(): Promise<QRLoginSession> {
  log.info('Starting ClawBot QR login...');
  const { qrcode, qrcodeUrl } = await fetchQRCode();
  log.info(`QR code received, url=${qrcodeUrl}`);
  return {
    sessionKey: randomUUID(),
    qrcode,
    qrcodeUrl,
    startedAt: Date.now(),
  };
}

/**
 * Wait for user to scan QR code. Polls until confirmed or timeout.
 * Returns bot_token on success.
 */
export async function waitForQRLogin(
  session: QRLoginSession,
  onStatusChange?: (status: string) => void,
): Promise<QRLoginResult> {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let currentBaseUrl = ILINK_BASE_URL;
  let redirectCount = 0;

  log.info('Waiting for QR code scan...');

  while (Date.now() < deadline) {
    const result = await pollQRStatus(session.qrcode);
    onStatusChange?.(result.status);

    switch (result.status) {
      case 'wait':
      case 'scaned':
        break;

      case 'scaned_but_redirect':
        if (result.redirect_host) {
          currentBaseUrl = `https://${result.redirect_host}`;
          redirectCount++;
          log.info(`IDC redirect to ${result.redirect_host} (${redirectCount})`);
        }
        break;

      case 'confirmed':
        if (!result.bot_token) {
          return { connected: false, message: '登录失败：服务器未返回 bot_token' };
        }
        log.info(`Login confirmed! botId=${result.ilink_bot_id}`);
        return {
          connected: true,
          botToken: result.bot_token,
          accountId: result.ilink_bot_id,
          baseUrl: result.baseurl,
          userId: result.ilink_user_id,
          message: '登录成功',
        };

      case 'expired':
        return { connected: false, message: '二维码已过期，请重新生成' };

      case 'binded_redirect':
        return { connected: false, message: '已连接过，无需重复连接' };

      default:
        log.warn(`Unknown QR status: ${result.status}`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return { connected: false, message: '登录超时，请重试' };
}
