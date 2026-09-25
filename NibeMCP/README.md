# Nibe MCP

Local, read-only access to a Nibe heat pump from Codex, with **explicitly started** history collection.

The MCP server is the adapter; Codex already supplies the MCP client. No OpenAI API key, myUplink account, cloud server, login item, LaunchAgent, or scheduled job is needed.

## Install and connect

Requires macOS and Node.js **22.18 or newer**, including `node:sqlite`. Node 22 may print an experimental SQLite warning to stderr; it does not affect the MCP protocol. This is an independent package: run these commands inside `NibeMCP`, not the React Native project root.

```sh
cd /Users/tepaanan/Developer/NibeReader/NibeMCP
npm ci
npm run build
```

Enable Modbus TCP/IP on the pump (the bundled S-series manual describes menu 7.5.9). Use the pump's actual local address, preferably with a DHCP reservation. Your Mac must be on the same reachable network or VPN.

In Codex's MCP settings, add a STDIO server named `nibe`. Use the absolute Node executable (`command -v node`), the absolute `dist/server.js` path as its argument, and `NIBE_HOST` as an environment variable. Alternatively add this to the Codex host's `~/.codex/config.toml`, replacing the host and Node path:

```toml
[mcp_servers.nibe]
command = "/usr/local/bin/node"
args = ["/Users/tepaanan/Developer/NibeReader/NibeMCP/dist/server.js"]
startup_timeout_sec = 10
tool_timeout_sec = 120

[mcp_servers.nibe.env]
NIBE_HOST = "YOUR_PUMP_IP"
NIBE_PORT = "502"
NIBE_UNIT_ID = "1"
NIBE_SAMPLE_SECONDS = "60"
NIBE_RETENTION_DAYS = "365"
```

