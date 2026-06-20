(function initActivityChart(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ActivityChart = api;
})(typeof window !== 'undefined' ? window : globalThis, function createActivityChart() {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function parseDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
  }

  function buildCumulativeSeries(eventsByDate) {
    if (!eventsByDate || typeof eventsByDate !== 'object') return [];

    const dailyCounts = new Map();
    for (const [date, rawCount] of Object.entries(eventsByDate)) {
      const timestamp = parseDateKey(date);
      const count = Math.floor(Number(rawCount));
      if (timestamp === null || !Number.isFinite(count) || count <= 0) continue;
      dailyCounts.set(timestamp, count);
    }

    const timestamps = [...dailyCounts.keys()].sort((a, b) => a - b);
    if (timestamps.length === 0) return [];

    const series = [];
    let cumulative = 0;
    for (let timestamp = timestamps[0]; timestamp <= timestamps.at(-1); timestamp += DAY_MS) {
      const daily = dailyCounts.get(timestamp) || 0;
      cumulative += daily;
      series.push({
        date: new Date(timestamp).toISOString().slice(0, 10),
        daily,
        cumulative
      });
    }
    return series;
  }

  function formatNumber(value) {
    const rounded = Math.round(value * 1000) / 1000;
    return Object.is(rounded, -0) ? '0' : String(rounded);
  }

  function buildMonotonePath(points) {
    if (!Array.isArray(points) || points.length === 0) return '';
    if (points.length === 1) return `M ${formatNumber(points[0].x)} ${formatNumber(points[0].y)}`;
    if (points.length === 2) {
      return `M ${formatNumber(points[0].x)} ${formatNumber(points[0].y)} L ${formatNumber(points[1].x)} ${formatNumber(points[1].y)}`;
    }

    const secants = [];
    for (let index = 0; index < points.length - 1; index++) {
      const dx = points[index + 1].x - points[index].x;
      secants.push(dx === 0 ? 0 : (points[index + 1].y - points[index].y) / dx);
    }

    const tangents = [secants[0]];
    for (let index = 1; index < points.length - 1; index++) {
      const previous = secants[index - 1];
      const next = secants[index];
      tangents.push(previous === 0 || next === 0 || Math.sign(previous) !== Math.sign(next)
        ? 0
        : (previous + next) / 2);
    }
    tangents.push(secants.at(-1));

    let path = `M ${formatNumber(points[0].x)} ${formatNumber(points[0].y)}`;
    for (let index = 0; index < points.length - 1; index++) {
      const current = points[index];
      const next = points[index + 1];
      const dx = next.x - current.x;
      const low = Math.min(current.y, next.y);
      const high = Math.max(current.y, next.y);
      const clampY = value => Math.min(high, Math.max(low, value));
      const controlX1 = current.x + dx / 3;
      const controlX2 = next.x - dx / 3;
      const controlY1 = clampY(current.y + tangents[index] * dx / 3);
      const controlY2 = clampY(next.y - tangents[index + 1] * dx / 3);

      path += ` C ${formatNumber(controlX1)} ${formatNumber(controlY1)} ${formatNumber(controlX2)} ${formatNumber(controlY2)} ${formatNumber(next.x)} ${formatNumber(next.y)}`;
    }
    return path;
  }

  function buildAreaPath(points, baselineY) {
    const linePath = buildMonotonePath(points);
    if (!linePath) return '';
    const first = points[0];
    const last = points.at(-1);
    return `${linePath} L ${formatNumber(last.x)} ${formatNumber(baselineY)} L ${formatNumber(first.x)} ${formatNumber(baselineY)} Z`;
  }

  function formatChartDate(dateString) {
    const timestamp = parseDateKey(dateString);
    if (timestamp === null) return '';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(timestamp));
  }

  return {
    buildCumulativeSeries,
    buildMonotonePath,
    buildAreaPath,
    formatChartDate
  };
});
