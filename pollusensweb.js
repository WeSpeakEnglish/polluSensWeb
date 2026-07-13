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

// ── Frame-length scanning state ────────────────────────────────────
let blocksSentOnce = new Set();

window.onload = () => {
	chartWidth.value = chartControls.offsetWidth;
};

function logMessage(msg, linesPerPacket = 1) {
	const maxPackets = parseInt(document.getElementById('maxLogPackets')?.value) || 1000;
	const autoscroll = document.getElementById('autoscrollLog')?.checked ?? true;

	// Strip AI/emoji symbols from log messages, replace with text equivalents
	const stripSymbols = (str) => str
		.replace(/\u2705/g, 'OK')
		.replace(/\u274c/g, 'FAIL')
		.replace(/\u26a0\ufe0f/g, 'WARN')
		.replace(/\u26a0/g, 'WARN')
		.replace(/\ud83d\udce6/g, 'PACKET')
		.replace(/\u27a1\ufe0f/g, '->')
		.replace(/\u27a1/g, '->')
		.replace(/\u23f1\ufe0f/g, '')
		.replace(/\u23f1/g, '')
		.replace(/\u23ed\ufe0f/g, '')
		.replace(/\u23ed/g, '')
		.replace(/\ud83d\uded1/g, '')
		.replace(/\ud83d\udd0c/g, '')
		.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
		.trim();

	const logLines = log.textContent.trim().split('\n');
	msg.trim().split('\n').forEach(line => logLines.push(stripSymbols(line)));

	while (logLines.length > maxPackets * linesPerPacket) {
		logLines.shift();
	}

	log.textContent = logLines.join('\n') + '\n';
	if (autoscroll) log.scrollTop = log.scrollHeight;
}

const MAX_SECONDS = 600;
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
		send_cmd_period: sensor.send_cmd_period ?? resolvedBase.send_cmd_period,
		port: { ...resolvedBase.port, ...(sensor.port || {}) },
		frame: { ...resolvedBase.frame, ...(sensor.frame || {}) },
		checksum: { ...resolvedBase.checksum, ...(sensor.checksum || {}) },
		data: { ...resolvedBase.data, ...(sensor.data || {}) },
		commands: sensor.commands ?? resolvedBase.commands
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
	sensors = rawSensors.map(resolveInheritance).filter(s => s && s.name && (s.data || (s.commands && s.commands.length > 0)));

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

	sensors = rawSensors.map(resolveInheritance);

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

// ── Helper: Get merged data config from all command blocks ──────────
function getEffectiveDataConfig() {
	if (!config) return null;
	if (config.data && Object.keys(config.data).length > 0) {
		return config.data;
	}
	if (config.commands && config.commands.length > 0) {
		const merged = {};
		for (const block of config.commands) {
			if (block.data && typeof block.data === 'object' && Object.keys(block.data).length > 0) {
				Object.assign(merged, block.data);
			}
		}
		return Object.keys(merged).length > 0 ? merged : null;
	}
	return null;
}

// ── Helper: Check if a command block has data fields ────────────────
function hasData(block) {
	return block && block.data && typeof block.data === 'object' && Object.keys(block.data).length > 0;
}

// ── Helper: Find the primary (read) command block ──────────────────
function findPrimaryCommand() {
	if (!config || !config.commands || config.commands.length === 0) return null;
	for (let i = config.commands.length - 1; i >= 0; i--) {
		if (hasData(config.commands[i])) {
			return config.commands[i];
		}
	}
	return null;
}

