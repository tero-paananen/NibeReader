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

> Calculate my COP, energy bill, or compressor start count.

The current register profile does not provide the measurements needed for those calculations. Requested compressor frequency is not measured speed or a reliable start counter. Codex should explain the missing inputs rather than estimate them from temperature readings.

## Dates and missing data

Use a date, time and timezone when an event or comparison needs precision. For “yesterday” or daylight-saving transitions, Codex should resolve the intended local period and supply ISO 8601 timestamps with `Z` or explicit offsets. All ranges include their start and exclude their end.

When history is empty, Codex should say so. It can explain how to start collection, but must wait for your explicit request before starting it.
