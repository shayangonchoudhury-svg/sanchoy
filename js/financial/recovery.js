// Negative Virtual Balance Recovery Estimator
// Calculates estimated days required to recover from deficit based on daily automatic allocation.

/**
 * Calculates estimated recovery days for a negative virtual wallet.
 * @param {number} balance - Current virtual wallet balance (can be negative)
 * @param {number} dailyAllocation - Active daily automatic virtual allocation for this wallet
 * @returns {{
 *   isNegative: boolean,
 *   deficit: number,
 *   recoveryDays: number | null,
 *   dailyAllocation: number,
 *   isRecoverable: boolean,
 *   message: string
 * }}
 */
export function calculateRecoveryEstimate(balance, dailyAllocation) {
  const numBalance = Number(balance) || 0;
  const numDaily = Number(dailyAllocation) || 0;

  if (numBalance >= 0) {
    return {
      isNegative: false,
      deficit: 0,
      recoveryDays: 0,
      dailyAllocation: numDaily,
      isRecoverable: true,
      message: 'Virtual balance is positive.'
    };
  }

  const deficit = Math.abs(numBalance);

  if (numDaily <= 0) {
    return {
      isNegative: true,
      deficit,
      recoveryDays: null,
      dailyAllocation: 0,
      isRecoverable: false,
      message: 'Recovery estimate unavailable: Daily virtual allocation is 0.'
    };
  }

  // Formula: recoveryDays = ceil(abs(negativeBalance) / dailyAllocation)
  const recoveryDays = Math.ceil(deficit / numDaily);

  return {
    isNegative: true,
    deficit,
    recoveryDays,
    dailyAllocation: numDaily,
    isRecoverable: true,
    message: `Estimated recovery in ${recoveryDays} day${recoveryDays === 1 ? '' : 's'} (assuming no additional spending).`
  };
}
