export const ONBOARDING_STEPS = ['identity', 'wallet', 'prediction', 'done'] as const
export type OnboardingStep = typeof ONBOARDING_STEPS[number]
export function validPublicName(value: unknown): value is string {
 return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 24 && !/[\x00-\x1f\x7f@]/.test(value)
}
export function canAdvance(from: OnboardingStep, to: unknown) {
 return (from === 'wallet' && (to === 'prediction' || to === 'done')) || (from === 'prediction' && to === 'done')
}
