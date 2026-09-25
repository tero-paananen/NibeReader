# Talking to Nibe MCP

Use these prompts after connecting NibeMCP to Codex. Codex translates your requests into MCP tool calls and explains the returned data. These are example conversations, not readings from your pump.

**Modbus access is read-only.** No tool changes heating settings, hot-water settings, or any other pump configuration. Starting collection changes local logging only. Recording an event saves a local note only.

## See what is happening now

> What Nibe readings can you access?

Codex uses `list_metrics` to show available sensors and units.

> Read my outdoor, supply and return temperatures now.

Codex uses `read_live`. This does not start collection or save a historical sample. Unsupported readings and errors should be reported explicitly.

## Build history

> Start collecting Nibe history.

Codex uses `start_collection` only after this explicit request. Collection continues while your Mac is awake and connected, even after Codex closes.

> Is collection running, and how much history do I have?

Codex uses `get_status`. There is no history from before collection began; sleep and connection outages can leave gaps.

> Stop collecting history.

Codex uses `stop_collection`. Existing readings and notes remain available.

## Understand a day

> Summarize yesterday's outdoor, supply, return and hot-water temperatures. Use Europe/Helsinki time and include missing data.

Codex converts the local day into explicit timezone timestamps and uses `summarize_operation`. Results include sample counts, minimum/mean/maximum, first and last readings, first-to-last change, and coverage. First-to-last change is a descriptive difference, not a fitted trend or diagnosis.

> Show the supply and return temperature trends during that period.

Codex uses `read_history` for time-series detail. Neither request starts collection.

## Check alarms and compressor health

> Check my NIBE S1255-12 alarms and compressor health for the last 24 hours.

Codex uses `check_device_health`. The report combines fresh alarm, operating-priority and compressor readings with stored history. It shows actual compressor frequency, on/off status, cumulative starts and runtime, historical counter differences, observed runs and data coverage. It neither starts collection nor saves its live readings to history.

Each section reports **no concerns observed**, **needs attention**, or **insufficient data**, with supporting evidence. An active alarm can require attention even when compressor history is incomplete. The reported alarm number is not an exhaustive fault list; unknown codes remain untranslated, with a link to NIBE's alarm lookup.

The report targets the user-reported S1255-12 with software 4.13.12. Its register readings still need comparison with the pump display and register export. A successful read or “no concerns observed” result does not certify mechanical health.

> Check compressor behavior yesterday, using Europe/Helsinki time. Include any gaps and explain the run durations.

Codex supplies both `start` and `end` as explicit timezone timestamps. Historical analysis covers that period, while live alarms and operating state still describe now. Complete observed runs require off-to-on and on-to-off transitions without gaps or failed samples; runs cut off by the period boundaries are excluded. Reported durations are bounds reflecting sampling uncertainty.

> Is there evidence of frequent short cycling? Show the rule you used.

By default, the report flags **possible frequent short cycling** when at least three complete runs have duration upper bounds strictly below ten minutes within a fully observed rolling hour. That hour requires valid status samples with cadence and actual spacing no greater than 60 seconds. This is a conservative heuristic, not a NIBE fault limit or confirmed compressor fault.

> Repeat the report using a short-run threshold of 8 minutes and at least 4 runs within an hour.

Codex uses `short_run_minutes: 8` and `short_run_count: 4`. These inputs change report interpretation only, not pump settings or collection frequency.

A reassuring cycling assessment requires at least 24 hours, 90% valid status coverage, sufficiently frequent samples and observed operation. Gaps or coarse sampling can make the assessment insufficient. An idle compressor alone is not a fault.

> Read the actual compressor frequency, total starts and total runtime now.

Codex uses `read_live` with `actual_compressor_frequency`, `compressor_starts` and `compressor_runtime`. Actual frequency is separate from requested frequency. Historical counter differences use observed endpoints and show their elapsed period; decreases invalidate the affected difference as a possible reset. Runtime counters have whole-hour resolution.

> Why does the health report say that readings are unavailable or history is insufficient?

Codex explains the returned errors and coverage, using `get_status` to check collector capabilities when appropriate. New readings have no history until collected. An older running collector reports missing metrics and requires an explicit stop/start after the MCP server has been updated and reconnected. Unsupported registers remain unavailable; restarting cannot make an unsupported register valid.

> Stop collection, then start it again to load the new readings. Preserve my existing history.

This explicitly authorizes `stop_collection` followed by `start_collection`. Existing history remains available. A health-check request alone never authorizes this restart or starts collection.

## Compare temperature differences

> What was the supply minus return temperature difference over the last 24 hours? How complete is the data?

Codex uses `analyze_temperature_delta` with `pair: heating`.

> Show the brine inlet minus outlet temperature difference for the same period.

Codex uses `pair: brine`. Sensors are read sequentially: the tool pairs readings one-to-one within five seconds and half of each sample's collection interval. It reports unmatched samples and uses only overlapping successful sample intervals for coverage. It does not interpolate across missing readings.

These temperature differences alone do not measure COP or establish that the pump is operating efficiently or has a fault.

## Record something you already did

> I changed the heating curve myself today at 10:00 Helsinki time. Save a note under “setting_adjustment”: changed curve from 5 to 4.

Codex uses `record_event` to save the timestamp, category and your note in local SQLite. It should confirm that it recorded your report, not that it changed or verified the pump's settings.

> Record that I cleaned the filter today at 14:30 Helsinki time under “maintenance”.

> Show my maintenance notes from this month.

Codex uses `list_events` for the last request. Categories are free text and filters match exactly. Notes remain stored independently of reading retention. Repeating a recording request creates another note.

## Compare before and after

> Find my latest heating-curve adjustment note. Compare supply and return temperatures during the three days before and three days after it. Include outdoor conditions and data coverage.

Codex uses `list_events`, then `compare_periods` with two explicit time ranges. If the note's date is unknown, it can ask for a date range. If three days have not yet passed, it should explain that the after-period is incomplete.

The comparison includes outdoor temperature even when you select only other metrics. Mean changes are after minus before. This provides weather context but does not normalize for weather, hot-water demand, or operating mode. Different conditions or missing readings can make the comparison inconclusive; a difference does not prove the adjustment caused it.

## Ask about limits

> Can you change my heating curve?

The server cannot change it. If you make a change yourself, you can ask Codex to record a note afterward.

> Calculate my COP or energy bill.

The current register profile does not provide the measurements needed for those calculations. Codex should explain the missing inputs rather than estimate them from temperature readings. Compressor starts are available through their dedicated counter; requested compressor frequency is not measured speed or a reliable start counter.

## Dates and missing data

Use a date, time and timezone when an event or comparison needs precision. For “yesterday” or daylight-saving transitions, Codex should resolve the intended local period and supply ISO 8601 timestamps with `Z` or explicit offsets. All ranges include their start and exclude their end.

When history is empty, Codex should say so. It can explain how to start collection, but must wait for your explicit request before starting it.
