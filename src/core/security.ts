/**
 * Inbound-message tripwire for secret-extraction attempts (security bible §7).
 * Detection is lexical and intentionally shallow: it LOGS the attempt and
 * warns the model about the current turn; it never blocks the message. The
 * model is told to refuse only if the ask is to reveal — educational questions
 * ("what is a seed phrase?") still get answered.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(seed|recovery)\s*(phrase|words?)\b|\bmnemonic\b/i, 'seed phrase'],
  [/\bprivate\s*key\b|\bprivkey\b|\bsecret\s*key\b/i, 'private key'],
  [/\.env\b|\benv\s*(file|vars?|values?)\b/i, 'env file'],
  [/\bbot\s*token\b|\bapi[\s-]?key\b|\baccess\s*token\b|\bbearer\s*token\b/i, 'api key / token'],
  [/\bkeystore\b|\bjson\s*keystore\b/i, 'keystore'],
];

export function detectSecretRequest(text: string): string | null {
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(text)) return label;
  }
  return null;
}
