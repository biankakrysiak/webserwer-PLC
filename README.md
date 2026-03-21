# Siemens S7-1200 · AWP Webserver - Pump Control HMI

A browser-based HMI panel for the Siemens S7-1200 PLC, built with the AWP (Automatic Web Programmer) protocol. Provides real-time monitoring and remote control of a pump system directly from the PLC's built-in web server - no additional software required.

---

## Features

- **Live variable monitoring** - reads PLC tags via AWP substitution on every HTTP GET
- **Remote pump control** - START / STOP commands sent as AWP GET parameters
- **Speed regulation** - INCREASE / DECREASE buttons with automatic pulse reset (simulates physical button press)
- **Potentiometer control** - range slider writes directly to `%MW40` (`"Potencjo"`)
- **Alarm handling** - fault indicator with reset button for `zaklocenie01`
- **SVG pump visualization** - animated impeller, fluid flow in pipes, tank levels
- **Tank simulation** - left tank starts at 100%, fluid transfers to right tank proportional to RPM / potentiometer
- **Trend chart** - rolling 60-point canvas chart for RPM, litres/rev, potentiometer
- **Event log** - timestamped log of all PLC state changes and commands sent
- **Local / Remote mode** - toggle between PLC-side (ZL=1) and WWW-side (ZL=0) control

---

## File Structure

```
/
├── index.html          # Main page - AWP variable declarations + SVG layout
├── styles.css          # Dark industrial theme (CSS variables, responsive)
├── js/
│   └── vars-update.js  # All logic: AWP parser, polling, control, visualization
└── jLIB/
    └── jquery-4.0.0.min.js
```

---

## How It Works

### AWP Variable Substitution

The S7-1200 web server replaces placeholders in HTML on every GET request:

```html
<!-- Before substitution (stored on PLC) -->
<div>start :="TrybSterowania_DB".start:</div>

<!-- After substitution (sent to browser) -->
<div>start :=1:</div>
```

The JavaScript parser (`parse()`) extracts all key-value pairs using regex and updates the DOM and visualization accordingly.

### Polling

The page polls itself every **3000 ms** (`POLL_MS`). In remote mode, each poll also writes the current `startHMI` state to keep the level signal active:

```
GET /index.html?%22TrybSterowania_DB%22.startHMI=1
```

### Signal Types

| Signal | Type | Behaviour |
|--------|------|-----------|
| `startHMI` | **Level** | Held at 1 or 0 on every poll - pump runs as long as this is 1 |
| `zwiekszHMI` / `zmniejszHMI` | **Pulse** | JS sends 1, waits for PLC response, then sends 0 automatically |
| `ZL` | **Level** | 0 = Remote (WWW), 1 = Local (PLC physical buttons) |
| `zaklocenie01` (write) | **Reset** | Writes 0 to clear fault |
| `Potencjo` | **Value** | Writes integer 0–27600 to `%MW40` |

### PLC Ladder Logic

```
Network 1 - START:
  (startPlc AND ZL) OR (startHMI AND NOT ZL)  ->  #start

Network 2 - STOP:
  (NOT startPlc AND ZL) OR (NOT startHMI AND NOT ZL) OR zaklocenie01  ->  #stop

Network 3 - INCREASE:
  (zwiekszaPlc AND ZL) OR (zwiekszHMI AND NOT ZL)  ->  #zwieksz

Network 4 - DECREASE:
  (zmniejszaPlc AND ZL) OR (zmniejszHMI AND NOT ZL)  ->  #zmniejsz
```

> **ZL = 1 -> LOCAL mode** (PLC buttons active)  
> **ZL = 0 -> REMOTE mode** (WWW buttons active)

---

## AWP Write Variables

Declared at the top of `index.html` - only these tags can be written via GET:

```html
<!-- AWP_In_Variable Name='"TrybSterowania_DB".startHMI' -->
<!-- AWP_In_Variable Name='"TrybSterowania_DB".zwiekszHMI' -->
<!-- AWP_In_Variable Name='"TrybSterowania_DB".zmniejszHMI' -->
<!-- AWP_In_Variable Name='"TrybSterowania_DB".ZL' -->
<!-- AWP_In_Variable Name='"TrybSterowania_DB".zaklocenie01' -->
<!-- AWP_In_Variable Name='"Potencjo"' -->
<!-- AWP_In_Variable Name='"zaklocenie01"' -->
<!-- AWP_In_Variable Name='"litry"' -->
```

Tags not listed here are **read-only** - the PLC substitutes their values but rejects write attempts.

---

## Key PLC Tags

