/**
 * TTS (Text-to-Speech) 模块
 * 使用 edge-tts-node 调用微软 Edge TTS 服务
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from 'edge-tts-node';
import { createLogger } from '../logger.js';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { APP_HOME } from '../constants.js';
import { randomBytes } from 'node:crypto';

const log = createLogger('TTS');

/** TTS 配置 */
export interface TTSConfig {
  enabled: boolean;
  voice?: string;  // 默认中文女声
}

/** 默认配置 */
const DEFAULT_TTS_CONFIG: TTSConfig = {
  enabled: false,
  voice: 'zh-CN-XiaoxiaoNeural',
};

let config: TTSConfig = DEFAULT_TTS_CONFIG;
let tts: MsEdgeTTS | null = null;

/**
 * 初始化 TTS
 */
export function initTTS(cfg?: Partial<TTSConfig>): void {
  config = { ...DEFAULT_TTS_CONFIG, ...cfg };
  if (config.enabled) {
    tts = new MsEdgeTTS({ enableLogger: false });
    log.info(`TTS enabled, voice: ${config.voice}`);
  }
}

/**
 * 获取 TTS 配置
 */
export function getTTSConfig(): TTSConfig {
  return config;
}

/**
 * 文字转语音
 * @returns 音频文件路径
 */
export async function textToSpeech(text: string): Promise<string | null> {
  if (!config.enabled || !tts) {
    return null;
  }

  try {
    // 截断过长的文本（TTS 有长度限制）
    const truncatedText = text.length > 5000 ? text.substring(0, 5000) + '...' : text;

    // 清理 markdown 格式（TTS 不需要）
    const cleanText = truncatedText
      .replace(/```[\s\S]*?```/g, '代码块已省略')  // 代码块
      .replace(/`[^`]+`/g, (match) => match.slice(1, -1))  // 行内代码
      .replace(/\*\*[^*]+\*\*/g, (match) => match.slice(2, -2))  // 粗体
      .replace(/\*[^*]+\*/g, (match) => match.slice(1, -1))  // 斜体
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // 链接
      .replace(/#{1,6}\s/g, '')  // 标题
      .replace(/\n{3,}/g, '\n\n');  // 多余换行

    // 生成音频文件路径
    const audioDir = join(APP_HOME, 'audio');
    if (!existsSync(audioDir)) {
      mkdirSync(audioDir, { recursive: true });
    }
    const audioPath = join(audioDir, `tts-${randomBytes(8).toString('hex')}.mp3`);

    // 设置 TTS 元数据
    await tts.setMetadata(config.voice!, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

    // 调用 TTS
    await tts.toFile(audioPath, cleanText);

    log.info(`TTS generated: ${audioPath}`);
    return audioPath;
  } catch (err) {
    log.error('TTS failed:', err);
    return null;
  }
}
