const PATTERNS: Array<[RegExp, (m: string) => string]> = [
  // OpenAI / Anthropic / Claude API keys
  [/\bsk-[a-zA-Z0-9]{32,}\b/g, (m) => 'sk-****' + m.slice(-4)],
  
  // AWS Access Key
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, (m) => m.slice(0, 4) + '****'],
  
  // GitHub Personal Access Token
  [/\b(ghp|github_pat)_[a-zA-Z0-9_]{36,}\b/g, (m) => m.slice(0, 4) + '_****'],
  
  // GitLab Personal Access Token
  [/\bglpat-[a-zA-Z0-9_-]{20,}\b/g, (m) => 'glpat-****'],
  
  // Telegram Bot Token
  [/\b[0-9]{8,}:[a-zA-Z0-9_-]{35,}\b/g, (m) => m.split(':')[0] + ':****'],
  
  // Anthropic API Key
  [/\bant-[a-zA-Z0-9]{32,}\b/g, (m) => 'ant-****' + m.slice(-4)],
  
  // OpenRouter API Key
  [/\bsk-or-[a-zA-Z0-9]{32,}\b/g, (m) => 'sk-or-****' + m.slice(-4)],
  
  // Google API Key
  [/\bAIza[a-zA-Z0-9_-]{35}\b/g, (m) => 'AIza****'],
  
  // Azure API Key
  [/\b[a-f0-9]{32}:[a-zA-Z0-9]{44}\b/g, (m) => m.split(':')[0] + ':****'],
  
  // 飞书/钉钉等 Bot Token
  [/\b(bot)[-_][a-zA-Z0-9_-]{20,}\b/gi, (m) => 'bot_****'],
  
  // 通用 API Key (更严格的匹配，避免误报)
  [/\b(api_key|apikey|api-key|API_KEY|APIKEY)["\s]*[:=]["\s]*[a-zA-Z0-9_\-]{16,}\b/gi, 
     (m) => m.split(/[:=]/)[0] + '=****'],
     
  // 密码模式
  [/\b(password|passwd|pwd)["\s]*[:=]["\s]*[^\s]{8,}\b/gi, 
     (m) => m.split(/[:=]/)[0] + '=****'],
];

export function sanitize(text: string): string {
  let result = text;
  for (const [re, replacer] of PATTERNS) {
    result = result.replace(re, replacer);
  }
  return result;
}