| Tag | Address | Type | Description |
|-----|---------|------|-------------|
| `"TrybSterowania_DB".start` | DB3.DBX6.0 | Bool | Pump running output |
| `"TrybSterowania_DB".stop` | DB3.DBX6.1 | Bool | Pump stopped output |
| `"TrybSterowania_DB".zwieksz` | DB3.DBX6.2 | Bool | Speed increase output |
| `"TrybSterowania_DB".zmniejsz` | DB3.DBX6.3 | Bool | Speed decrease output |
| `"Sprzeg"` | %M1.0 | Bool | Motor coupling feedback (running) |
| `"ObrotyReal"` | %MD2020 | Real | Encoder speed (raw) |
| `"per min"` | %MD1004 | Real | Speed in RPM |
| `"per liter"` | %MD1008 | Real | Flow in litres/rev |
| `"litry"` | %MD2012 | Real | Cumulative litres pumped |
| `"Potencjo"` | %MW40 | Int | Potentiometer setpoint (0–27600) |
| `"zaklocenie01"` | %I0.3 | Bool | Fault input |

---

## Tank Simulation

The tank levels are **simulated in JavaScript** - they do not correspond to physical sensors. The left tank starts at 100% and drains into the right tank while the pump runs.

Flow rate priority:
1. `"per min"` (RPM from encoder) - used if > 0
2. Potentiometer value scaled to 200–2000 RPM - used as fallback
3. Constant 1000 RPM - absolute fallback

Flow constant: `0.0002` (% of tank per RPM per second). Adjust in `vars-update.js`:

```js
var FLOW_PCT_PER_RPM_PER_SEC = 0.0002;
```

The **↺ Reset** button restores left tank to 100%, right to 0%, and clears the displayed litres counter.

---

## Pipe Animation Directions

| Element ID | Colour | Direction | `stroke-dashoffset` |
|------------|--------|-----------|---------------------|
| `pipe-in-fluid` | Blue | Left -> Right (tank to pump) | `from="0" to="-28"` |
| `pipe-v-in-fluid` | Blue | Bottom -> Up (into pump) | `from="0" to="28"` |
| `pipe-v-out-fluid` | Green | Bottom -> Up (out of pump) | `from="0" to="-28"` |
| `pipe-out-fluid` | Green | Left -> Right (pump to tank) | `from="0" to="-28"` |

---

## Deployment
 
### 1. Enable the Web Server (Hardware configuration)
 
In TIA Portal, open the CPU properties -> **Web server -> General**:
- Check **Activate Web server on all modules of this device**
- Uncheck **Permit access only with HTTPS** (for lab use without certificates)
 
### 2. Set user permissions
 
In **Web server -> User management**, select the `Everybody` user and enable:
- read tags / write tags
- open user-defined web pages / write in user-defined web pages
- read files / write/delete files
 
### 3. Link your HTML files to the PLC
 
In **Web server -> User-defined pages**:
- Set **HTML directory** to the folder containing your project files
- Set **Default HTML page** to `index.html`
- Click **Generate blocks** - this creates the communication DB (default DB333/DB334)
- Download the hardware configuration to the PLC
 
> Any change to the HTML files or to the AWP variables in the PLC program requires deleting the old block and generating a new one, then re-downloading to the PLC.
 
### 4. Set the entry page (optional)
 
In **Web server -> Entry page**, select your user-defined page so the browser opens it directly on `http://<PLC_IP>/`.
 
### 5. Add the WWW function block to your PLC program
 
In the main OB (Main [OB1]), add the **WWW** function block from:
`Instructions -> Communication -> Web Server`
 
Connect the generated DB (DB333) to the `CTRL_DB` input of the WWW block.
 
### 6. Download and open
 
- Download both hardware and software to the PLC
- Open a browser and navigate to `http://<PLC_IP>/index.html`
- Accept the unsecured connection warning if HTTPS is disabled
- The HMI page loads directly from the PLC's internal web server

---

## Browser Compatibility

Tested with the S7-1200 built-in Chromium-based browser. The rotor animation uses `setInterval` + `SVG setAttribute` instead of `requestAnimationFrame` + CSS transforms for maximum compatibility with older embedded browsers.

---

## Dependencies

- **jQuery 4.0.0** - AJAX polling and DOM manipulation (`jLIB/jquery-4.0.0.min.js`)
- No build tools, no npm, no external CDN - fully self-contained for offline PLC deployment

---

*Siemens S7-1200 CPU 1214C DC/DC/DC · TIA Portal V17+ · AWP protocol*
