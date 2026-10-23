/** Clinical result codes from built-in and teacher-source cases share the same
 * observation contract. Callers must still verify successful event + unlock. */
export function isExamResultEvidence(code: string): boolean {
  return code.startsWith('SOURCE_EX_') || (code.startsWith('EX_') && code !== 'EX_PREP' && code !== 'EX_PROVIDED');
}
