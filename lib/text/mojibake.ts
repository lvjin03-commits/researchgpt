export type MojibakeFinding = {
  pattern: string;
  sample: string;
};

const MOJIBAKE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  // Replacement character almost always means the original byte stream was decoded incorrectly.
  { label: "replacement-character", pattern: /\uFFFD/u },

  // Common UTF-8-as-GBK fragments that appeared in generated/export messages.
  // Keep these as multi-character sequences to avoid flagging normal Chinese text.
  { label: "utf8-as-gbk-generated", pattern: /\u9422\u7194\u6D60\u57DA/u },
  { label: "utf8-as-gbk-file", pattern: /\u93C2\u56E8\u6D60[\u3002\u5B58]/u },
  { label: "utf8-as-gbk-content", pattern: /\u9350\u5C83/u },
  { label: "utf8-as-gbk-table", pattern: /\u741B\u3126\u7243/u },
  { label: "utf8-as-gbk-link", pattern: /\u93C8[\u7459\u7481]/u },
  { label: "utf8-as-gbk-format", pattern: /\u93CD\u714E\u5F0F/u },
  { label: "utf8-as-gbk-rare-cjk-cluster", pattern: /[\u9300-\u943F][\u3000-\u9FFF]{1,8}/u },
  { label: "curly-quote-mojibake", pattern: /\u9225[\u003F\u6A9A\u6A9B]?/u },

  // Western mojibake and curly-quote corruption.
  { label: "western-utf8-as-latin1", pattern: /\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\u00BF]{1,2}/u },
];

function sampleAround(text: string, index: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + 56);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export function detectMojibake(text: string): MojibakeFinding[] {
  const findings: MojibakeFinding[] = [];

  for (const { label, pattern } of MOJIBAKE_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.index !== undefined) {
      findings.push({
        pattern: label,
        sample: sampleAround(text, match.index),
      });
    }
  }

  return findings;
}

export function hasMojibake(text: string): boolean {
  return detectMojibake(text).length > 0;
}
