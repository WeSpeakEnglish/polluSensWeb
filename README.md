# polluSensWeb  
[![Mentioned in Awesome](https://awesome.re/mentioned-badge.svg)](https://github.com/awesome-selfhosted/awesome-selfhosted#internet-of-things-iot)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Web Serial API](https://img.shields.io/badge/Web%20Serial%20API-Supported-green)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
[![Browser: Chrome](https://img.shields.io/badge/Browser-Chrome%20|%20Edge%20|%20Opera-orange)](https://caniuse.com/web-serial)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-Online-success)](https://wespeakenglish.github.io/polluSensWeb/)

**polluSensWeb** is a free and open-source browser-based tool for connecting and visualizing real air quality sensor data directly from UART devices via Web Serial API.
It is designed for education, teaching labs, and rapid IoT prototyping.
Try it out yourself: [here](https://wespeakenglish.github.io/polluSensWeb/) 

*"polluSensWeb" is an independent project. Any similarity to other software names is coincidental.*

<div align="center">
    
![Watch the video](https://github.com/WeSpeakEnglish/images/blob/main/pollusensweb1.7.gif)
 
</div>

## Features

- Live serial data acquisition
- Frame parsing with startByte / endByte / checksum
- **Multi-command support** - sequential command sequences with configurable repeats
- Dynamic charts with customizable signal style (color, thickness, tension)
- Multiple simultaneous charts
- Full CSV export (timestamp + all signals)
- Clearable log with raw serial packets and checksum result
- Configurable via external JSON file
- Supports webhooks
- Works offline after load (except webhooks)
- No external servers required

## Supported Sensors
The following sensors are currently supported by `polluSensWeb`:

1. **Panasonic SN-GCJA5**
2. **Honeywell HPMA115S0-XXX**
3. **Air Master AM7 Plus**
4. **Plantower PMSA003-S**
5. **Plantower PS3003A**
6. **Plantower PMS1003**
7. **Plantower PMS5003**
8. **Plantower PMS7003**
9. **Plantower PMS6003**
10. **Plantower PMS9103**
11. **Plantower PMS3003**
12. **Nova PM SDS011**
13. **Sensirion SPS30**
14. **SHUYI SY210**
15. **TERA NextPM** - thanks to Michael Lažan for testing! ([senzorvzduchu.cz](https://senzorvzduchu.cz/))
16. **SenseAir S8 004-0-0053**
17. **SenseAir S88 Residential**
18. **SenseAir S88 LP**
19. **SenseAir S88 GH**
20. **SenseAir K30**
21. **SenseAir K33**
22. **SenseAir eSENSE**
23. **SenseAir S8 004-0-0017**
24. **SenseAir K33 ICB**
25. **Sensirion SCD30**
26. **YYS DC01**
27. **YYS D01**
28. **YYS D01-P**
29. **YYS D9**
30. **YYS D3**
31. **YYS D5**
32. **YYS D7**
33. **YYS D7B**
34. **Winsen ZH03B** 
35. **Sensirion SEN63C** (via [KEL I2C to USB adapter](https://www.tindie.com/products/kel/usb-i2c-module/)) 
36. **Sensirion SCD41** via KEL I2C to USB adapter

...more coming soon!  
  
  
## Supported Browsers

Chrome ≥ 89  
Edge ≥ 89  
Brave ≥ 1.24  
**Opera ≥ 75**  
Other Chromium-based browsers with Web Serial API

*Web Serial API is not supported in Firefox / Safari.*

## How It Works

### Sensor Configuration

Sensor configuration is loaded from:

https://raw.githubusercontent.com/WeSpeakEnglish/polluSensWeb/refs/heads/main/sensors.json

Each sensor config defines:

- Serial port settings
- Frame structure:
  - `startByte`
  - `endByte`
  - `length`
  - `checksum.eval` and `checksum.compare`
- Command to send on connection
- `send_cmd_period`: send once or periodically
- Parsing expressions for each signal field

### Serial Communication Flow

1. User clicks **Connect** → serial port opened  
2. Initial command is sent (if configured)  
3. Incoming bytes are buffered  
4.  Frames are detected (startByte + endByte + length)  
5. Checksum is validated  
6. If valid:  
- Signals parsed  
- `updateCharts(parsedData)` called  
- Data appended to in-memory `collectedData`  
- Raw packet logged
  
7. If invalid → error logged

## User Interface

### Header Bar

- **Sensor Selector** → Choose sensor config from `sensors.json`
- **Connect / Disconnect** → Open or close serial connection
- **Clear Log** → Clear log area
- **Save CSV** → Export full collected data since connection

### Chart Controls

#### Create a Chart Section

- **Chart Name** → Title of chart  
- **Width / Height** → Chart dimensions in px
- **Chart datapoints** → Chart length in datapoints  
- **Signals Section** → List of available signals:
  - Checkbox to include signal
  - Color picker
  - Tension (line smoothness)
  - Thickness (line width)  
- **Create Chart** → Create chart with selected signals

### Charts Area

- Multiple charts can be created dynamically.
- Each chart:
  - X-axis → Time (seconds, real-time)
  - Y-axis → Signal values
  - Multiple signals supported
- Chart header:
  - Chart title
  - **❌** Cross button → removes chart

### Log Area

- Displays raw packets in hex.
- Shows checksum result (✅ pass / ❌ fail).
- User can clear log manually.

## CSV Export

When user clicks **Save CSV**:

- The `collectedData` array (one object per frame) is exported to CSV:
  - First column: `timestamp` (ISO 8601)
  - Remaining columns: all parsed signals
- Filename: 

polluSens_data_<timestamp>.csv

- CSV contains **all data collected since connection started**.

## Flow Summary

1. Load polluSensWeb → sensors loaded from `sensors.json`  
2. User selects sensor → signals list updates  
3. User clicks **Connect** → serial connection opened, command sent  
4. Incoming data is parsed, validated, displayed on charts, and logged  
5. User can:  
- Create / remove charts  
- Export full CSV at any time  
- Clear log as needed
  
6. User can disconnect anytime

## Upload Your Own Configuration

You can upload a custom JSON configuration using the **"Custom JSON Sensor Configuration"** input in the interface.

- Custom entries are marked with 🆕

## JSON Schema Overview

Top-level structure:

```json
{
  "sensors": [
    { /* sensor object */ },
    ...
  ]
}
```

Each sensor object describes how to read and interpret data from a UART-connected sensor.

---

## Sensor Object Fields

| Field             | Required | Type      | Description |
|------------------|----------|-----------|-------------|
| `name`           | yes       | string    | Unique sensor name (shown in dropdown) |
| `inherits_from`  | no       | string    | Name of another sensor to inherit from, ex. `"Plantower PMSA003-S"` |
| `command`        | no       | string    | Hex string to send during connection (e.g. `"7E 00 03 00 FC 7E"`) or `"none"` |
| `start_command`  | no       | string    | Hex string to send after connect event (e.g. `"7E 00 00 02 01 03 F9 7E"`). **Classic mode only** — ignored when `commands` array is present; use a `repeat: 0` command instead |
| `stop_command`   | no       | string    | Hex string to send on disconnect (e.g. `"7E 00 01 00 FE 7E"`). **Works in both classic and multi-command modes** — always sent on disconnect regardless of whether `command` or `commands` is used |
| `send_cmd_period`| no       | number    | If > 0, send `command` every N seconds, if = 0  - once |
| `commands`       | no       | array     | Array of command objects for multi-command sequences (see below) |
| `port`           | yes     | object    | fields: see below |
| `frame`          | yes     | object    | fields: see below |
| `data`           | yes     | object    | fields: see below |

### Port Object (port)

| Field             | Required | Type      | Description |
|------------------|----------|-----------|-------------|
| `baudRate`  | yes | integer | connection speed, ex. `9600`, `19200`, `115200` |
| `dataBits`  | yes | integer | bits in byte, typically `8` |
| `stopBits`  | yes | integer | stop bits quantity, typically `1` |
| `parity`    | yes | integer | parity, ex. `"none"`, `"even"`, `"odd"` |

### Frame Object Fields (frame)

| Field             | Required | Type      | Description |
|------------------|----------|-----------|-------------|
| `startByte`    | yes       | string | start byte or bytes, ex. `[66, 77]`, `["0x42", "0x4D"]`, `170`, `"0xAA"`, `"none"` |
| `endByte`      | yes       | string | multi-byte terminator; similar to `startByte` |
| `length` 	 | yes 	     | string | frame length including start and stop bytes, in bytestuffing case / after unstuffing |
| `stuffing`     | no        | object | contain stuffing pairs: what to find and what to place instead, ex. `["7D 5E", "0x7E"], ["7D 5D", "0x7D"]` |

### Checksum Object Fields (checksum)

| Field             | Required | Type      | Description |
|------------------|----------|-----------|-------------|
| `eval`    | yes       | string | valid JS expression, assuming data[i] is i-th byte in received buffer, ex. `"data.slice(1, 30).reduce((a, b) => a ^ b, 0)"` |
| `compare` | yes	| string | valid JS expression, assuming data[i] is i-th byte in received buffer, ex. data[30] |

### Data Object Fields (data)
Defines how to extract and interpret sensor readings from a binary data frame
Example:
```json
				"Some parameter": {
					"value": "((data[1] << 8) + data[2])>>>0",
					"unit": "μg/m³"
				},...
```

| Field             | Required | Type      | Description |
|------------------|----------|-----------|-------------|
| `value`    | yes       | string | valid JS expression, assuming data[i] is i-th byte in received buffer, ex.  "((data[1] << 8) + data[2])>>>0"|
| `unit`      | yes       | string | units like, ex. `"μg/m³"` |

### Command Object Fields (commands array)

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `command` | yes | string | Hex command string (e.g., `"1B 41 6B 57 00 52 03 53"`) |
| `id` | no | number | 0-based position index used by child sensors to override this command via inheritance (see [Per-command override](#per-command-override-in-multi-command-mode)) |
| `repeat` | no | number | `0` = init (run once), `≥1` = repeat N times per measurement cycle |
| `postDelay_ms` | no | number | Delay in milliseconds after command before next operation |
| `frame` | no | object | Frame specification for response parsing (same as main frame) |
| `checksum` | no | object | Checksum validation for response (same as main checksum) |
| `data` | no | object | Data extraction rules for response (same as main data) |

## Sensor Example (full JSON example, may be used like custom template)

```json
{
	"sensors": [
     {
			"name": "Honeywell HPMA115S0-XXX",
			"command": "none",
			"port": {
				"baudRate": 9600,
				"dataBits": 8,
				"stopBits": 1,
				"parity": "none"
			},
			"frame": {
				"length": 32,
				"startByte": [66, 77],
				"endByte": "none"
			},
			"data": {
				"PM2.5": {
					"value": "(data[6] << 8) + data[7]",
					"unit": "μg/m³"
				},
				"PM10": {
					"value": "(data[8] << 8) + data[9]",
					"unit": "μg/m³"
				}
			},
			"checksum": {
				"eval": "data.slice(0, 30).reduce((a, b) => (a + b) & 0xFFFF, 0)",
				"compare": "(data[30] << 8) + data[31]"
			}
		}
	]
}
```

## Inheritance with `inherits_from`

You can reuse and override parts of existing sensors:

```json
{
  "name": "Your New Sensor PM2.5",
  "inherits_from": "Plantower PMSA003",
  "data": {
    "Humidity": {
      "value": "(data[14] << 8) + data[5]",
      "unit": "%"
    }
  }
}
```

This example keeps all settings from `Plantower PMSA003` but adds a humidity value.  
  
  
## Multi-Command Support

polluSensWeb now supports complex sensor initialization and measurement sequences using the `commands` array. This is essential for sensors that require multiple commands to configure, calibrate, or read data.

### When to Use Multi-Command

- Sensors requiring initialization sequences (e.g., SCD30, SEN63C)
- Sensors with multiple measurement modes
- Sensors needing configuration before reading
- Complex sensors with calibration routines

### Command Structure

Each command in the `commands` array can have:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | yes | Hex command to send (e.g., `"1B 41 6B 57 00 52 03 53"`) |
| `frame` | object | no | Frame specification for response parsing |
| `checksum` | object | no | Checksum validation for response frame |
| `data` | object | no | Data extraction rules for response frame |
| `repeat` | number | no | 0 = init (run once), ≥1 = repeat N times per cycle |
| `postDelay_ms` | number | no | Delay in milliseconds after command execution |

### Multi-Command Flow

1. **Init Phase** (`repeat: 0`): Commands run once before measurement loop
2. **Measurement Cycle** (`repeat: ≥1`): Commands repeated continuously

### Multi-Command Behavior

**Init Commands** (`repeat: 0`):
- Run once when connection starts
- Used for sensor configuration, calibration, or setup
- Can include their own frame parsing

**Cycle Commands** (`repeat: ≥1`):
- Run continuously in a loop
- Each command can have its own repeat count and delay
- The entire cycle repeats while connection is active

**Frame Handling**:
- Each command can define its own frame structure
- Responses are parsed independently
- Data from any command can update charts

**`start_command` / `stop_command` in multi-command mode**:
- `start_command` is **not sent** when `commands` array is present — use a `repeat: 0` entry in `commands` for one-time init instead
- `stop_command` **is always sent** on disconnect, regardless of whether the sensor uses classic or multi-command mode

**Multi-command example:**
```json
{
  "commands": [
    {
      "command": "7E 00 03 00 FC 7E",
      "repeat": 1,
      "postDelay_ms": 50,
      "frame": { ... },
      "data": { ... },
      "checksum": { ... }
    },
	{
      "command": "67 00 05 00 FE 7E",
      "repeat": 1,
      "postDelay_ms": 50,
      "frame": { ... },
      "data": { ... },
      "checksum": { ... }
    }
  ]
}
```

### Per-command override in multi-command mode

When the parent sensor uses a `commands` array, a child sensor can override individual commands without repeating the entire array. Use the `id` field on a child command to specify which position (0-based) in the parent's `commands` array to merge into.

**Rules:**
- `id` is a 0-based integer index into the parent's `commands` array
- Only the fields listed in the child command are overridden; all other fields are inherited from the parent command
- A child command with no `id`, or with an `id` that is out of range, is **appended** as a new command after the inherited ones
- Parent commands need no `id` field — only child overrides use it

**Example:** parent defines two commands; child only changes `postDelay_ms` on the second one (`id: 1`):

```json
{
  "name": "MySensor Fast",
  "inherits_from": "MySensor",
  "commands": [
    { "id": 1, "postDelay_ms": 100 }
  ]
}
```

All other fields of command at position 1 (`command`, `frame`, `data`, `checksum`, `repeat`, etc.) are inherited unchanged from `MySensor`.

## Tips & Troubleshooting

- All `value`, `eval`, and `compare` fields are evaluated using JavaScript `eval()`.
- You can use decimal values (`66`) or hex strings (`"0x42"`) — **no raw hex like `0x42`**.
- If your JSON fails to load, check the browser log or validate at [https://jsonlint.com](https://jsonlint.com).
- For multi-command sensors, ensure proper `postDelay_ms` values to allow sensor processing time.
- Use `repeat: 0` for one-time initialization commands.
- Use `repeat: ≥1` for continuous measurement commands.

## Webhook Integration – polluSensWeb

polluSensWeb can send parsed sensor data to any HTTP webhook.  
Webhooks now support **placeholders** in both **body** and **headers**.

---

### Enabling Webhooks

1. Check **Enable Webhook Sending** in the Webhook card.
2. Enter your **Webhook URL**.
3. Select **HTTP Method** (`GET`, `POST`, `PUT`).
4. Set interval in **seconds** (0 = send on every packet).

---

### Headers

Headers can include placeholders, just like the body.  
Supported placeholders:

- `{{ts}}` – current timestamp (ISO format)  
- `{{field:<name>}}` – value of a specific sensor field  

#### Example Header Configuration

| Key        | Value             | Result Example               |
|-----------|-----------------|------------------------------|
| X-PM25    | {{field:PM2_5}}  | X-PM25: 12.3                 |
| X-TIME    | {{ts}}           | X-TIME: 2025-12-09T12:34:56Z|
| X-CUSTOM  | {{field:PM10}}   | X-CUSTOM: 20.1               |

Add headers using the **+ Add header** button.  

---

### Body Template

Body templates are **JSON-based**, supporting placeholders:

- `{{ts}}` – timestamp  
- `{{field:<signal name>}}` – sensor value  
- `{{#fields}} … {{/fields}}` – loop through all sensor fields  

#### Example Body passing all the fields

```json
{
  "software_version": "polluSensWeb 1.0",
  "timestamp": "{{ts}}",
  "sensordatavalues": [
  {{#fields}}
    { "value_type": "{{key}}", "value": "{{value}}" }
  {{/fields}}
  ]
}
```

#### Result Example

For a packet:

```text
PM1: 1.5, PM2.5: 12.3, PM10: 20.1
```

The processed body will be:

```json
{
  "software_version": "polluSensWeb 1.0",
  "timestamp": "2025-12-09T12:34:56.789Z",
  "sensordatavalues": [
    { "value_type": "PM1", "value": 1.5 },
    { "value_type": "PM2.5", "value": 12.3 },
    { "value_type": "PM10", "value": 20.1 }
  ]
}
```
#### Example Body passing specific field (sinal)

```json
{
	"software_version": "polluSensWeb 1.0",
	"timestamp": "{{ts}}",
	"sensordatavalues": [
	{"PM2.5": "{{field:PM2.5 x0.4 calibrated}}"}
	]
}
```

Here *PM2.5 x0.4 calibrated* is the signal (signal names you see in the form where you select them for chart at the top of UI), before [units],
for this example it was:
*PM2.5 x0.4 calibrated [μg/m³]*

---

### Sending Webhooks

- Click **Test Send Webhook Now** to test.
- Webhooks respect your interval setting. If interval = 0, every parsed packet triggers a request.

#### Example: Headers + Body Together

**Headers**

```
X-PM25: {{field:PM2.5}}
X-Time: {{ts}}
Content-Type: application/json
```

**Body**

```json
{
  "pm25": {{field:PM2.5}},
  "pm10": {{field:PM10}},
  "time": "{{ts}}"
}
```

**Processed Request Example**

```
POST https://webhook.site/xxxxxx
Headers:
  X-PM25: 12.3
  X-Time: 2025-12-09T12:34:56Z
  Content-Type: application/json
Body:
{
  "pm25": 12.3,
  "pm10": 20.1,
  "time": "2025-12-09T12:34:56Z"
}
```

### Notes

- Headers are processed through the **same template engine** as the body.
- Placeholders not found in the data will be replaced with `"null"` for fields.
- Rate-limit protection is active by default.

**Ready to use with any HTTP endpoint that accepts JSON or custom headers.**

## To Run Self-hosted

To run is selfhosted:
replace CORS proxy and sensor list addresses in **pollusensweb.js** (at the very top) with your actual addresses:
```js
const DEFAULT_SENSOR_LIST = "ADDRESS_TO_sensors.json"; 
const PROXY_URL = "ADDRESS_TO_proxy.php";
```

## To Run Locally

Extact release archive or open git clone, open index.html in browser and load JSON file **sensors.js** via Custom JSON Sensor Configuration in UI.

## See Also

- Default sensors: [`sensors.json`](https://raw.githubusercontent.com/WeSpeakEnglish/polluSensWeb/main/sensors.json)
- Project homepage: [pollutants.eu/sensor](https://pollutants.eu/sensor)
- Hackaday project:  [Connect any UART sensor in your browser](https://hackaday.io/project/203369-uart-air-pollution-sensor-in-browser-easy)
