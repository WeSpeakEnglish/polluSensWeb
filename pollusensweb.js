
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
			const res = await fetch("https://raw.githubusercontent.com/WeSpeakEnglish/polluSensWeb/refs/heads/main/sensors.json");
			rawConfig = await res.json();
			sourceLabel = " (default)";
		}
		} catch (err) {
		logMessage(`❌ Failed to load configuration: ${err.message}`, 1);
		return;
	}
	
	let rawSensors = Array.isArray(rawConfig.sensors) ? rawConfig.sensors : [rawConfig];
	sensors = rawSensors.map(resolveInheritance).filter(s => s && s.name && s.data);
	
	// Convert to map for easy override
	const sensorMap = {};
	
	// Load default sensors first (if not custom load)
	if (!customConfig) {
		defaultSensors = rawSensors;
		defaultSensorNames = rawSensors.map(s => s.name);
		rawSensors.forEach(s => {
			if (s.name) sensorMap[s.name] = s;
		});
		} else {
		// Merge custom sensors into existing map (override if same name)
		rawSensors.forEach(s => {
			if (s.name) sensorMap[s.name] = s;
		});
		
		// Reconstruct sensor list: customs first, then defaults not overridden
		const customNames = rawSensors.map(s => s.name);
		const allNames = [...customNames, ...defaultSensorNames.filter(n => !customNames.includes(n))];
		rawSensors = allNames.map(name => sensorMap[name]).filter(s => s && s.name);
	}
	
	
	rawSensors.forEach(sensor => {
		if (sensor.name) nameToSensor[sensor.name] = sensor;
	});
	
	
	sensors = rawSensors.map(resolveInheritance);
	
	// Populate dropdown
	const selector = document.getElementById('sensorSelector');
	selector.innerHTML = '';
	sensors.forEach((sensor, i) => {
		const opt = document.createElement('option');
		opt.value = i;
		opt.textContent = sensor.name || `Sensor ${i + 1}`;
		
		const isCustom = customConfig && (!defaultSensorNames.includes(sensor.name) || sourceLabel !== " (default)");
		if (isCustom) {
			opt.textContent += " 🆕";
			opt.style.backgroundColor = "#d1ffd1";
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
}


function renderSignalRows() {
	const container = document.getElementById('signalRows');
	container.innerHTML = '';
	if (!config || !config.data) return;
	
	const colors = [
		"#aa0000", "#00aa00", "#0000aa", "#aaaa00",
		"#00aaaa", "#aa00aa", "#aa5500", "#0055aa",
		"#55aa00", "#5500aa", "#aa0055", "#55aaaa"
	];
	
	let colorIndex = 0;
	
	Object.entries(config.data).forEach(([key, meta]) => {
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
		label.prepend(checkbox); // wrap checkbox inside label
		
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
		
		row.append(label, color, tension_label, tension, thickness_label, width);
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
	
	const chart = new Chart(canvas, {
		type: 'line',
		data: {
			datasets: datasets.map(([_, field, color, tension, width]) => ({
				label: `${field}${config.data[field]?.unit ? ' [' + config.data[field].unit + ']' : ''}`,
				data: [],
				borderColor: color,
				tension: parseFloat(tension),
				borderWidth: parseInt(width),
				fill: false,
				pointRadius: 0
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
					title: { display: true, text: 'Time' },
					ticks: { autoSkip: true }
				},
				y: {
					beginAtZero: true,
					title: { display: true, text: name }
				}
			},
			plugins: { legend: { position: 'top' } }
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
				i++; // skip stuffed byte
				continue;
			}
		}
		result.push(data[i]);
	}
	return result;
}

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
					
					} else { // Original logic for fixed-length frames
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
					const valid = eval(checksum.eval) === eval(checksum.compare);
					if (valid) {
						const parsed = {};
						for (const [name, meta] of Object.entries(dataFields)) {
							const expr = typeof meta === 'object' ? meta.value : meta;
							parsed[name] = eval(expr);
						}
						updateCharts(parsed);
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
			} catch (e) {
			// ignore
		}
	}
	
	reading = false;
}


document.getElementById('connect').onclick = async () => {
	const connectBtn = document.getElementById('connect');
	const sensorIndex = parseInt(document.getElementById('sensorSelector').value);
	config = sensors[sensorIndex];
	
	if (port) {
		reading = false;
		
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
		
		await sendCommand(config.start_command);
		await sendCommandIfNeeded();
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
	await loadConfigAndPopulateSelector(); // load default first
});
document.getElementById('jsonUpload').addEventListener('change', async (e) => {
	const file = e.target.files[0];
	if (!file) return;
	
	try {
		const text = await file.text();
		const json = JSON.parse(text);
		
		// Ensure default sensors were loaded (for merging)
		if (!defaultSensorNames.length || !defaultSensors.length) {
			await loadConfigAndPopulateSelector(); // fallback load
		}
		
		await loadConfigAndPopulateSelector(json, file.name);
		} catch (err) {
		logMessage(`❌ Failed to load custom config: ${err.message}`);
	}
});

// ============================================================================
// WEBHOOK LOGIC (FIXED WITH TIME DEBOUNCE)
// ============================================================================

const PROXY_URL = "https://pollutants.eu/proxy/proxy.php";
const MIN_PROCESSING_INTERVAL_MS = 50; 
let intervalTimer = null;
let lastParsedData = null; 
let lastSentLogData = ""; 
let lastProcessedTime = 0; 
let packetCounter = 0;
let webhookCounter = 0;
let isObserverProcessing = false; 

// UI Toggles
enableWebhook.onchange = () => {
	  webhookConfig.style.display = enableWebhook.checked ? "block" : "none";
	  resetTimer();
};
webhookInterval.onchange = resetTimer;

// Header Management
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
	  out = out.replace(/{{field:([^}]+)}}/g, (_, f) => (data[f] !== undefined ? data[f] : "null"));
	  out = out.replace(/{{#fields}}([\s\S]*?){{\/fields}}/g, (_, block) => {
		    const entries = Object.entries(data).filter(([k,v]) => v !== null && isFinite(v));
		    if (!entries.length) return "";
		    return entries.map(([k,v], i) => {
			      let line = block.replace(/{{key}}/g, k).replace(/{{value}}/g, v).trim();
			      return i === entries.length - 1 ? line.replace(/,\s*$/, "") : line;
		    }).join(",\n    ");
	  });
	  return out;
}

async function sendHttpRequest(data) {
	  try {
		    webhookCounter++;
		    if (webhookCount) webhookCount.textContent = webhookCounter;
		    
		    const method = webhookMethod.value;
		    const url = `${PROXY_URL}?url=${encodeURIComponent(webhookUrl.value)}`;
		    // Apply template processing to header values
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

// Trigger Logic
function handleNewPacket(data, dataString) {
	const now = Date.now();
	
	// 1. Time Debounce Check
	if (now - lastProcessedTime < MIN_PROCESSING_INTERVAL_MS) {
		return;
	}
	
	// 2. Data Deduplication Check
	  if (dataString === lastSentLogData) {
		      return;
	  }
	
	// 3. Update state and counter for a unique packet
	  lastSentLogData = dataString;
	lastProcessedTime = now;
	
	  packetCounter++;
	  if (packetCount) packetCount.textContent = packetCounter;
	  lastParsedData = data;
	  
	  // Send immediately only if interval is 0
	  if (enableWebhook.checked && Number(webhookInterval.value) === 0) {
		    sendHttpRequest(data);
	  }
}

// Timer for Interval Mode
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
			      if (lastParsedData) sendHttpRequest(lastParsedData);
		    }, secs * 1000);
	  }
}

