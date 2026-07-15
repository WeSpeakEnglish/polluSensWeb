const DEFAULT_SENSOR_LIST = "https://raw.githubusercontent.com/WeSpeakEnglish/polluSensWeb/refs/heads/main/sensors.json";
const PROXY_URL = "https://pollutants.eu/proxy/proxy.php";

let port = null, reader = null, writer = null, reading = false;
let config = null, sensors = [], chartSettings = {};
let commandInterval = null;
let commandTimeout = null;
let collectedData = []; 
let defaultSensorNames = [];
let defaultSensors = [];
const log = document.getElementById('log');

window.onload = () => {
	chartWidth.value = chartControls.offsetWidth;
};

function logMessage(msg, linesPerPacket = 1) {
	const maxPackets = parseInt(document.getElementById('maxLogPackets')?.value) || 1000;
	const autoscroll = document.getElementById('autoscrollLog')?.checked ?? true;
	
	const logLines = log.textContent.trim().split('\n');
	msg.trim().split('\n').forEach(line => logLines.push(line));
	
	while (logLines.length > maxPackets * linesPerPacket) {
		logLines.shift();
	}
	
	log.textContent = logLines.join('\n') + '\n';
	if (autoscroll) log.scrollTop = log.scrollHeight;
}

const MAX_SECONDS = 600;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function sleepInterruptible(ms) {
	const step = 50, end = Date.now() + ms;
	while (reading && Date.now() < end) await sleep(Math.min(step, end - Date.now()));
}
// Returns the data-field map regardless of whether the sensor uses the classic
// flat format (config.data) or the new multi-command format (commands[].data).
function getConfigData() {
	if (!config) return {};
	if (config.data) return config.data;
	if (Array.isArray(config.commands)) {
		for (const cmd of config.commands) {
			if (cmd.data && Object.keys(cmd.data).length > 0) return cmd.data;
		}
	}
	return {};
}

// Handle inheritance
const nameToSensor = {};

function resolveInheritance(sensor, stack) {
	stack = Array.isArray(stack) ? stack : [];
	
	if (!sensor || typeof sensor !== 'object') return null;
	if (!sensor.name) return null;
	if (!sensor.inherits_from) return sensor;
	
	if (stack.includes(sensor.name)) {
		console.warn("Circular inheritance:", [...stack, sensor.name].join(" → "));
		return sensor;
	}
	
	const base = nameToSensor[sensor.inherits_from];
	if (!base) {
		console.warn("Base sensor not found:", sensor.inherits_from);
		return sensor;
	}
	
	const resolvedBase = resolveInheritance(base, [...stack, sensor.name]);
	if (!resolvedBase) return sensor;
	
	return {
		name: sensor.name,
		start_command: sensor.start_command ?? resolvedBase.start_command,
		stop_command: sensor.stop_command ?? resolvedBase.stop_command,
		command: sensor.command ?? resolvedBase.command,
		commands: sensor.commands ?? resolvedBase.commands,
		send_cmd_period: sensor.send_cmd_period ?? resolvedBase.send_cmd_period,
		send_cmd_period_ms: sensor.send_cmd_period_ms ?? resolvedBase.send_cmd_period_ms,
		port: { ...resolvedBase.port, ...(sensor.port || {}) },
		frame: { ...resolvedBase.frame, ...(sensor.frame || {}) },
		checksum: { ...resolvedBase.checksum, ...(sensor.checksum || {}) },
		data: { ...resolvedBase.data, ...(sensor.data || {}) }
	};
}

async function loadConfigAndPopulateSelector(customConfig = null, customName = null) {
	let rawConfig;
	let sourceLabel = '';
	
	try {
		if (customConfig) {
			rawConfig = customConfig;
			sourceLabel = ` (from ${customName})`;
		} else {
			const res = await fetch(DEFAULT_SENSOR_LIST);
			rawConfig = await res.json();
			sourceLabel = " (default)";
		}
	} catch (err) {
		logMessage(`❌ Failed to load configuration: ${err.message}`, 1);
		return;
	}
	
	let rawSensors = Array.isArray(rawConfig.sensors) ? rawConfig.sensors : [rawConfig];
	sensors = rawSensors.map(resolveInheritance).filter(s => s && s.name && s.data);
	
	const sensorMap = {};
	
	if (!customConfig) {
		defaultSensors = rawSensors;
		defaultSensorNames = rawSensors.map(s => s.name);
		rawSensors.forEach(s => {
			if (s.name) sensorMap[s.name] = s;
		});
	} else {
		rawSensors.forEach(s => {
			if (s.name) sensorMap[s.name] = s;
		});
		
		const customNames = rawSensors.map(s => s.name);
		const allNames = [...customNames, ...defaultSensorNames.filter(n => !customNames.includes(n))];
		rawSensors = allNames.map(name => sensorMap[name]).filter(s => s && s.name);
	}
	
	rawSensors.forEach(sensor => {
		if (sensor.name) nameToSensor[sensor.name] = sensor;
	});
	
	sensors = rawSensors.map(resolveInheritance).filter(s => s && s.name && (s.data || s.commands));
	
	const selector = document.getElementById('sensorSelector');
	selector.innerHTML = '';
	sensors.forEach((sensor, i) => {
		const opt = document.createElement('option');
		opt.value = i;
		opt.textContent = sensor.name || `Sensor ${i + 1}`;
		
		const isCustom = customConfig && (!defaultSensorNames.includes(sensor.name) || sourceLabel !== " (default)");
		if (isCustom) {
			opt.textContent += " 🆕";
			opt.title = "Custom uploaded sensor";
		}
		
		selector.appendChild(opt);
	});
	
	selector.onchange = () => {
		config = sensors[parseInt(selector.value)];
		renderSignalRows();
	};
	selector.dispatchEvent(new Event('change'));
	
	logMessage(`✅ Sensor list loaded${sourceLabel} (${sensors.length} sensors)`, 1);
	sortSensorSelectorWhenReady();
}

