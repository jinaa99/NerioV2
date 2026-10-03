export const retryableJobStatuses = ['failed', 'cancelled'] as const;

export function retryAttempt(status: string, currentAttempt: number): number | null {
  return retryableJobStatuses.includes(status as (typeof retryableJobStatuses)[number]) && Number.isInteger(currentAttempt) && currentAttempt > 0
    ? currentAttempt + 1
    : null;
}