Save and restart the MCP connection in Codex. Configuration is described in the [official Codex MCP documentation](https://developers.openai.com/codex/mcp/).

**Connecting does not start collection.** Try:

- "List the Nibe readings you can access."
- "Read the outdoor and supply temperatures now."
- "Start collecting Nibe history."
- "Is Nibe collection running?"
- "Show outdoor and supply temperature trends for the last 24 hours, and identify gaps."
- "Stop collecting Nibe history."

See [Talking to Nibe MCP](CONVERSATION_EXAMPLES.md) for example conversations covering summaries, temperature differences, event notes and comparisons. See [MCP request and data flow](MCP_FLOW.md) for architecture diagrams and the path each request takes through the server, collector, Modbus and local storage.

## Lifecycle

Only `start_collection` (or the explicit CLI `start` command) launches the detached collector. Reading values, querying history, opening Codex, or rebooting the Mac never starts it. Once started, it continues after Codex closes. Stopping preserves history.

The collector does not prevent Mac sleep. While asleep, shut down, or disconnected, readings are missing. A process still running resumes after wake, without catching up missed polls. After a crash or reboot it stays stopped until explicitly started again. History cannot be recovered for periods before collection began.

The collector writes readings to SQLite; MCP event tools write local journal notes to the same database. User-only Unix socket permissions restrict local IPC. Separate SQLite transactions act as OS-backed singleton and pump-access locks: process death releases them, and sleep does not cause false stale-lock expiry. Concurrent MCP sessions share the collector. Live reads use its current in-flight snapshot, or create a short-lived serialized Modbus connection when it is stopped. Live reads are not inserted into history.

The connection uses only Modbus function 04 (read input registers). Start/stop tools change local logging state, never the pump's settings. No write-register API is exposed.

## Configuration

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `NIBE_HOST` | unset | Required for live reads or starting collection |
| `NIBE_PORT` | `502` | Modbus TCP port |
| `NIBE_UNIT_ID` | `1` | Modbus unit ID, passed to the client constructor |
| `NIBE_SAMPLE_SECONDS` | `60` | Sampling interval, integer 1–86400 seconds |
| `NIBE_RETENTION_DAYS` | `365` | Retention, integer 1–3650 days |
| `NIBE_DATA_DIR` | `~/Library/Application Support/NibeMCP` | Private history, locks and collector log directory |

Set environment variables explicitly; `.env` files are not loaded automatically. Connection and request timeouts are five seconds. Complete failures retry with exponential backoff, capped at five minutes (and never faster than the configured interval for intervals below that cap). Calls are serialized; simultaneous collector reads share a snapshot. The IPC socket is in a short user-only directory under `/tmp` to fit macOS path-length limits.

Change collection settings by stopping the collector, updating the environment, and explicitly starting again. `get_status` includes the running collector's effective settings. A data directory is tied to its configured pump endpoint to avoid mixing histories; if that endpoint changes, restore the original address or use a new directory. Do not manually delete lock files while a process is running.

## Tools

| Tool | Inputs | Output |
| --- | --- | --- |
| `check_device_health` | optional `start`/`end`, `short_run_minutes`, `short_run_count` | Live alarm/compressor report with historical cycling evidence and limitations |
| `list_metrics` | none | Metric definitions, units, register IDs, validation status |
| `read_live` | optional `metric_ids` | Fresh readings, per-reading timestamp, raw/scaled value, quality/error |
| `start_collection` | none | Collector PID and effective settings; idempotent |
| `stop_collection` | none | Confirmation after polling ends and locks are released; idempotent |
| `get_status` | none | Running/stopped state, last poll/error/success, historical time bounds |
| `read_history` | `metric_ids`, `start`, `end`, optional `interval` | Raw readings or bucketed min/mean/max/counts, and explicit gaps |
| `summarize_operation` | `start`, `end`, optional `metric_ids` | Sample-weighted min/mean/max, first/last/change, counts, gaps and coverage |
| `analyze_temperature_delta` | `start`, `end`, `pair`: `heating` or `brine` | Aligned supply–return or brine inlet–outlet differences, unmatched counts and coverage |
| `record_event` | `timestamp`, `category`, `note` | A user-reported local journal entry; never a command to the pump |
| `list_events` | `start`, `end`, optional `category` | Up to 1,000 notes in chronological order, with a truncation flag |
| `compare_periods` | `before` and `after` objects with `start`/`end`, optional `metric_ids` | Both summaries and after-minus-before mean changes, including outdoor temperature |

History accepts ISO 8601 timestamps with `Z` or an explicit UTC offset and uses the half-open interval `[start, end)`. `interval` is an integer number of seconds. At most 1,000 points per metric are returned; larger raw requests aggregate automatically. Failed samples are excluded from numerical aggregates and counted separately. Empty buckets are omitted; `gaps` identifies missing coverage. Gap lists are capped at 1,000, with `gaps_truncated` when necessary.

A successful sample covers one configured sampling interval for coverage reporting. This is a sampling-coverage convention, not a claim that the measured value remained constant. No interpolation, fabricated zeros, or backfill is used. UTC storage avoids daylight-saving ambiguity. Expired rows are deleted on collection writes and excluded from queries even while collection is stopped. SQLite can retain reusable allocated disk space after pruning.

## Analysis and local journal

Analysis reads stored history without connecting to the pump or starting collection. Empty statistics are `null`, not zero. Coverage is calculated over the requested period, including unavailable or expired history; gap lists are capped at 1,000 with a truncation flag. Statistics use all retained successful samples, not averages of display buckets. First-to-last change describes observed endpoints, not a fitted trend.

Temperature differences pair readings one-to-one in timestamp order within five seconds and half of each reading's sampling interval. Their coverage is the overlap of the two successful sample intervals. Unmatched readings are counted and are not interpolated. Heating means supply minus return; brine means inlet minus outlet.

Period comparisons always include outdoor temperature for context. They do not normalize for weather or operating mode. Temperature indicators cannot establish COP, energy savings, faults, or causation. Requested compressor frequency does not establish actual compressor cycling.

`record_event` writes only local SQLite notes and is marked as a local write in MCP annotations. Categories contain 1–80 characters and notes 1–4,000 characters after trimming. Entries have unique IDs and creation timestamps; repeated calls create separate entries. Category filters match exactly. Notes are user reports, not verified setting changes, and are retained independently of readings. Existing databases gain the events table on their next local write; listing notes on an older database returns an empty list without migrating it.

## Register profile and physical validation

| Metric ID | Input register | Decoder | Divisor | Unit |
| --- | --- | --- | --- | --- |
| `outdoor_temperature` | 1 | signed 16-bit | 10 | °C |
| `supply_temperature` | 5 | signed 16-bit | 10 | °C |
| `return_temperature` | 7 | signed 16-bit | 10 | °C |
| `hot_water_top_temperature` | 8 | signed 16-bit | 10 | °C |
| `hot_water_charging_temperature` | 9 | signed 16-bit | 10 | °C |
| `brine_inlet_temperature` | 10 | signed 16-bit | 10 | °C |
| `brine_outlet_temperature` | 11 | signed 16-bit | 10 | °C |
| `requested_compressor_frequency` | 140 | unsigned 16-bit | 1 | Hz |

Temperature types are documented for S1155/S1255 in the bundled `docs/Modbus S-series EN M12676EN-1.pdf`, page 8. The repository's tab-delimited `ModbusNode/modbus_addresses_all.csv` supplies these addresses and identifies register 140 as requested frequency. Its type code 5 is treated as unsigned 16-bit in this narrow profile; verify it against the pump's current export. Addresses are passed unchanged, matching the existing reader; no 30001 offset is added.

These definitions have **not been validated against your physical pump**. Before relying on them:

1. Confirm the exact model/firmware and compare its exported register list with this profile.
2. Read live values and compare each installed sensor with menu 3.1, Operating info.
3. Check scaling and negative temperatures. Do not confuse requested frequency with current frequency (the older manual lists current frequency separately at 1046).
4. Treat unsupported registers and absent sensors as unavailable. Protocol exceptions return `unavailable`; network/parser failures return `error`. Device-specific sentinel values are not yet mapped, so a numeric response alone is not proof of an installed, valid sensor.

The tool catalogue deliberately keeps validation status as requiring comparison with the pump display. It does not infer physical validation from a successful response.

## Manual operation and removal

Use the same environment/data directory as the MCP configuration:

```sh
NIBE_HOST=YOUR_PUMP_IP node dist/cli.js status
NIBE_HOST=YOUR_PUMP_IP node dist/cli.js live outdoor_temperature
NIBE_HOST=YOUR_PUMP_IP node dist/cli.js start
NIBE_HOST=YOUR_PUMP_IP node dist/cli.js stop
```

`start` is an explicit request to collect. `status` and `stop` can also work without `NIBE_HOST` for the default data directory. To remove the integration, stop collection first, then remove the `nibe` MCP entry from Codex. There is no system startup service to uninstall. Keep the data directory to preserve history; deleting it is optional and should only be done after the collector stops.

## Development and verification

```sh
npm ci
npm test
```

Tests use ephemeral loopback Modbus simulators and temporary databases, never your pump. They check decoding, scaling, unit ID, read-only function codes, protocol exceptions, malformed/fragmented responses, timeouts, reconnects, history aggregation/retention/gaps, timezone handling, MCP discovery/calls, concurrent first starts, stopping, restart after a crash, and collection surviving MCP-client shutdown. SIGSTOP/SIGCONT simulates process suspension; an actual Mac sleep/reboot and physical-display comparison remain manual acceptance checks.

No collector is started by installation, build, or normal server startup. Test collectors are explicitly started in isolated temporary directories and stopped during cleanup.

## Alarm and compressor health report

Ask: **“Check my NIBE alarms and compressor health for the last 24 hours.”**

`check_device_health` combines fresh live readings with retained compressor history and returns both a readable report and structured evidence. Its target is the user-reported **S1255-12, software 4.13.12**; this metadata is not automatic model detection or proof of physical validation. It covers alarms, operating priority, actual frequency, status, starts, runtime and observed cycling. No collection, alarm reset or pump setting change is triggered.

Inputs are optional `start` and `end` (supply both as timezone-qualified ISO timestamps; default: preceding 24 hours), `short_run_minutes` (greater than 0 through 60; default 10), and `short_run_count` (integer 2–1000; default 3). Historical data is queried over `[start,end)`; live readings always describe now even when a past period is requested.

New function-04 input readings:

| Metric ID | Register | Type / scaling |
| --- | --- | --- |
| `active_alarm` | 2195 | u8; 0 no alarm, 1 active |
| `alarm_number` | 1975 | u16; untranslated reported code |
| `operating_priority` | 1028 | u8; 10 off, 20 hot water, 30 heating, 40 pool, 60 cooling |
| `actual_compressor_frequency` | 1046 | u16 / 10 Hz |
| `compressor_status` | 1100 | u8; 0 off, 1 on |
| `compressor_starts` | 1083 | s32; starts |
| `compressor_runtime` | 1087 | s32; hours |

Definitions follow [NIBE Modbus technical information](https://professional.nibe.eu/document/Technical%20information%20%28TIF%29/M12676EN.pdf). Counters read two registers in one request, with the low word first and big-endian bytes within each word. Unknown state codes remain numeric with an `Unknown` label. Unsupported readings remain unavailable. Requested frequency at register 140 remains a separate metric.

Each report section uses `no concerns observed`, `needs attention`, or `insufficient data`, and retains incomplete-data indicators alongside findings. The active-alarm flag establishes alarm presence; the alarm number is not an exhaustive list. An unknown code is shown without an invented description, with a link to NIBE's alarm lookup.

Cycling uses on/off history, not requested frequency. Complete runs require observed off-to-on and on-to-off transitions without failures or sampling gaps. The duration bounds reflect uncertainty between samples. A possible short-cycling warning requires at least three runs whose upper duration bounds are strictly below ten minutes in a fully observed rolling hour, at a cadence and actual spacing no greater than 60 seconds. The thresholds are configurable observations, not NIBE fault limits. A reassuring cycling result requires at least 24 hours, 90% valid status coverage, sampling no coarser than 60 seconds, and observed operation. Inactivity alone is not a fault. Missing history, incomplete runs, and gaps do not become fabricated starts or runtime.

Counter differences use observed endpoints and report their elapsed time. Any observed decrease or negative counter invalidates that counter's difference as a possible reset. Whole-hour runtime resolution limits short-period interpretation; unobserved resets cannot be ruled out. Detailed run, warning-window and gap lists are capped at 1,000 with truncation flags.

After upgrading, reconnect the MCP server. An already-running older collector lists missing metric capabilities in `get_status`; affected live readings explain that you must explicitly stop and restart collection to load the new profile. Existing history is preserved, and new metrics have no history until collected. Collection still starts only when requested.

### Physical acceptance on your pump

Compare actual frequency, on/off state, total starts, runtime, current priority and alarm state against the operating display. Compare the definitions with the pump's register export from menu 7.5.9. Check both running and idle observations when naturally available; do not induce an alarm for testing. Until these comparisons are completed, the report always declares the profile physically unverified. This report cannot certify mechanical condition.