function renderSignalRows() {
	const container = document.getElementById('signalRows');
	container.innerHTML = '';
	const dataFields = getConfigData();
	if (!config || Object.keys(dataFields).length === 0) return;
	
	const colors = [
		"#aa0000", "#00aa00", "#0000aa", "#aaaa00",
		"#00aaaa", "#aa00aa", "#aa5500", "#0055aa",
		"#55aa00", "#5500aa", "#aa0055", "#55aaaa"
	];
	
	let colorIndex = 0;
	
	Object.entries(dataFields).forEach(([key, meta]) => {
		const row = document.createElement('div');
		row.className = 'signalRow';
		row.dataset.field = key;
		
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'signalToggle';
		checkbox.value = key;
		
		const unit = typeof meta === 'object' && meta.unit ? ` [${meta.unit}]` : '';
		
		const label = document.createElement('label');
		label.textContent = key + unit;
		label.prepend(checkbox); 
		
		const color = document.createElement('input');
		color.type = 'color';
		color.className = 'dsColor';
		color.value = colors[colorIndex % colors.length];
		colorIndex++;
		
		const tension_label = document.createElement('label');
		tension_label.textContent = "tension:";
		
		const tension = document.createElement('input');
		tension.type = 'number';
		tension.className = 'dsTension';
		tension.value = '0.3';
		tension.min = 0;
		tension.max = 1;
		tension.step = 0.1;
		
		const thickness_label = document.createElement('label');
		thickness_label.textContent = "thickness:";
		
		const width = document.createElement('input');
		width.type = 'number';
		width.className = 'dsWidth';
		width.value = '2';
		width.min = 1;
		
		const signalSettings = document.createElement('span');
		signalSettings.className = 'signal-settings';
		signalSettings.style.display = 'none';
		signalSettings.append(tension_label, tension, thickness_label, width);
		
		const gearBtn = document.createElement('button');
		gearBtn.className = 'signal-gear-btn';
		gearBtn.title = 'Toggle signal settings';
		gearBtn.textContent = '⚙';
		gearBtn.addEventListener('click', function() {
			const hidden = signalSettings.style.display === 'none';
			signalSettings.style.display = hidden ? 'inline-flex' : 'none';
			gearBtn.classList.toggle('active', hidden);
		});
		
		row.append(label, color, gearBtn, signalSettings);
		container.appendChild(row);
	});
}

document.getElementById('createChart').onclick = () => {
	const name = document.getElementById('chartName').value || "Chart";
	const maxDatapoints = parseInt(document.getElementById('maxDatapoints').value || 600);
	const width = parseInt(document.getElementById('chartWidth').value);
	const height = parseInt(document.getElementById('chartHeight').value);
	const rows = document.querySelectorAll('.signalRow');
	const datasets = [];
	
	rows.forEach(row => {
		if (!row.querySelector('.signalToggle').checked) return;
		datasets.push([
			'',
			row.dataset.field,
			row.querySelector('.dsColor').value,
			row.querySelector('.dsTension').value,
			row.querySelector('.dsWidth').value
		]);
	});
	
	if (datasets.length === 0) {
		alert("At least one signal should be selected to create a chart.");
		return;
	}
	
	createChart(name, [width, height], datasets, maxDatapoints);
};

