# polluSensWeb

**polluSensWeb** is a lightweight web-based serial interface and charting tool for visualizing and logging data from UART pollution sensors (PM2.5, VOC, etc).
Try it out yourself: [here](https://wespeakenglish.github.io/polluSensWeb/) 


<img src="https://raw.githubusercontent.com/WeSpeakEnglish/images/main/pollusensweb_one.png" alt="polluSensWeb" align="center">


## Features

Live serial data acquisition  
Frame parsing with startByte / endByte / checksum  
Dynamic charts with customizable signal style (color, thickness, tension)  
Multiple simultaneous charts  
Full CSV export (timestamp + all signals)  
Clearable log with raw serial packets and checksum result  
Configurable via external JSON file  
Works offline after load  
Minimal dependencies  
No external servers required  

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

- <strike> Uploaded sensors appear **at the top** of the list</strike>
- <strike> They can **override default sensors** (by name) </strike>
- Custom entries are marked with 🆕 and highlighted

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

##  Sensor Object Fields

| Field             | Required | Type      | Description |
|------------------|----------|-----------|-------------|
| `name`           | yes       | string    | Unique sensor name (shown in dropdown) |
| `inherits_from`  | no       | string    | Name of another sensor to inherit from, ex. `"Plantower PMSA003-S"` |
| `command`        | no       | string    | Hex string to send after connect (e.g. `"7E 00 03 00 FC 7E"`) or `"none"` |
| `start_command`  | no       | string    | Hex string to send on connect (e.g. `"7E 00 00 02 01 03 F9 7E"`) |
| `stop_command`   | no       | string    | Hex string to send on disconnect (e.g. `"7E 00 01 00 FE 7E"`) 
| `send_cmd_period`| no       | number    | If > 0, send `command` every N seconds, if = 0  - once |
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
| `startByte`    | yes       | string | start byte or bytes, ex. `[66, 77]`, `["0x42", "0x4D"]`, `170`, `"0xAA"`, `"none" |
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
					"value": "((data[6] << 8) + data[7])>>>0",
					"unit": "μg/m³"
				},
				"PM10": {
					"value": "((data[8] << 8) + data[9])>>>0",
					"unit": "μg/m³"
				}
			},
			"checksum": {
				"eval": "data.slice(0, 30).reduce((a, b) => (a + b) & 0xFFFF, 0)",
				"compare": "((data[30] << 8) + data[31])>>>0"
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

## Tips & Troubleshooting

- All `value`, `eval`, and `compare` fields are evaluated using JavaScript `eval()`.
- You can use decimal values (`66`) or hex strings (`"0x42"`) — **no raw hex like `0x42`**.
- If your JSON fails to load, check the browser log or validate at [https://jsonlint.com](https://jsonlint.com).

## See Also

- Default sensors: [`sensors.json`](https://raw.githubusercontent.com/WeSpeakEnglish/polluSensWeb/main/sensors.json)
- Project homepage: [pollutants.eu/sensor](https://pollutants.eu/sensor)

## Contribute

If you've created and sucessfully tested a sensor config (you may test it by uploading custom JSON via web interface), feel free to submit it in pull request adding to sensor list JSON.

## License

MIT License





