# NibeReader — Heat Pump Monitoring with Codex, CLI & Mobile

Read Nibe heat-pump data through a mobile app, a command-line reader, or Codex.

The repository contains three independent components:

| Component | Connection | Purpose |
| --- | --- | --- |
| **NibeMCP** | Local Modbus TCP | Live readings and on-demand history collection through Codex |
| **ModbusNode** | Local Modbus TCP | Interactive command-line example |
| **React Native app** | myUplink API | Display heat-pump information on iOS and Android |

## Nibe MCP — use your heat pump from Codex

NibeMCP exposes heat-pump readings through the Model Context Protocol (MCP). Codex provides the client; the local MCP server connects to your pump.

You can ask Codex to:

- Read current outdoor, heating, hot-water, and brine temperatures.
- Read the requested compressor frequency.
- Start or stop history collection.
- Summarize stored readings and identify missing periods.
- Check the collector’s status.
- Summarize operation and compare temperature differences or two historical periods.
- Record local notes about maintenance or adjustments you made yourself.

The MCP integration is **read-only toward the heat pump**. It exposes no tools for changing heating settings.

### Requirements

- macOS with Node.js **22.18 or newer**.
- A compatible Nibe heat pump with Modbus TCP/IP enabled.
- Network access from your Mac to the pump.
- Codex configured to connect to the local MCP server.

The Modbus connection does not require a myUplink account or an OpenAI API key.

Before connecting, follow [Configure NIBE S-series for Modbus](docs/NIBE_S_SERIES_MODBUS_SETUP.md) to enable Modbus on the pump, find its IP address, and verify readings.

### Quick start

From the repository root:

```sh
cd NibeMCP
npm ci
npm run build
```

Add the server to Codex as a **STDIO MCP server**, using:

- The absolute path to your Node.js executable.
- The absolute path to `NibeMCP/dist/server.js` as its argument.
- `NIBE_HOST` set to your heat pump’s IP address or hostname.

See the [NibeMCP setup guide](NibeMCP/README.md) and [example Codex configuration](NibeMCP/codex-config.example.toml) for complete instructions.

After connecting, try:

> Read my heat pump’s current temperatures.

> Start collecting Nibe history.

> Show the outdoor and supply temperature trends for the last 24 hours, including gaps.

> Stop collecting Nibe history.

See [example conversations with Nibe MCP](NibeMCP/CONVERSATION_EXAMPLES.md) for prompts and explanations of what each tool does.

### Collection starts only when requested

Opening Codex, connecting the MCP server, or reading current values **does not start history collection**.

Once explicitly started, the collector:

- Runs independently of Codex.
- Samples every **60 seconds** by default.
- Stores history locally in SQLite.
- Retains **365 days** of readings by default.
- Continues after Codex closes while your Mac is awake and connected.

Sleep and network outages leave gaps in history. After a reboot or collector crash, collection remains stopped until explicitly started again. Stopping collection preserves existing history.

Sampling and retention are configurable.

### Available MCP tools

| Tool | Purpose |
| --- | --- |
| `check_device_health` | Report live alarms and compressor readings with historical cycling evidence |
| `list_metrics` | List available readings and units |
| `read_live` | Fetch current readings without starting collection |
| `start_collection` | Start local history collection |
| `stop_collection` | Stop collection and preserve history |
| `get_status` | Check collector state and historical coverage |
| `read_history` | Query stored readings, aggregates, and gaps |
| `summarize_operation` | Summarize stored readings with statistics and coverage |
| `analyze_temperature_delta` | Analyze aligned heating or brine temperature differences |
| `record_event` | Save a local note about an observation or action you already took |
| `list_events` | Retrieve local journal notes |
| `compare_periods` | Compare historical periods with outdoor-temperature context |

### Supported readings

The initial register profile includes:

- Outdoor temperature — BT1
- Supply temperature — BT2
- Return temperature — BT3
- Hot-water top temperature — BT7
- Hot-water charging temperature — BT6
- Brine inlet temperature — BT10
- Brine outlet temperature — BT11
- Requested and actual compressor frequency
- Active alarm, alarm number, operating priority, compressor status, starts and runtime

**Requested compressor frequency is not measured compressor speed.**

Register availability depends on the pump model, firmware, and installed sensors. Compare readings with the pump’s operating display before relying on them. See the [register profile and validation instructions](NibeMCP/README.md#register-profile-and-physical-validation).

## Modbus command-line example

`ModbusNode` contains the original interactive Node.js reader built with `jsmodbus`.

From the repository root:

```sh
cd ModbusNode
npm install
node index.js
```

Enter the pump’s IP address when prompted. The example reads outdoor temperature and requested compressor frequency over TCP port **502**.

See the [Modbus example source](ModbusNode/index.js).

## React Native app — myUplink

The mobile app uses the myUplink API to retrieve device information and data points.

The existing implementation accepts a **Client Identifier** and **Client Secret** from an application registered in the [myUplink developer portal](https://dev.myuplink.com/apps).

After preparing your React Native iOS or Android development environment, install dependencies from the repository root:

```sh
yarn install
yarn start
```

In another terminal, launch the desired platform:

```sh
yarn ios
# or
yarn android
```

Enter your credentials in the app and select **Connect**.

This is the original React Native 0.71 example. Its dependency and authentication setup should be checked against your current development environment and myUplink account.

## Development and tests

Each component manages its own dependencies. Installing packages in the repository root does not install NibeMCP or ModbusNode dependencies.

Run the MCP build and test suite with:

```sh
cd NibeMCP
npm ci
npm test
```

The MCP tests use simulated Modbus devices and temporary databases. They cover decoding, connection failures, malformed responses, history queries, and collector lifecycle behavior without connecting to your physical heat pump.

## Screenshots

The original React Native app and Modbus console example:

<img src="https://user-images.githubusercontent.com/54746036/225132449-71b3c88c-cdbe-4c88-b033-9117eeff6e20.png" alt="NibeReader React Native app" width="40%">

<img src="https://user-images.githubusercontent.com/54746036/226870992-411b8bb5-ed4b-40cc-9fe5-fc51c760d80c.png" alt="NibeReader Modbus console example" width="40%">

## Author

Tero Paananen
