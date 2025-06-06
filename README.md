
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

## Patch Summary (latest update)

This patch added:

- `let collectedData = [];` → array for storing parsed data
- **💾 Save CSV** button and handler
- CSV generation logic → `timestamp + parsed signals`
- Minor CSS for "❌" button on charts
- Chart "Delete" button changed to cross
- No change to original serial logic (`sendCommandIfNeeded`, `readLoop`, frame parsing remain 100% unchanged)

---

## License

MIT License

---

## Credits

Project: [polluSensWeb](https://github.com/WeSpeakEnglish/polluSensWeb)  
Author: *your name / your org here*

---






