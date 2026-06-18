/**
 * 选择检测器 — 从 AI 输出中检测并提取编号选项
 *
 * 当 AI 问"请选择 1/2/3"时，提取选项并返回结构化数据。
 */

export interface DetectedChoice {
  number: number;
  text: string;
}

export interface DetectionResult {
  /** 是否检测到选择 */
  hasChoices: boolean;
  /** 提取的选项列表 */
  choices: DetectedChoice[];
  /** 去除选项后的纯文本（用于显示） */
  cleanText: string;
}

/**
 * 检测 AI 输出中的编号选择
 *
 * 支持格式：
 * - "1. Option A\n2. Option B\n3. Option C"
 * - "1）Option A\n2）Option B"
 * - "**选择 1：** Option A"
 */
export function detectChoices(text: string): DetectionResult {
  // 匹配 "1." 或 "1）" 或 "1:" 开头的行
  const choicePattern = /^\s*(\d+)[.）:]\s*(.+)$/gm;
  const matches: DetectedChoice[] = [];
  let match;

  while ((match = choicePattern.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    const content = match[2].trim();
    if (num >= 1 && num <= 9 && content.length > 0) {
      matches.push({ number: num, text: content });
    }
  }

  // 检查是否有选择提示（如"请选择"、"选择哪个"等）
  const hasChoicePrompt = /请选择|选择哪个|选一个|pick|choose|select/i.test(text);

  // 至少需要 2 个选项且有选择提示
  const hasChoices = matches.length >= 2 && hasChoicePrompt;

  if (!hasChoices) {
    return { hasChoices: false, choices: [], cleanText: text };
  }

  // 去除选项行，保留其他内容
  const lines = text.split('\n');
  const cleanLines = lines.filter(line => {
    const trimmed = line.trim();
    return !/^\s*\d+[.）:]\s*.+/.test(trimmed);
  });

  return {
    hasChoices: true,
    choices: matches,
    cleanText: cleanLines.join('\n').trim(),
  };
}

/**
 * 构建 Telegram inline keyboard
 */
export function buildChoiceKeyboard(
  choices: DetectedChoice[],
  userId: string,
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

  // 每行 1 个按钮（选项通常较长）
  for (const choice of choices) {
    buttons.push([{
      text: `${choice.number}. ${choice.text}`,
      callback_data: `choice:${userId}:${choice.number}`,
    }]);
  }

  return { inline_keyboard: buttons };
}
