# Cumulative Activity Line Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the activity dot map with a smoothed cumulative commit chart whose daily points reveal both daily commits and the running total.

**Architecture:** Add a small dependency-free chart math module for date normalization, cumulative series generation, and monotone SVG path construction. Keep DOM rendering and interactions in `widget.html`, using the pure module from both the renderer and Node contract tests. Package the module with Electron, then verify hover, keyboard, resize, and live cached data in the installed app.

**Tech Stack:** Electron, vanilla JavaScript, inline SVG, Node.js `assert`, existing contract and live integration test runners.

## Global Constraints

The chart range must use the oldest and most recent retrieved commit dates, filling every calendar day between them.

The plotted value must be cumulative and never descend; zero-commit days create plateaus.

Every day must retain its daily commit count for hover and keyboard inspection.

The implementation must add no runtime dependency and must preserve the existing dark GitHub-inspired widget visual system.

The tooltip must show formatted date, daily commits, and cumulative commits.

---

### Task 1: Chart data and path helpers

**Files:**
- Create: `activity-chart.js`
- Modify: `tests/contract.test.js`

**Interfaces:**
- Produces: `ActivityChart.buildCumulativeSeries(eventsByDate)` returning `{ date, daily, cumulative }[]`.
- Produces: `ActivityChart.buildMonotonePath(points)` returning an SVG path string for `{ x, y }[]`.
- Produces: `ActivityChart.buildAreaPath(points, baselineY)` returning a closed SVG area path.
- Produces: `ActivityChart.formatChartDate(dateString)` returning a short UTC display date.

- [ ] **Step 1: Write failing tests for sparse-to-daily cumulative conversion**

Add contract tests that require sorted date output, inserted zero-commit days, stable cumulative totals on plateaus, rejection of invalid/non-positive counts, and an empty result for empty input.

- [ ] **Step 2: Run the focused contract suite and verify RED**

Run: `node tests/contract.test.js`

Expected: FAIL because `activity-chart.js` and `buildCumulativeSeries` do not exist.

- [ ] **Step 3: Implement the date and cumulative helpers**

Create `activity-chart.js` as a UMD-style module that assigns `module.exports` in Node and `window.ActivityChart` in the renderer. Normalize date keys in UTC, find the minimum and maximum valid positive-count dates, fill all intervening dates, and calculate running totals.

- [ ] **Step 4: Add failing tests for the smooth path**

Require a path beginning with `M`, using cubic `C` commands for multi-point series, preserving one-point and two-point edge cases, and keeping generated control-point y-values within adjacent cumulative values.

- [ ] **Step 5: Implement monotone path and area helpers**

Use monotone cubic Hermite interpolation with constrained tangents. Convert Hermite segments to cubic Bézier commands and close the area path to the supplied baseline.

- [ ] **Step 6: Run tests and commit**

Run: `npm test`

Expected: all contract tests pass.

Commit: `feat: add cumulative activity chart helpers`

---

### Task 2: SVG chart rendering and interaction

**Files:**
- Modify: `widget.html`
- Modify: `tests/contract.test.js`

**Interfaces:**
- Consumes: `window.ActivityChart.buildCumulativeSeries`, `buildMonotonePath`, `buildAreaPath`, and `formatChartDate`.
- Produces: `buildActivityMap(eventsByDate)` rendering the complete interactive SVG.

- [ ] **Step 1: Write failing renderer contract tests**

Require `activity-chart.js` to load before the inline widget script, SVG markup with an accessible label, gradient area, cumulative line, daily point markers, oldest/latest date elements, pointer-nearest-day interaction, and left/right keyboard navigation.

- [ ] **Step 2: Run the focused contract suite and verify RED**

Run: `node tests/contract.test.js`

Expected: FAIL because the widget still renders grid cells and month labels.

- [ ] **Step 3: Replace activity markup and styles**

Replace `month-labels`, grid-map markup, and the intensity legend with a two-ended date row and a responsive chart host. Add restrained styles for guide lines, cumulative area, line, markers, active marker, vertical guide, keyboard focus, and reduced motion.

- [ ] **Step 4: Replace `buildActivityMap` with SVG rendering**

Build a 120px-high SVG from the continuous cumulative series. Scale x across every day, scale y from zero to the final cumulative total, render three horizontal guides, the area path, line path, subtle daily markers, active marker, and active vertical guide.

- [ ] **Step 5: Implement tooltip and keyboard behavior**

On pointer movement, select the nearest x-index and show the selected date, daily commits, and cumulative total. On chart focus, select the most recent day; ArrowLeft and ArrowRight move selection. Clamp the tooltip inside the Electron window and use `aria-live="polite"`.

- [ ] **Step 6: Implement empty, one-day, and resize behavior**

Show a quiet empty state for no activity, center a single-day point, and retain one `ResizeObserver` that rebuilds the chart from the latest activity data without leaking observers.

- [ ] **Step 7: Run tests and commit**

Run: `npm test`

Expected: all contract tests pass.

Commit: `feat: render cumulative commit activity chart`

---

### Task 3: Package, documentation, and installed runtime verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `screenshots/widget.png`

**Interfaces:**
- Consumes: completed renderer and `activity-chart.js`.
- Produces: version `1.0.7` installer and an installed app matching the verified source.

- [ ] **Step 1: Package the chart module**

Add `activity-chart.js` to the Electron Builder `files` list and bump package metadata to `1.0.7`.

- [ ] **Step 2: Update user-facing documentation**

Replace activity heatmap wording with cumulative activity chart wording, document daily hover values, add the `1.0.7` changelog entry, and refresh the README screenshot from the real app.

- [ ] **Step 3: Run complete verification**

Run: `npm run test:all`

Expected: contract tests and all 28 live GitHub integration tests pass.

Run: `node --check main.js && node --check preload.js && node --check sync-window.js && node --check activity-chart.js`

Expected: all commands exit zero.

Run: `npm run build`

Expected: `dist\GitHub Widget Setup 1.0.7.exe` is created successfully.

- [ ] **Step 4: Install and verify the real Electron renderer**

Install version `1.0.7` per-user, launch with a temporary remote-debugging port, and inspect the active renderer. Confirm that the date labels equal the first and last cached commit dates, the number of daily points equals the inclusive calendar span, the SVG cumulative path never visually descends, hover shows daily and cumulative values, ArrowLeft changes the selected day, and no console errors occur.

- [ ] **Step 5: Capture the real widget and verify packaging**

Run the existing screenshot capture workflow and replace `screenshots/widget.png`. Compare hashes for `main.js`, `preload.js`, `sync-window.js`, `activity-chart.js`, and `widget.html` between source and the installed `app.asar`.

- [ ] **Step 6: Commit**

Run: `git status --short`

Expected: only the intended package, documentation, and screenshot files are modified.

Commit: `chore: ship cumulative activity chart`