function createChart(name, size, datasets, maxDatapoints) {
	const chartId = crypto.randomUUID();
	const wrapper = document.createElement('div');
	wrapper.className = 'chart-wrapper';
	wrapper.style.maxWidth = `${size[0]}px`;
	wrapper.style.height = `${size[1]}px`;
	
	const header = document.createElement('div');
	header.className = 'chart-header';
	header.innerHTML = `<h4>${name} <span style="font-size: 0.7em; color: #966;">(${maxDatapoints} datapoints)</span></h4><button class="delete-button">×</button>`;
	header.querySelector('button').onclick = () => {
		wrapper.remove();
		chartSettings[chartId]?.chart?.destroy();
		delete chartSettings[chartId];
	};
	
	const canvas = document.createElement('canvas');
	canvas.className = 'chart-container';
	
	wrapper.appendChild(header);
	wrapper.appendChild(canvas);
	document.getElementById('charts').appendChild(wrapper);
	
// Get chart theme colors from CSS variables
const getChartColors = () => {
	const style = getComputedStyle(document.body);
	return {
		text: style.getPropertyValue('--chart-text').trim(),
		grid: style.getPropertyValue('--chart-grid').trim()
	};
};

const chartColors = getChartColors();

const chart = new Chart(canvas, {
  type: 'line',
  data: {
    datasets: datasets.map(([_, field, color, tension, width]) => ({
      label: `${field}${getConfigData()[field]?.unit ? ' [' + getConfigData()[field].unit + ']' : ''}`,
      data: [],
      borderColor: color,
      backgroundColor: color,
      tension: parseFloat(tension),
      borderWidth: parseInt(width),
      fill: false,
      pointRadius: 0,
      pointStyle: 'circle'
    }))
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: { 
      x: { 
        type: 'time', 
        time: { 
          unit: 'second', 
          tooltipFormat: 'HH:mm:ss', 
          displayFormats: { second: 'HH:mm:ss' } 
        }, 
        title: { display: true, text: 'Time', color: chartColors.text }, 
        ticks: { autoSkip: true, color: chartColors.text },
        grid: { color: chartColors.grid }
      }, 
      y: { 
        beginAtZero: true, 
        title: { display: true, text: name, color: chartColors.text },
        ticks: { color: chartColors.text },
        grid: { color: chartColors.grid }
      } 
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          padding: 8,
          font: { size: 12 },
          color: chartColors.text
        }
      }
    }
  }
});
	
	chartSettings[chartId] = { chart, datasets, maxDatapoints };
}

function updateCharts(parsedData) {
	const now = new Date();
	
	collectedData.push({ timestamp: now.toISOString(), ...parsedData });
	
	for (const { chart, datasets, maxDatapoints } of Object.values(chartSettings)) {
		datasets.forEach(([_, field], i) => {
			const value = parsedData[field];
			if (value !== undefined) {
				chart.data.datasets[i].data.push({ x: now, y: value });
				const dataArr = chart.data.datasets[i].data;
				if (dataArr.length > maxDatapoints) {
					chart.data.datasets[i].data = dataArr.slice(dataArr.length - maxDatapoints);
				}
			}
		});
		chart.update('none');
	}
}

async function sendCommand(commandString) {
	if (!port || !commandString || commandString.toLowerCase() === "none") {
		return;
	}
	try {
		const bytes = commandString.split(/\s+/).map(hex => parseInt(hex, 16));
		const data = new Uint8Array(bytes);
		const localWriter = port.writable.getWriter();
		await localWriter.write(data);
		localWriter.releaseLock();
		logMessage(`➡️ Sent: [${bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}]`);
	} catch (e) {
		logMessage(`❌ Error sending command: ${e.message}`);
	}
}

async function sendCommandIfNeeded() {
    const command = config.command;
    const period = config.send_cmd_period;
	
    if (!command || command.toLowerCase() === "none") return;
	
    if (commandInterval) {
        clearInterval(commandInterval);
        commandInterval = null;
	}
    if (commandTimeout) {
        clearTimeout(commandTimeout);
        commandTimeout = null;
	}
	
    commandTimeout = setTimeout(() => {
        sendCommand(command);
		
        commandInterval = setInterval(() => {
            sendCommand(command);
		}, period * 1000);
		
	}, period * 1000);
}

function parseByteValue(v) {
	if (typeof v === 'string' && v.startsWith('0x')) {
		return parseInt(v, 16);
	}
	return v;
}

function parseByteField(field) {
	if (field === "none") return field;
	if (Array.isArray(field)) {
		return field.map(parseByteValue);
	}
	return parseByteValue(field);
}			

