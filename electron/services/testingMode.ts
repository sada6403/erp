export function isTestingMode(): boolean { return process.env.POS_TEST_MODE === '1' }

export function requireLiveNetwork(): void {
  if (isTestingMode()) throw new Error('External services are disabled in POS Testing Mode')
}
