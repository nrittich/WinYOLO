const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_OPENAI_KEY]"],
  [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]"],
  [/(OPENAI_API_KEY\s*[=:]\s*)[^\s,;"']+/gi, "$1[REDACTED]"],
  [/("?(?:api[_-]?key|authorization|token)"?\s*:\s*")[^"]+/gi, "$1[REDACTED]"],
];

export function redactText(value: string): string {
  let output = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as T;
  if (value && typeof value === "object") {
    const clean: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      clean[key] = /api.?key|authorization|token/i.test(key)
        ? "[REDACTED]"
        : redactValue(item);
    }
    return clean as T;
  }
  return value;
}