// ── Helper: Sleep for ms ───────────────────────────────────────────
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Build a map of frame lengths to command blocks ─────────────────
function getFrameConfigs() {
	if (!config) return [];
	const configs = [];

	if (config.commands && config.commands.length > 0) {
		for (const block of config.commands) {
			if (block.frame && typeof block.frame.length === 'number' && block.frame.length > 0) {
				if (!configs.some(c => c.frame.length === block.frame.length)) {
					configs.push({
						frame: block.frame,
						checksum: block.checksum || config.checksum,
						data: block.data || config.data,
						command: block.command
					});
				}
			}
		}
	}

	if (configs.length === 0 && config.frame && config.frame.length > 0) {
		configs.push({
			frame: config.frame,
			checksum: config.checksum,
			data: config.data
		});
	}

	// Sort: data-bearing frames first (longer = more likely real data), then by length desc
	return configs.sort((a, b) => {
		const aHasData = a.data && Object.keys(a.data).length > 0;
		const bHasData = b.data && Object.keys(b.data).length > 0;
		if (aHasData && !bHasData) return -1;
		if (!aHasData && bHasData) return 1;
		return b.frame.length - a.frame.length;
	});
}

function renderSignalRows() {
	const container = document.getElementById('signalRows');
	container.innerHTML = '';

	const dataConfig = getEffectiveDataConfig();
	if (!config || !dataConfig) return;

	const colors = [
		"#aa0000", "#00aa00", "#0000aa", "#aaaa00",
		"#00aaaa", "#aa00aa", "#aa5500", "#0055aa",
		"#55aa00", "#5500aa", "#aa0055", "#55aaaa"
	];

	let colorIndex = 0;

	Object.entries(dataConfig).forEach(([key, meta]) => {
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
	const checkedRows = [];

	rows.forEach(row => {
		if (!row.querySelector('.signalToggle').checked) return;
		checkedRows.push(row);
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

	// Highlight selected signals, then uncheck after delay
	checkedRows.forEach(row => row.classList.add('signal-highlight'));
	setTimeout(() => {
		checkedRows.forEach(row => {
			row.classList.remove('signal-highlight');
			row.querySelector('.signalToggle').checked = false;
		});
	}, 2000);

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
      label: `${field}${getEffectiveDataConfig()?.[field]?.unit ? ' [' + getEffectiveDataConfig()[field].unit + ']' : ''}`,
      data: [],
      borderColor: color,
      backgroundColor: color,      // ← solid circles in legend
      tension: parseFloat(tension),
      borderWidth: parseInt(width),
      fill: false,
      pointRadius: 0,
      pointStyle: 'circle'         // ← explicit circle
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
          usePointStyle: true,   // ← circles instead of rectangles
          boxWidth: 8,           // tiny & compact
          boxHeight: 8,
          padding: 8,            // minimal spacing
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

// ── Execute a single command block (send + delay) ────────────────────
// ── Shared RX buffer: cleared before any command expecting a framed
// response, so stale bytes from earlier/skipped cycles can't get
// stitched together with a later response into a false "valid" frame.
let rxBuffer = [];

async function executeCommandBlock(block) {
	if (block.frame) {
		rxBuffer.length = 0;
	}
	await sendCommand(block.command);
	if (block.postDelay_ms && block.postDelay_ms > 0) {
		await sleep(block.postDelay_ms);
	}
}

// ── Start periodic reading of all commands ─────────────────────────
function startPeriodicRead() {
	const periodMs = config.send_cmd_period_ms || ((config.send_cmd_period || 5) * 1000);
	logMessage(`⏱️ Cycling all ${config.commands.length} commands every ${periodMs}ms`);
	cycleAllCommands();
	commandInterval = setInterval(cycleAllCommands, periodMs);
}

// ── Re-entrancy guard: prevents overlapping cycles if one pass takes
// longer than send_cmd_period_ms (e.g. due to serial latency/jitter) ─
let cycleRunning = false;

async function cycleAllCommands() {
	if (!config.commands || config.commands.length === 0) return;

	if (cycleRunning) {
		logMessage('⏭️ Skipped cycle: previous command sequence still running');
		return;
	}
	cycleRunning = true;

	try {
		await runAllCommandBlocks();
	} finally {
		cycleRunning = false;
	}
}

async function runAllCommandBlocks() {
	for (let idx = 0; idx < config.commands.length; idx++) {
		const block = config.commands[idx];
		const repeat = block.repeat !== undefined ? block.repeat : 1;

		if (repeat === 0) {
			if (blocksSentOnce.has(idx)) continue;
			blocksSentOnce.add(idx);
		}

		const count = Math.max(1, repeat);
		for (let i = 0; i < count; i++) {
			await executeCommandBlock(block);
		}
	}
}

// ── Unified command sender: handles both legacy and multi-command ────
async function sendCommandSequence() {
	if (commandInterval) { clearInterval(commandInterval); commandInterval = null; }
	if (commandTimeout) { clearTimeout(commandTimeout); commandTimeout = null; }
	blocksSentOnce = new Set();
	cycleRunning = false;
	rxBuffer.length = 0;

	if (config.commands && config.commands.length > 0) {
		startPeriodicRead();
		return;
	}

	// Legacy single-command mode
	const command = config.command;
	const period = config.send_cmd_period;
	if (!command || command.toLowerCase() === "none") return;

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

// ── Check if a frame "looks like" it belongs to a given config ─────
// Acceptance is driven entirely by what the JSON declares: a real
// checksum and/or an explicit startByte. No hardcoded byte-pattern
// guessing, so this works generically for any sensor's config.
function frameLooksLikeConfig(buffer, frameConfig) {
	const frame = frameConfig.frame;
	const dataFields = frameConfig.data;
	const hasRealData = dataFields && Object.keys(dataFields).length > 0;

	// Data-bearing frames: accept here, actual validation happens via
	// the configured checksum in tryParseFrame.
	if (hasRealData) return true;

	// Frames without data fields (status/ACK): only accept if the
	// config gives us something concrete to match against.
	if (frame.startByte !== "none") {
		const sb = parseByteField(frame.startByte);
		if (Array.isArray(sb)) {
			return sb.every((v, i) => buffer[i] === v);
		}
		return buffer[0] === sb;
	}

	// No startByte configured and no data fields to validate against:
	// rely solely on the configured checksum (checked afterward in
	// tryParseFrame) rather than guessing a byte pattern.
	return true;
}

// ── Try to parse a frame with a given config ───────────────────────
// Returns { parsed, data, frameLength } or null
function tryParseFrame(buffer, frameConfig) {
	const frame = frameConfig.frame;
	const checksum = frameConfig.checksum;
	const dataFields = frameConfig.data;

	if (!frame || buffer.length < frame.length) {
		return null;
	}

	// Quick heuristic: does this look like the right frame type?
	if (!frameLooksLikeConfig(buffer, frameConfig)) {
		return null;
	}

	const useStart = frame.startByte !== "none";
	const useEnd = frame.endByte !== "none";
	const useStuffing = Array.isArray(frame.stuffing) && frame.stuffing.length > 0;
	const frameLength = frame.length;
	const startByte = parseByteField(frame.startByte);
	const endByte = parseByteField(frame.endByte);

	let data = null;

	if (useStuffing) {
		const startIndex = Array.isArray(startByte) ? -1 : buffer.indexOf(startByte);
		if (startIndex === -1) return null;
		if (startIndex > 0) return null;
		const endIndex = Array.isArray(endByte) ? -1 : buffer.indexOf(endByte, 1);
		if (endIndex === -1) return null;
		const rawFrame = buffer.slice(0, endIndex + 1);
		const unstuffed = unstuffBytes(rawFrame, frame.stuffing);
		if (unstuffed.length !== frameLength) return null;
		data = unstuffed;
	} else {
		const potentialFrame = buffer.slice(0, frameLength);

		const matchesStart = Array.isArray(startByte)
			? startByte.every((v, i) => potentialFrame[i] === v)
			: !useStart || potentialFrame[0] === startByte;

		const matchesEnd = !useEnd || (
			Array.isArray(endByte)
				? endByte.every((v, i) => potentialFrame[frameLength - endByte.length + i] === v)
				: potentialFrame[frameLength - 1] === endByte
		);

		if (!matchesStart || !matchesEnd) {
			return null;
		}
		data = potentialFrame;
	}

	if (!data) return null;

	// Check checksum
	const valid = eval(checksum.eval) === eval(checksum.compare);
	if (!valid) return null;

	// Parse data fields
	const parsed = {};
	for (const [name, meta] of Object.entries(dataFields)) {
		const expr = typeof meta === 'object' ? meta.value : meta;
		const val = eval(expr);
		parsed[name] = typeof val === 'number' ? parseFloat(val.toFixed(3)) : val;
	}

	return { parsed, data, frameLength };
}

async function readLoop() {
	rxBuffer.length = 0;
	reading = true;
	const frameConfigs = getFrameConfigs();

	if (frameConfigs.length === 0) {
		logMessage("WARN No frame configs available for parsing");
		reading = false;
		return;
	}

	// ── Inter-frame gap support (JSON config only) ───────────────────
	// Reads inter_frame_gap_ms from sensor JSON port settings.
	// If set (>0), bytes arriving within this gap are treated as one packet.
	const interFrameGapMs = config?.port?.inter_frame_gap_ms ?? 0;
	const useInterFrameGap = interFrameGapMs > 0;
	let rawChunk = [];
	let lastByteTime = 0;
	let gapTimer = null;

	function processRxBuffer(fromGapTimer = false) {
		if (rxBuffer.length === 0) return;

		// ── Try to parse ANY frame first (regardless of buffer size) ────
		let bestMatch = null;

		for (const cfg of frameConfigs) {
			if (rxBuffer.length < cfg.frame.length) continue;

			const result = tryParseFrame(rxBuffer, cfg);
			if (!result) continue;

			const hasRealData = cfg.data && Object.keys(cfg.data).length > 0;
			const score = hasRealData ? 1000 + cfg.frame.length : cfg.frame.length;

			if (!bestMatch || score > bestMatch.score) {
				bestMatch = {
					parsed: result.parsed,
					data: result.data,
					frameLength: result.frameLength,
					config: cfg,
					score: score
				};
			}
		}

		if (bestMatch) {
			// Valid frame found — consume exactly its declared length from JSON
			rxBuffer.splice(0, bestMatch.frameLength);

			updateCharts(bestMatch.parsed);
			lastParsedData = bestMatch.parsed;

			if (enableWebhook.checked && Number(webhookInterval.value) === 0) {
				sendHttpRequest(bestMatch.parsed);
			}

			const hexPacket = Array.from(bestMatch.data).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
			const parsedStr = Object.entries(bestMatch.parsed)
				.map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed(3) : v}`)
				.join(', ');
			logMessage(`[${hexPacket}]\nChecksum: OK\nParsed: ${parsedStr}`, 3);

			return; // One frame per call. Tail stays for caller to clear.
		}

		// ── No frame matched ────────────────────────────────────────────
		// maxLen comes from JSON configs only
		const maxLen = Math.max(...frameConfigs.map(c => c.frame.length), 0);

		// Buffer is too small for the largest configured frame — might be incomplete
		if (rxBuffer.length < maxLen) {
			if (fromGapTimer) {
				// Gap expired: no more bytes coming. This is garbage.
				const droppedHex = rxBuffer.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
				logMessage(`WARN Incomplete packet (${rxBuffer.length} bytes < ${maxLen}), clearing: [${droppedHex}]`);
				rxBuffer.length = 0;
			}
			// Not from gap timer: keep waiting for more bytes
			return;
		}

		// Buffer >= maxLen but no valid frame: sync lost
		// Log the entire buffer, no truncation, no hardcoded numbers
		const droppedHex = rxBuffer.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
		logMessage(`WARN No valid frame in ${rxBuffer.length} bytes, clearing: [${droppedHex}]`);
		rxBuffer.length = 0;
	}

	try {
		while (reading) {
			const { value, done } = await reader.read();
			if (done) break;

			if (useInterFrameGap) {
				// ── Inter-frame gap mode: accumulate until gap exceeds threshold ─
				const now = performance.now();
				rawChunk.push(...value);
				lastByteTime = now;

				if (gapTimer) clearTimeout(gapTimer);
				gapTimer = setTimeout(() => {
					const elapsed = performance.now() - lastByteTime;
					if (elapsed >= interFrameGapMs && rawChunk.length > 0) {
						// rxBuffer should be empty after each previous gap cycle.
						// If it has bytes, they are stale tails from a previous over-long frame.
						// Clear them before processing the new packet.
						if (rxBuffer.length > 0) {
							const staleHex = rxBuffer.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
							logMessage(`WARN Clearing stale tail (${rxBuffer.length} bytes): [${staleHex}]`);
							rxBuffer.length = 0;
						}

						rxBuffer.push(...rawChunk);
						rawChunk = [];
						processRxBuffer(true);

						// After parsing this packet, any leftover bytes are trailing
						// garbage (e.g., the 22nd byte of a 21-byte frame). They belong
						// to THIS packet, not the next. Clear them.
						if (rxBuffer.length > 0) {
							const tailHex = rxBuffer.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
							logMessage(`WARN Discarding ${rxBuffer.length} trailing byte(s): [${tailHex}]`);
							rxBuffer.length = 0;
						}
					}
				}, interFrameGapMs);
			} else {
				// ── Legacy mode: bytes may accumulate across multiple reads()
				// until a complete frame is formed. Do NOT clear leftovers.
				rxBuffer.push(...value);
				processRxBuffer(false);
			}
		}
	} catch (err) {
		logMessage(`WARN ${err.message}`);

		if (commandInterval) {
			clearInterval(commandInterval);
			commandInterval = null;
			logMessage('Stopped sending commands.');
		}

		try {
			await reader?.cancel();
			reader?.releaseLock();
		} catch (e) {}
	}

	if (gapTimer) clearTimeout(gapTimer);
	reading = false;
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

		if (commandTimeout) {
			clearTimeout(commandTimeout);
			commandTimeout = null;
		}

		blocksSentOnce = new Set();
		cycleRunning = false;

		// Clear any pending inter-frame gap timer
		if (typeof gapTimer !== 'undefined' && gapTimer) {
			clearTimeout(gapTimer);
			gapTimer = null;
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

		await sendCommand(config.start_command);
		await sendCommandSequence();

		if (enableWebhook.checked) {
			resetTimer();
		}

		await readLoop();

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

	const dataConfig = getEffectiveDataConfig();
	const namedFields = dataConfig ? Object.keys(dataConfig) : [];
	if (namedFields.length === 0) {
		alert("No data fields configured for this sensor.");
		return;
	}

	// Filter out rows that have no named data at all (only timestamp)
	const rowsWithData = collectedData.filter(row => {
		return namedFields.some(f => row[f] !== undefined);
	});

	if (rowsWithData.length === 0) {
		alert("No data rows with actual sensor values to save.");
		return;
	}

	const fields = ['timestamp', ...namedFields];
	const headers = fields;
	const csvRows = [headers.join(",")];

	rowsWithData.forEach(row => {
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

document.getElementById('saveLog').onclick = () => {
	const logText = log.textContent;
	if (!logText || !logText.trim()) {
		alert("No log content to save.");
		return;
	}
	const blob = new Blob([logText], { type: "text/plain;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.setAttribute("href", url);
	link.setAttribute("download", `polluSens_log_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
};

document.getElementById('saveLog').onclick = () => {
	const logText = log.textContent;
	if (!logText || !logText.trim()) {
		alert("No log content to save.");
		return;
	}
	const blob = new Blob([logText], { type: "text/plain;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.setAttribute("href", url);
	link.setAttribute("download", `polluSens_log_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
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
	  if (!data && config && config.data) {
		  data = {};
		  Object.entries(config.data).forEach(([fieldName, meta]) => {
			  data[fieldName] = parseFloat((Math.random() * 99 + 1).toFixed(3));
		  });
	  }
	  // Also try multi-command data config for test webhook
	  if (!data) {
		  const effData = getEffectiveDataConfig();
		  if (effData) {
			  data = {};
			  Object.entries(effData).forEach(([fieldName, meta]) => {
				  data[fieldName] = parseFloat((Math.random() * 99 + 1).toFixed(3));
			  });
		  }
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