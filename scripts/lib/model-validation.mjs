// A missing stored probability is not a finite prediction. Number(null) and
// Number('') both produce zero, which would silently contaminate a common
// holdout comparison if this guard only called Number.isFinite.
export function isFiniteProbability(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}