function unstuffBytes(data, stuffingTable) {
	if (!stuffingTable || stuffingTable.length === 0) {
		return data.slice();
	}
	const escapeByte = parseInt(stuffingTable[0][0].split(' ')[0], 16);
	const stuffedMap = {};
	stuffingTable.forEach(([from, to]) => {
		const [a, b] = from.split(' ').map(x => parseInt(x, 16));
		stuffedMap[`${a},${b}`] = parseInt(to, 16);
	});
	const result = [];
	for (let i = 0; i < data.length; i++) {
		if (data[i] === escapeByte && i + 1 < data.length) {
			const key = `${data[i]},${data[i + 1]}`;
			if (key in stuffedMap) {
				result.push(stuffedMap[key]);
				i++; 
				continue;
			}
		}
		result.push(data[i]);
	}
	return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIC READ LOOP - FIXED WITH BUFFER CLEAR
// ─────────────────────────────────────────────────────────────────────────────
async function readLoop() {
	const { frame, checksum, data: dataFields } = config;
	const useStart = frame.startByte !== "none";
	const useEnd = frame.endByte !== "none";
	const useStuffing = Array.isArray(frame.stuffing) && frame.stuffing.length > 0;
	const frameLength = frame.length;
	const startByte = parseByteField(frame.startByte);
	const endByte = parseByteField(frame.endByte);
	let buffer = [];
	reading = true;
	
	try {
		while (reading) {
			const { value, done } = await reader.read();
			if (done) break;
			
			buffer.push(...value);
			
			let continueProcessing = true;
			while (continueProcessing) {
				continueProcessing = false;
				let data = null;
				
				if (useStuffing) {
					const startIndex = Array.isArray(startByte) ? -1 : buffer.indexOf(startByte);
					if (startIndex === -1) break; 
					
					if (startIndex > 0) {
						buffer.splice(0, startIndex);
					}
					
					const endIndex = Array.isArray(endByte) ? -1 : buffer.indexOf(endByte, 1);
					if (endIndex === -1) break;
					
					const rawFrame = buffer.splice(0, endIndex + 1);
					const unstuffed = unstuffBytes(rawFrame, frame.stuffing);
					
					if (unstuffed.length !== frameLength) {
						logMessage(`❌ Malformed frame. Expected unstuffed length ${frameLength}, got ${unstuffed.length}`);
						continueProcessing = true;
						continue;
					}
					data = unstuffed;
					
				} else { 
					if (buffer.length < frameLength) break;
					
					const potentialFrame = buffer.slice(0, frameLength);
					
					const matchesStart = Array.isArray(startByte)
					? startByte.every((v, i) => potentialFrame[i] === v)
					: !useStart || potentialFrame[0] === startByte;
					
					const matchesEnd = !useEnd || (
						Array.isArray(endByte)
						? endByte.every((v, i) => potentialFrame[frameLength - endByte.length + i] === v)
						: potentialFrame[frameLength - 1] === endByte
					);
					
					if (matchesStart && matchesEnd) {
						data = potentialFrame;
						buffer.splice(0, frameLength);
					} else {
						buffer.shift();
						continueProcessing = true;
						continue;
					}
				}
				
				if (data) {
					// 🔥 FIX: Clear buffer completely after successful frame
					buffer = [];
					
					const valid = eval(checksum.eval) === eval(checksum.compare);
					if (valid) {
						const parsed = {};
						for (const [name, meta] of Object.entries(dataFields)) {
							const expr = typeof meta === 'object' ? meta.value : meta;
							const val = eval(expr);
							parsed[name] = typeof val === 'number' ? parseFloat(val.toFixed(3)) : val;
						}
						
						updateCharts(parsed);
						
						lastParsedData = parsed;

						if (enableWebhook.checked && Number(webhookInterval.value) === 0) {
							sendHttpRequest(parsed);
						}

						const hexPacket = Array.from(data).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
						const parsedStr = Object.entries(parsed)
						.map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed(3) : v}`)
						.join(', ');
						logMessage(`📦 [${hexPacket}]\nChecksum: ✅\nParsed: ${parsedStr}`, 3);
					} else {
						logMessage(`❌ Bad checksum`);
					}
					continueProcessing = true;
				}
			}
		}
	} catch (err) {
		logMessage(`⚠️ ${err.message}`);
		
		if (commandInterval) {
			clearInterval(commandInterval);
			commandInterval = null;
			logMessage('🛑 Stopped sending commands.');
		}
		
		try {
			await reader?.cancel();
			reader?.releaseLock();
		} catch (e) {}
	}
	
	reading = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-command sequencer (new JSON format: sensor.commands[]) - FIXED WITH BUFFER CLEAR
// ─────────────────────────────────────────────────────────────────────────────
async function runMultiCommandSequence() {
	reading = true;
	const rxBuffer = [];

	// Background task: drains the serial port into rxBuffer
	const readerTask = (async () => {
		try {
			while (reading) {
				const { value, done } = await reader.read();
				if (done) break;
				rxBuffer.push(...value);
			}
		} catch (_) { /* reader was cancelled or port closed */ }
	})();

	// Read a frame from the buffer using the same logic as classic loop
	async function readFrameFromBuffer(frameSpec, timeoutMs = 5000) {
		const { length, startByte, endByte, stuffing } = frameSpec;
		const useStart = startByte !== 'none';
		const useEnd = endByte !== 'none';
		const useStuffing = Array.isArray(stuffing) && stuffing.length > 0;
		const pStart = useStart ? parseByteField(startByte) : null;
		const pEnd = useEnd ? parseByteField(endByte) : null;
		const deadline = Date.now() + timeoutMs;

		while (reading && Date.now() < deadline) {
			if (rxBuffer.length === 0) { 
				await sleep(10); 
				continue; 
			}

			let data = null;

			if (useStuffing) {
				// For stuffed frames with NO start/end bytes, just find by length
				if (!useStart && !useEnd) {
					// Try different raw lengths until we find one that unstuffs to 'length'
					let found = false;
					for (let rawLen = length; rawLen <= rxBuffer.length; rawLen++) {
						const rawFrame = rxBuffer.slice(0, rawLen);
						const unstuffed = unstuffBytes(rawFrame, stuffing);
						if (unstuffed.length === length) {
							data = unstuffed;
							rxBuffer.splice(0, rawLen);
							found = true;
							break;
						}
					}
					if (!found) {
						// No valid frame found, remove first byte and try again
						rxBuffer.shift();
						continue;
					}
				} else if (useStart && !useEnd) {
					// Has start byte but no end byte
					const startIndex = Array.isArray(pStart) ? -1 : rxBuffer.indexOf(pStart);
					if (startIndex === -1) {
						if (rxBuffer.length > 1000) rxBuffer.splice(0, 100);
						await sleep(10);
						continue;
					}
					if (startIndex > 0) {
						rxBuffer.splice(0, startIndex);
					}
					
					// Try different raw lengths
					let found = false;
					for (let rawLen = length; rawLen <= rxBuffer.length; rawLen++) {
						const rawFrame = rxBuffer.slice(0, rawLen);
						const unstuffed = unstuffBytes(rawFrame, stuffing);
						if (unstuffed.length === length) {
							data = unstuffed;
							rxBuffer.splice(0, rawLen);
							found = true;
							break;
						}
					}
					if (!found) {
						rxBuffer.shift();
						continue;
					}
				} else if (useStart && useEnd) {
					// Has both start and end bytes
					const startIndex = Array.isArray(pStart) ? -1 : rxBuffer.indexOf(pStart);
					if (startIndex === -1) {
						if (rxBuffer.length > 1000) rxBuffer.splice(0, 100);
						await sleep(10);
						continue;
					}
					if (startIndex > 0) {
						rxBuffer.splice(0, startIndex);
					}
					
					const endIndex = Array.isArray(pEnd) ? -1 : rxBuffer.indexOf(pEnd, 1);
					if (endIndex === -1) {
						await sleep(10);
						continue;
					}
					
					const rawFrame = rxBuffer.splice(0, endIndex + 1);
					const unstuffed = unstuffBytes(rawFrame, stuffing);
					
					if (unstuffed.length !== length) {
						logMessage(`❌ Malformed frame. Expected unstuffed length ${length}, got ${unstuffed.length}`);
						continue;
					}
					data = unstuffed;
				} else {
					// No start, has end byte - shouldn't happen normally
					const endIndex = Array.isArray(pEnd) ? -1 : rxBuffer.indexOf(pEnd);
					if (endIndex === -1) {
						await sleep(10);
						continue;
					}
					const rawFrame = rxBuffer.splice(0, endIndex + 1);
					const unstuffed = unstuffBytes(rawFrame, stuffing);
					if (unstuffed.length === length) {
						data = unstuffed;
					} else {
						rxBuffer.shift();
						continue;
					}
				}
				
			} else {
				// No stuffing - same logic as classic loop
				if (useStart) {
					let startIndex = -1;
					if (Array.isArray(pStart)) {
						for (let i = 0; i <= rxBuffer.length - pStart.length; i++) {
							if (pStart.every((v, j) => rxBuffer[i + j] === v)) {
								startIndex = i;
								break;
							}
						}
					} else {
						startIndex = rxBuffer.indexOf(pStart);
					}
					if (startIndex === -1) {
						if (rxBuffer.length > 1000) rxBuffer.splice(0, 100);
						await sleep(10);
						continue;
					}
					if (startIndex > 0) {
						rxBuffer.splice(0, startIndex);
					}
				}

				if (rxBuffer.length < length) {
					await sleep(10);
					continue;
				}

				const potentialFrame = rxBuffer.slice(0, length);

				if (useEnd) {
					const matchesEnd = Array.isArray(pEnd)
						? pEnd.every((v, i) => potentialFrame[length - pEnd.length + i] === v)
						: potentialFrame[length - 1] === pEnd;
					
					if (!matchesEnd) {
						rxBuffer.shift();
						continue;
					}
				}

				data = potentialFrame;
				rxBuffer.splice(0, length);
			}

			if (data) {
				// 🔥 FIX: Clear buffer completely after successful frame
				rxBuffer.length = 0;
				return data;
			}
		}

		if (reading) logMessage(`❌ Timeout waiting for frame`);
		return null;
	}

	// Send one command and, if it declares a frame, read + validate + parse the response.
	async function processCommand(cmd) {
		await sendCommand(cmd.command);
		if (!cmd.frame) return null;

		// Don't clear rxBuffer - data may already be there from previous reads
		const data = await readFrameFromBuffer(cmd.frame);
		if (!data) return null;

		const hexStr = data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
		let valid = true;
		if (cmd.checksum) {
			try { valid = (eval(cmd.checksum.eval) === eval(cmd.checksum.compare)); }
			catch (e) { valid = false; logMessage(`❌ Checksum eval error: ${e.message}`); }
		}

		const parsed = {};
		if (valid && cmd.data) {
			for (const [name, meta] of Object.entries(cmd.data)) {
				const expr = typeof meta === 'object' ? meta.value : meta;
				try {
					const v = eval(expr);
					parsed[name] = typeof v === 'number' ? parseFloat(v.toFixed(3)) : v;
				} catch (e) { logMessage(`❌ Parse error (${name}): ${e.message}`); }
			}
		}
		return { hexStr, parsed, valid };
	}

	// Log a frame result in the same 3-line style as the classic read loop
	function logFrame(result) {
		const { hexStr, parsed, valid } = result;
		if (!valid) { logMessage(`📦 [${hexStr}] Checksum: ❌`, 1); return; }
		const keys = Object.keys(parsed);
		if (!keys.length) { logMessage(`📦 [${hexStr}] Checksum: ✅`, 1); return; }
		const parsedStr = keys
			.map(k => `${k}: ${typeof parsed[k] === 'number' ? parsed[k].toFixed(3) : parsed[k]}`)
			.join(', ');
		logMessage(`📦 [${hexStr}]\nChecksum: ✅\nParsed: ${parsedStr}`, 3);
	}

	try {
		// repeat semantics:
		//   repeat:0        → init only, run once before the cycle starts
		//   repeat:N (N≥1)  → cycle command, executed N times per cycle iteration
		const initCmds  = config.commands.filter(c => (c.repeat ?? 0) === 0);
		const cycleCmds = config.commands.filter(c => (c.repeat ?? 0) >= 1);

		// ── Init phase (repeat:0) ──────────────────────────────────────────────
		if (initCmds.length)
			logMessage(`🔄 Init (${initCmds.length} step${initCmds.length > 1 ? 's' : ''})…`);
		for (const cmd of initCmds) {
			if (!reading) break;
			const res = await processCommand(cmd);
			if (res) logFrame(res);
			if (cmd.postDelay_ms > 0) await sleepInterruptible(cmd.postDelay_ms);
		}
		if (!reading) return;

		// ── Measurement cycle (repeat:N ≥ 1) ──────────────────────────────────
		if (!cycleCmds.length) {
			logMessage('⚠️ No cycle commands (repeat ≥ 1) — measurement loop skipped.');
			return;
		}
		logMessage(`🔁 Measurement loop started (${cycleCmds.length} unique cmd/cycle)…`);

		while (reading) {
			for (const cmd of cycleCmds) {
				const times = cmd.repeat ?? 1;
				for (let i = 0; i < times; i++) {
					if (!reading) break;
					const r = await processCommand(cmd);
					if (r) {
						if (r.valid && Object.keys(r.parsed).length > 0) {
							updateCharts(r.parsed);
							lastParsedData = r.parsed;
							if (enableWebhook.checked && Number(webhookInterval.value) === 0) {
								sendHttpRequest(r.parsed);
							}
						}
						logFrame(r);
					}
					if (cmd.postDelay_ms > 0) await sleepInterruptible(cmd.postDelay_ms);
				}
			}
		}
	} catch (err) {
		logMessage(`⚠️ ${err.message}`);
		try { await reader?.cancel(); reader?.releaseLock(); } catch (_) {}
	}

	reading = false;
	await readerTask;
}

document.getElementById('connect').onclick = async () => {
	const connectBtn = document.getElementById('connect');
	const sensorIndex = parseInt(document.getElementById('sensorSelector').value);
	config = sensors[sensorIndex];
	
	if (port) {
		reading = false;
		
		if (intervalTimer) {
			clearInterval(intervalTimer);
			intervalTimer = null;
			logStatus("Webhook timer stopped.", "info");
		}

		if (commandInterval) {
			clearInterval(commandInterval);
			commandInterval = null;
		}
		
		await sendCommand(config.stop_command);
		
		try { await reader?.cancel(); reader?.releaseLock(); } catch (e) {}
		try { await port.close(); } catch(e) {}
		
		port = null;
		reader = null;
		connectBtn.textContent = '🔌 Connect';
		logMessage('🔌 Port closed');
		return;
	}
	
	try {
		port = await navigator.serial.requestPort();
		await port.open(config.port);
		reader = port.readable.getReader();
		connectBtn.textContent = '❌ Disconnect';
		logMessage('✅ Port opened');
		
		if (Array.isArray(config.commands)) {
			// ── New multi-command format (e.g. SEN63C via KEL) ──
			if (enableWebhook.checked) resetTimer();
			await runMultiCommandSequence();
		} else {
			// ── Classic single-command format ──
			await sendCommand(config.start_command);
			await sendCommandIfNeeded();
			if (enableWebhook.checked) resetTimer();
			await readLoop();
		}
		
	} catch (err) {
		logMessage(`❌ ${err.message}`);
		connectBtn.textContent = '🔌 Connect';
		port = null;
	}
};

document.getElementById('clearLog').onclick = () => { log.textContent = ''; };
document.getElementById('saveCSV').onclick = () => {
	if (collectedData.length === 0) {
		alert("No data to save.");
		return;
	}
	
	const fields = Object.keys(collectedData[0]);
	const csvRows = [fields.join(",")];
	
	collectedData.forEach(row => {
		const values = fields.map(f => `"${row[f] !== undefined ? row[f] : ''}"`);
		csvRows.push(values.join(","));
	});
	
	const csvContent = csvRows.join("\n");
	const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	
	const link = document.createElement("a");
	link.setAttribute("href", url);
	link.setAttribute("download", `polluSens_data_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
};
document.addEventListener('DOMContentLoaded', async () => {
	await loadConfigAndPopulateSelector(); 
});
document.getElementById('jsonUpload').addEventListener('change', async (e) => {
	const file = e.target.files[0];
	if (!file) return;
	
	try {
		const text = await file.text();
		const json = JSON.parse(text);
		
		if (!defaultSensorNames.length || !defaultSensors.length) {
			await loadConfigAndPopulateSelector(); 
		}
		
		await loadConfigAndPopulateSelector(json, file.name);
	} catch (err) {
		logMessage(`❌ Failed to load custom config: ${err.message}`);
	}
});


const MIN_PROCESSING_INTERVAL_MS = 50; 
let intervalTimer = null;
let lastParsedData = null; 
let lastProcessedTime = 0; 
let webhookCounter = 0;

enableWebhook.onchange = () => {
	webhookConfig.style.display = enableWebhook.checked ? "block" : "none";
	resetTimer();
};
webhookInterval.onchange = resetTimer;

function addHeaderRow(key = "", val = "") {
	const row = document.createElement("div"); 
	row.className = "header-row";
	row.innerHTML = `<input class="hKey" placeholder="Key" value="${key}"><input class="hVal" placeholder="Value" value="${val}"><button class="btn-remove">X</button>`;
	row.querySelector(".btn-remove").onclick = () => row.remove();
	headersContainer.appendChild(row);
}
addHeaderRow("X-PIN", "0");
addHeaderRow("Content-Type", "application/json");
addHeader.onclick = () => addHeaderRow();
clearHeaders.onclick = () => { headersContainer.innerHTML = ""; addHeaderRow("Content-Type", "application/json"); };

function logStatus(msg, type = "info") {
	const d = document.createElement("div");
	d.className = `status ${type}`;
	d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
	statusLog.prepend(d);
	if (statusLog.children.length > 5) statusLog.lastChild.remove();
}

function getHeaders() {
	const h = {};
	document.querySelectorAll(".header-row").forEach(r => {
		const k = r.querySelector(".hKey").value.trim();
		if (k) h[k] = r.querySelector(".hVal").value.trim();
	});
	return h;
}

function processTemplate(tmpl, data) {
    let out = tmpl.replace(/{{ts}}/g, new Date().toISOString());

    out = out.replace(/{{field:([^}]+)}}/g, (_, rawKey) => {
        const key = rawKey.trim();
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            const val = data[key];
            return typeof val === 'number' ? val.toFixed(3) : String(val);
        }
        return "null";
    });

    out = out.replace(/{{#fields}}([\s\S]*?){{\/fields}}/g, (_, block) => {
        const entries = Object.entries(data)
            .filter(([_, v]) => v !== null && v !== undefined);

        if (!entries.length) return "";

        return entries.map(([key, value], i) => {
            const formattedValue = typeof value === 'number' ? value.toFixed(3) : String(value);
            
            let line = block
                .replace(/{{key}}/g, String(key))
                .replace(/{{value}}/g, formattedValue)
                .trim();

            if (i === entries.length - 1) {
                line = line.replace(/,\s*$/, "");
            }
            return line;
        }).join(",\n    ");
    });

    return out;
}

async function sendHttpRequest(data) {
	try {
		webhookCounter++;
		if (webhookCount) webhookCount.textContent = webhookCounter;
		
		const method = webhookMethod.value;
		const url = `${PROXY_URL}?url=${encodeURIComponent(webhookUrl.value)}`;
		const rawHeaders = getHeaders();
		const processedHeaders = {};
		
		for (const [k, v] of Object.entries(rawHeaders)) {
			processedHeaders[k] = processTemplate(v, data);
		}
		
		const options = { method, headers: processedHeaders, mode: 'cors' };
		
		if (method !== 'GET') options.body = processTemplate(webhookBody.value, data);
		
		logStatus(`Sending ${method}...`, "info");
		const r = await fetch(url, options);
		
		if (r.status === 429) {
			logStatus(`❌ ERROR: 429 Too Many Requests! Increase Interval or check proxy rate limits.`, "error");
		} else if (r.ok) {
			logStatus(`✅ Sent OK (${r.status})`, "success");
		} else {
			logStatus(`❌ Error ${r.status}`, "error");
		}
	} catch (e) { logStatus(`❌ Network Error: ${e.message}`, "error"); }
}

function resetTimer() {
	if (intervalTimer) {
		clearInterval(intervalTimer);
		intervalTimer = null;
		logStatus("Previous timer cleared.", "info");
	}
	
	const secs = Number(webhookInterval.value);
	
	if (enableWebhook.checked && secs > 0) {
		logStatus(`Timer started: sending every ${secs}s`, "info");
		intervalTimer = setInterval(() => {
			if (reading && lastParsedData) {
				sendHttpRequest(lastParsedData);
				lastParsedData = null;
			}
		}, secs * 1000);
	}
}

testWebhook.onclick = () => {
	let data = lastParsedData;
	const cfgData = getConfigData();
	if (!data && config && Object.keys(cfgData).length > 0) {
		data = {};
		Object.entries(cfgData).forEach(([fieldName, meta]) => {
			data[fieldName] = parseFloat((Math.random() * 99 + 1).toFixed(3));
		});
	}
	if (!data) data = { PM1_0: 1.5, PM2_5: 1.6, PM10: 1.7 };
	logStatus("Manual Test Triggered (using " + (lastParsedData ? "last received data" : "generated test data") + ")", "info");
	sendHttpRequest(data);
};

async function fetchNewWebhookUrl() {
	const webhookInput = document.getElementById('webhookUrl');
	const viewLink = document.getElementById('webhookViewLink');
	
	webhookInput.value = "";
	webhookInput.placeholder = "Fetching unique webhook.site URL...";
	viewLink.innerHTML = ""; 
	
	const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent('https://webhook.site/token')}`;
	
	try {
		const response = await fetch(proxyUrl, { method: 'POST' });
		if (response.ok) {
			const data = await response.json();
			const token = data.uuid;
			const newUrl = `https://webhook.site/${token}`;
			webhookInput.value = newUrl;
			webhookInput.placeholder = "Unique URL loaded.";
			viewLink.innerHTML = `(<a href="https://webhook.site/#!/view/${token}" target="_blank">View/Edit @ webhook.site</a>)`;
			logStatus("New unique Webhook.site URL generated.", "success");
		} else {
			webhookInput.placeholder = "Failed to fetch URL. Status: " + response.status;
			logStatus("❌ Failed to auto-generate Webhook URL.", "error");
		}
	} catch (e) {
		webhookInput.placeholder = "Network error fetching URL.";
		logStatus(`❌ Network error fetching Webhook URL: ${e.message}`, "error");
	}
}

fetchNewWebhookUrl();
resetTimer();
logStatus("System Ready. Rate-limit protection active.", "success");

async function insertCommitDate() {
	const apiUrl = "https://api.github.com/repos/WeSpeakEnglish/polluSensWeb/commits?per_page=1";
	try {
		const res = await fetch(apiUrl, {
			headers: { "Accept": "application/vnd.github+json" }
		});
		if (!res.ok) throw new Error("GitHub API error: " + res.status);
		const data = await res.json();
		const iso = data[0]?.commit?.committer?.date;
		if (!iso) {
			document.getElementById("commit-date").innerHTML = "Last commit: Unknown";
			return;
		}
		const d = new Date(iso);
		const pad = (n) => n.toString().padStart(2, "0");
		const formatted =`${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ` + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
		document.getElementById("commit-date").innerHTML =`Last commit: ${formatted}`;
	} 
	catch (err) {
		console.error(err);
		document.getElementById("commit-date").innerHTML = " repository";
	}
}

function sortSensorSelectorWhenReady() {
    const select = document.getElementById("sensorSelector");
    if (!select) return;
    const options = Array.from(select.options).sort((a, b) =>
        a.text.localeCompare(b.text, undefined, { sensitivity: "base" })
    );

    select.innerHTML = "";
    options.forEach(o => select.appendChild(o));
}
// Chart params gear toggle
document.addEventListener('DOMContentLoaded', function() {
	var gear = document.getElementById('chartParamsGear');
	var settings = document.getElementById('chartParamsSettings');
	if (gear && settings) {
		gear.addEventListener('click', function() {
			var hidden = settings.style.display === 'none';
			settings.style.display = hidden ? 'inline-flex' : 'none';
			gear.classList.toggle('active', hidden);
		});
	}
});