// ============================================================================
// 🔍 LOG PARSER 
// ============================================================================

const logElement = document.getElementById('log');

const logObserver = new MutationObserver((mutations) => {
	  if (isObserverProcessing) return;
	  isObserverProcessing = true; 
	
	  try {
		    mutations.forEach((mutation) => {
			      if (mutation.addedNodes.length) {
				        const text = mutation.addedNodes[0].textContent;
				        
				        if (text && text.includes("Parsed:")) {
					          const clean = text.replace("Parsed:", "").trim();
					          const parts = clean.split(",");
					          const data = {};
					          
					          parts.forEach(p => {
						            const [k, v] = p.split(":").map(s => s.trim());
						            if (k && v && !isNaN(parseFloat(v))) {
							              data[k] = parseFloat(v);
						            }
					          });
					          
					          if (Object.keys(data).length > 0) {
						            handleNewPacket(data, clean);
					          }
				        }
			      }
		    });
		  } finally {
		    isObserverProcessing = false; 
	  }
});

logObserver.observe(logElement, { childList: true, subtree: true });

// Manual Test
testWebhook.onclick = () => {
	  const data = lastParsedData || { PM1_0: 1.5, PM2_5: 1.6, PM10: 1.7 };
	  logStatus("Manual Test Triggered", "info");
	  sendHttpRequest(data);
};

// ============================================================================
//  AUTO-GENERATE WEBHOOK URL (FIXED CORS ISSUE)
// ============================================================================

async function fetchNewWebhookUrl() {
	const webhookInput = document.getElementById('webhookUrl');
	const viewLink = document.getElementById('webhookViewLink');
	
	webhookInput.value = "";
	webhookInput.placeholder = "Fetching unique webhook.site URL...";
	viewLink.innerHTML = ""; // Clear old link
	
	// FIX: Route the webhook token request through the existing proxy to avoid CORS block
	const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent('https://webhook.site/token')}`;
	
	try {
		const response = await fetch(proxyUrl, { method: 'POST' });
		
		if (response.ok) {
			const data = await response.json();
			const token = data.uuid;
			const newUrl = `https://webhook.site/${token}`;
			
			webhookInput.value = newUrl;
			webhookInput.placeholder = "Unique URL loaded.";
			
			// Generate View/Edit link
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

// Initialize timer and fetch URL on load
fetchNewWebhookUrl();
resetTimer();
logStatus("System Ready. Rate-limit protection active.", "success");

async function insertCommitDate() {
	const repoUrl = "https://github.com/WeSpeakEnglish/polluSensWeb";
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
		// Format ISO date → DD.MM.YYYY HH:MM
		const d = new Date(iso);
		const pad = (n) => n.toString().padStart(2, "0");
		const formatted =`${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ` + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
		// Insert formatted date with Git icon
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

    const observer = new MutationObserver(() => {
        if (select.options.length < 25) return;

        const options = Array.from(select.options).sort((a, b) =>
            a.text.localeCompare(b.text, undefined, { sensitivity: "base" })
        );

        select.innerHTML = "";
        options.forEach(o => select.appendChild(o));

        observer.disconnect(); // run once, then stop
    });

    observer.observe(select, { childList: true });
}