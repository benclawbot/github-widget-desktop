const DAY_MS = 24 * 60 * 60 * 1000;

function buildSyncWindow(lastSync, now = new Date()) {
  const untilDate = new Date(now);
  if (Number.isNaN(untilDate.getTime())) {
    throw new TypeError('now must be a valid date');
  }

  const previousDate = lastSync ? new Date(lastSync) : null;
  const hasValidPreviousDate =
    previousDate &&
    !Number.isNaN(previousDate.getTime()) &&
    previousDate < untilDate;

  const sinceDate = hasValidPreviousDate
    ? new Date(previousDate.getTime() + 1)
    : new Date(untilDate.getTime() - (90 * DAY_MS));

  return {
    since: sinceDate.toISOString(),
    until: untilDate.toISOString(),
    incremental: Boolean(hasValidPreviousDate)
  };
}

module.exports = { buildSyncWindow };
