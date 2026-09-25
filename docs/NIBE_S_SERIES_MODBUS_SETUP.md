# Configure NIBE S-series for Modbus

Use this guide to prepare your heat pump for NibeMCP's local Modbus connection. The integration reads measurements only; it does not change heating or hot-water settings.

No myUplink account, Client Identifier, Client Secret or OpenAI API key is needed for NibeMCP. The myUplink credentials mentioned in the main README belong to the separate React Native mobile app.

## 1. Connect the pump to your network

On the pump's touchscreen, open **menu 5.2 — Network settings** and configure Wi-Fi or Ethernet. Connect your Mac to a network that can reach the pump.

## 2. Enable Modbus

Open **menu 7.5.9 — Modbus TCP/IP** and enable **Activated**.

If available, enable **Reading Modbus only**. This restricts the pump interface to reading values and matches NibeMCP's behavior.

If you enable **IP address restriction**, enter your **Mac's local IP address**, not the pump's address. Menu options may vary with model and firmware.

## 3. Find the pump's address

Open **menu 3.1.13 — Connections** and note the pump's IP address. Modbus uses TCP port **502**.

These pump instructions follow [NIBE's official Modbus S-series guide, pages 6–7](https://professional.nibe.eu/document/Technical%20information%20%28TIF%29/M12676EN.pdf). It specifies software version 2.2.1 or later and connections from private local IP ranges.

## 4. Configure NibeMCP

Follow the [NibeMCP installation guide](../NibeMCP/README.md#install-and-connect) to build and register the server. In its environment configuration, set `NIBE_HOST` to the address you found on the pump:

```toml
[mcp_servers.nibe.env]
NIBE_HOST = "192.168.1.50"
NIBE_PORT = "502"
NIBE_UNIT_ID = "1"
NIBE_SAMPLE_SECONDS = "60"
NIBE_RETENTION_DAYS = "365"
```

`192.168.1.50` is an example; replace it with your pump's address. Edit the existing environment section if present instead of adding a duplicate. Keep the server command and arguments from your existing configuration or the [complete example](../NibeMCP/codex-config.example.toml).

`NIBE_UNIT_ID = "1"` is this project's default. It is not an IP address or a credential.

Reconnect the MCP server after updating its configuration.

## 5. Verify readings

Ask Codex:

> Read my outdoor, supply and return temperatures now.

Compare the values with **menu 3.1 — Operating info**, as NIBE recommends. A successful response alone does not confirm that every register matches your model and installed sensors.

Live reads do not start history collection. To begin recording, explicitly ask:

> Start collecting Nibe history.

For more prompts, see [Talking to Nibe MCP](../NibeMCP/CONVERSATION_EXAMPLES.md).

## Optional: export your register list

Insert a USB drive into the display unit. In **menu 7.5.9**, select **Export all registers** to save a CSV describing available registers. NIBE documents this procedure on page 6 of the guide linked above.

Exporting the list does not automatically update NibeMCP's supported metrics. Use it when checking the [register profile](../NibeMCP/README.md#register-profile-and-physical-validation) against your installation.

## If the connection fails

| Symptom | Check |
| --- | --- |
| No response or timeout | Confirm Modbus is activated, the pump IP is correct, and the Mac can reach TCP port 502. Check network isolation and firewall rules. |
| Connection blocked with IP restriction enabled | Confirm the trusted address is the Mac's current local IP. |
| Connection stops working after a network change | Recheck both addresses and update `NIBE_HOST` or the trusted-IP setting as needed. |
| A metric is unavailable | Check the model-specific register export and whether that sensor is installed. |
| Readings work but history is empty | Explicitly start collection; earlier data cannot be recovered. |

NibeMCP ties a data directory to a pump endpoint. If a changed address causes an endpoint-mismatch error, follow the [data-directory guidance](../NibeMCP/README.md#configuration) before resuming collection.
