# polluSensWeb

**polluSensWeb** is a lightweight web-based serial interface and charting tool for visualizing and logging data from UART pollution sensors (PM2.5, VOC, etc.).

- Communicates with sensors via Web Serial API.
- Parses configurable frame structures with checksum validation.
- Live visualization with dynamic charts (Chart.js).
- Full CSV export of collected data.
- User-friendly interface — no drivers or software installation required.
- Works fully offline once loaded.

---

![polluSensWeb](https://github.com/WeSpeakEnglish/images/blob/main/pollusensweb_one.png)

---

## Features

✅ Live serial data acquisition  
✅ Frame parsing with startByte / endByte / checksum  
✅ Dynamic charts with customizable signal style (color, thickness, tension)  
✅ Multiple simultaneous charts  
✅ Full CSV export (timestamp + all signals)  
✅ Clearable log with raw serial packets and checksum result  
✅ Fully configurable via external `sensors.json`  
✅ Works offline after load  
✅ Minimal dependencies  
✅ No external servers required  

---

## Supported Browsers

✅ Chrome ≥ 89  
✅ Edge ≥ 89  
✅ Brave ≥ 1.24  
✅ **Opera ≥ 75**  
✅ Other Chromium-based browsers with Web Serial API

⚠️ *Web Serial API is not supported in Firefox / Safari.*

---

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

---

### Serial Communication Flow

1️⃣ User clicks **Connect** → serial port opened  
2️⃣ Initial command is sent (if configured)  
3️⃣ Incoming bytes are buffered  
4️⃣ Frames are detected (startByte + endByte + length)  
5️⃣ Checksum is validated  
6️⃣ If valid:  
- Signals parsed  
- `updateCharts(parsedData)` called  
- Data appended to in-memory `collectedData`  
- Raw packet logged
  
7️⃣ If invalid → error logged

---

## User Interface

### Header Bar

- **Sensor Selector** → Choose sensor config from `sensors.json`
- **🔌 Connect / Disconnect** → Open or close serial connection
- **🧹 Clear Log** → Clear log area
- **💾 Save CSV** → Export full collected data since connection

---

### Chart Controls

#### Create a Chart Section

- **Chart Name** → Title of chart  
- **Width / Height** → Chart dimensions in px  
- **Signals Section** → List of available signals:
  - Checkbox to include signal
  - Color picker
  - Tension (line smoothness)
  - Thickness (line width)  
- **📈 Create Chart** → Create chart with selected signals

---

### Charts Area

- Multiple charts can be created dynamically.
- Each chart:
  - X-axis → Time (seconds, real-time)
  - Y-axis → Signal values
  - Multiple signals supported
- Chart header:
  - Chart title
  - **❌** Cross button → removes chart

---

### Log Area

- Displays raw packets in hex.
- Shows checksum result (✅ pass / ❌ fail).
- User can clear log manually.

---

## CSV Export

When user clicks **💾 Save CSV**:

- The `collectedData` array (one object per frame) is exported to CSV:
  - First column: `timestamp` (ISO 8601)
  - Remaining columns: all parsed signals
- Filename: 

polluSens_data_<timestamp>.csv

- CSV contains **all data collected since connection started**.

---

## Flow Summary

1️⃣ Load polluSensWeb → sensors loaded from `sensors.json`  
2️⃣ User selects sensor → signals list updates  
3️⃣ User clicks **Connect** → serial connection opened, command sent  
4️⃣ Incoming data is parsed, validated, displayed on charts, and logged  
5️⃣ User can:  
- Create / remove charts  
- Export full CSV at any time  
- Clear log as needed
  
6️⃣ User can disconnect anytime

---

## License

MIT License





