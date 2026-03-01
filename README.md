# cc-focus

> Are you spreading too thin across projects? Weekly project scatter trends.

```
  cc-focus — project scatter per week (last 8 weeks)

  Week         Projects  Sessions   Hours  Scatter
  ─────────────────────────────────────────────────────────────────
  Feb 1               4        22    1.0h  ████████████████████
                flame, namakusa, test, tmp
  Feb 8               1         7    0.2h  █████░░░░░░░░░░░░░░░
                brain
  Feb 15              2        39   17.3h  ██████████░░░░░░░░░░
                cascade, namakusa
  Feb 22              1        16    4.8h  █████░░░░░░░░░░░░░░░
                namakusa
  ─────────────────────────────────────────────────────────────────

  Summary
    Avg projects/week  2.0
    Focus trend        converging (-40%)
    Style              Deep coder 🎯
```

## Usage

```bash
npx cc-focus           # Last 8 weeks
npx cc-focus --weeks=4 # Custom window
npx cc-focus --json    # JSON output for piping
```

## What it measures

Groups your `~/.claude/projects/**/*.jsonl` sessions by week, and counts how many distinct projects you used Claude Code in each week.

- **Low scatter (1-2 projects)** — you're in deep focus mode
- **Medium scatter (3-5 projects)** — balanced: building + maintaining
- **High scatter (6+ projects)** — context switching mode

The **trend** shows if you're converging (getting more focused over time) or diverging (spreading into more projects). Diverging isn't bad — it might mean you're exploring. But if you want to ship, converging matters.

Sessions over 8 hours are excluded (autonomous overnight runs).

## Part of cc-toolkit

One of [36 free tools](https://yurukusa.github.io/cc-toolkit/) for understanding your Claude Code usage.

## License

MIT
