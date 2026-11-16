/**
 * Module: par.js
 * Precision Approach Radar (PAR) Dual-Scope Renderer & Interactive ATC Controller.
 * - Independent draggable aircraft info panels on both Elevation (top) and Azimuth (bottom) scopes.
 * - Click-to-select aircraft directly on either scope canvas or data block.
 * - Instantaneous UI slider/readout synchronization with realistic pilot delayed flight dynamics.
 */
import { PARAircraft } from './par-aircraft.js';

class PARDisplay {
    constructor(localizerCanvas, glideslopeCanvas) {
        this.locCanvas = localizerCanvas;
        this.gsCanvas = glideslopeCanvas;
        this.locCtx = this.locCanvas.getContext('2d');
        this.gsCtx = this.gsCanvas.getContext('2d');

        this.options = {
            showClutter: true,
            showTrails: true,
            showCorridor: true,
            showDataTags: true,
            paused: false
        };

        this.clutterBlobs = [];
        this.noiseSpeckles = [];
        this.aircraftList = [];
        this.selectedId = null;
        this.lastTime = performance.now();

        // Hitboxes and Drag State for Interactive Canvas Labels & Blips
        this.hitTargets = { elevation: [], azimuth: [] };
        this.dragState = null; // { scopeMode, aircraftId, startMouseX, startMouseY, origOffsetX, origOffsetY }

        this.ensureControlsExist();
        this.resize();
        this.generateRadarNoiseAndClutter();
        this.initDefaultAircraft();
        this.bindUIControls();
        this.bindCanvasInteractions();
        this.startLoop();

        window.addEventListener('resize', () => {
            this.resize();
            this.generateRadarNoiseAndClutter();
        });
    }

    ensureControlsExist() {
        const sidePanel = document.getElementById('parSidePanel');
        if (!sidePanel) return;

        if (!document.getElementById('parHeadingSlider')) {
            sidePanel.innerHTML = `
                <div class="panel-header-badge">
                    <h3>PAR ATC Controller</h3>
                    <span class="status-pill active" id="parPilotStatusPill">ON APPROACH</span>
                </div>

                <div class="par-icon-toolbar">
                    <button class="icon-toggle-btn active" id="btnToggleClutter" title="Toggle Dynamic Clutter & Noise">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12h20M2 6h20M2 18h20"/></svg>
                        <span>Clutter</span>
                    </button>
                    <button class="icon-toggle-btn active" id="btnToggleTrails" title="Toggle History Trails">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                        <span>Trails</span>
                    </button>
                    <button class="icon-toggle-btn active" id="btnToggleCorridor" title="Toggle Safety Funnel">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6l9 12 9-12"/></svg>
                        <span>Funnel</span>
                    </button>
                    <button class="icon-toggle-btn active" id="btnToggleTags" title="Toggle Info Blocks">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                        <span>Blocks</span>
                    </button>
                    <button class="icon-toggle-btn" id="btnTogglePause" title="Freeze Simulation">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                        <span>Pause</span>
                    </button>
                </div>

                <div class="par-control-section">
                    <label for="parAircraftSelect" style="font-size:12px; color:#b0b0b0; display:block; margin-bottom:4px;">Selected Approach Track (Click Blip/Card on Radar)</label>
                    <select id="parAircraftSelect" class="par-select"></select>
                </div>

                <div class="par-control-section">
                    <div class="telemetry-card" id="parSelectedReadout">
                        <div>Loading telemetry...</div>
                    </div>
                </div>

                <div class="par-control-section">
                    <h4>ATC Flight Vectors (RWY 144°)</h4>
                    
                    <div class="par-slider-group">
                        <div class="slider-header">
                            <span>Heading (Cur: <strong id="parCurHdg">144°</strong>)</span>
                            <span>Cmd: <strong id="parTargetHdgVal" style="color:#50e3c2;">144°</strong></span>
                        </div>
                        <input type="range" id="parHeadingSlider" min="100" max="190" step="1" value="144">
                        <div class="btn-row">
                            <button class="par-action-btn" id="parHdgLeftBtn">◀ Left 5°</button>
                            <button class="par-action-btn secondary" id="parInterceptBtn">Capture ILS</button>
                            <button class="par-action-btn" id="parHdgRightBtn">Right 5° ▶</button>
                        </div>
                    </div>

                    <div class="par-slider-group">
                        <div class="slider-header">
                            <span>Altitude (Cur: <strong id="parCurAlt">2500ft</strong>)</span>
                            <span>Cmd: <strong id="parTargetAltVal" style="color:#50e3c2;">2500 ft</strong></span>
                        </div>
                        <input type="range" id="parAltitudeSlider" min="200" max="5000" step="50" value="2500">
                        <div class="btn-row">
                            <button class="par-action-btn" id="parAltDownBtn">▼ -200 ft</button>
                            <button class="par-action-btn secondary" id="parFollowGsBtn">Follow GS</button>
                            <button class="par-action-btn" id="parAltUpBtn">▲ +200 ft</button>
                        </div>
                    </div>

                    <div class="par-slider-group">
                        <div class="slider-header">
                            <span>Speed (Cur: <strong id="parCurSpd">150kt</strong>)</span>
                            <span>Cmd: <strong id="parTargetSpdVal" style="color:#50e3c2;">150 kt</strong></span>
                        </div>
                        <input type="range" id="parSpeedSlider" min="100" max="240" step="5" value="150">
                        <div class="btn-row">
                            <button class="par-action-btn" id="parSpdDownBtn">-10 kt</button>
                            <button class="par-action-btn secondary" id="parFinalSpdBtn">Vref 125kt</button>
                            <button class="par-action-btn" id="parSpdUpBtn">+10 kt</button>
                        </div>
                    </div>
                </div>

                <div class="par-control-section btn-row">
                    <button id="parSpawnBtn" class="par-main-btn primary">+ Spawn Approach</button>
                    <button id="parResetBtn" class="par-main-btn">Reset Demo</button>
                </div>
            `;
        }
    }

    resize() {
        if (this.locCanvas.offsetWidth > 0) {
            this.locCanvas.width = this.locCanvas.offsetWidth;
            this.locCanvas.height = this.locCanvas.offsetHeight;
        }
        if (this.gsCanvas.offsetWidth > 0) {
            this.gsCanvas.width = this.gsCanvas.offsetWidth;
            this.gsCanvas.height = this.gsCanvas.offsetHeight;
        }
    }

    initDefaultAircraft() {
        this.aircraftList = [
            new PARAircraft({
                id: 'ac1',
                callsign: 'BBC434',
                distNm: 8.5,
                lateralOffsetFt: -412,
                altitudeFt: 2760,
                heading: 138,
                speedKts: 167,
                approachMode: 'ILS_CAPTURE',
                gsTagOffset: { x: -45, y: -62 },
                locTagOffset: { x: -45, y: 22 }
            }),
            new PARAircraft({
                id: 'ac2',
                callsign: 'AWA444',
                distNm: 2.8,
                lateralOffsetFt: 25,
                altitudeFt: 890,
                heading: 144,
                speedKts: 122,
                approachMode: 'ILS_CAPTURE',
                gsTagOffset: { x: -55, y: -58 },
                locTagOffset: { x: -55, y: 22 }
            })
        ];

        this.selectedId = 'ac1';
        this.syncDropdownAndControls(true);
    }

    generateRadarNoiseAndClutter() {
        const w = this.locCanvas.width || 900;
        const h = this.locCanvas.height || 360;

        this.clutterBlobs = [];
        for (let i = 0; i < 150; i++) {
            const distFromRight = Math.pow(Math.random(), 1.8) * (w * 0.36);
            this.clutterBlobs.push({
                x: w - distFromRight - 10,
                yOffset: (Math.random() - 0.35) * (h * 0.48),
                w: 2 + Math.random() * 12,
                h: 2 + Math.random() * 16,
                baseAlpha: 0.25 + Math.random() * 0.55,
                alpha: 0.4
            });
        }

        this.noiseSpeckles = [];
        for (let i = 0; i < 750; i++) {
            this.noiseSpeckles.push({
                x: Math.random() * w,
                y: Math.random() * h,
                size: Math.random() > 0.85 ? 2 : 1,
                alpha: 0.05 + Math.random() * 0.22
            });
        }
    }

    nmToX(distNm, width) {
        const maxNm = 26.5;
        const thrX = width * 0.945;
        const leftX = width * 0.02;
        const usableWidth = thrX - leftX;
        return thrX - (distNm / maxNm) * usableWidth;
    }

    getIdealElevationY(distNm, width, height) {
        const baseY = height * 0.44;
        const curveDown = Math.pow(Math.max(0, 1 - distNm / 15), 2.5) * (height * 0.44);
        return baseY + curveDown;
    }

    getIdealAzimuthY(distNm, width, height) {
        const baseY = height * 0.62;
        const curveUp = Math.pow(Math.max(0, 1 - distNm / 15), 2.5) * (height * 0.44);
        return baseY - curveUp;
    }

    startLoop() {
        const tick = (now) => {
            const dt = Math.min(0.1, (now - this.lastTime) / 1000);
            this.lastTime = now;

            this.updateClocks();
            if (!this.options.paused) {
                this.updateSimulation(dt);
            }
            this.render();
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    updateClocks() {
        const now = new Date();
        const localEl = document.getElementById('parLocalTime');
        const utcEl = document.getElementById('parUtcTime');
        if (localEl) localEl.textContent = now.toTimeString().split(' ')[0];
        if (utcEl) utcEl.textContent = now.toISOString().split('T')[1].split('.')[0];
    }

    updateSimulation(dt) {
        if (this.options.showClutter) {
            const w = this.locCanvas.width || 900;
            const h = this.locCanvas.height || 360;
            for (let i = 0; i < this.noiseSpeckles.length; i++) {
                const s = this.noiseSpeckles[i];
                if (Math.random() < 0.25) {
                    s.x = Math.random() * w;
                    s.y = Math.random() * h;
                }
                s.alpha = 0.04 + Math.random() * 0.22;
            }
            for (let i = 0; i < this.clutterBlobs.length; i++) {
                const b = this.clutterBlobs[i];
                b.alpha = b.baseAlpha * (0.75 + Math.random() * 0.45);
            }
        }

        this.aircraftList.forEach(ac => ac.update(dt, 3.2));

        this.updateSelectedTelemetryUI();
        this.syncDropdownAndControls(false);
    }

    render() {
        this.hitTargets.elevation = [];
        this.hitTargets.azimuth = [];

        this.renderScope(this.gsCtx, this.gsCanvas, 'elevation');
        this.renderScope(this.locCtx, this.locCanvas, 'azimuth');
    }

    renderScope(ctx, canvas, mode) {
        const { width, height } = canvas;
        if (!width || !height) return;
        const isAzimuth = mode === 'azimuth';

        ctx.fillStyle = '#181c22';
        ctx.fillRect(0, 0, width, height);

        if (this.options.showClutter) {
            ctx.fillStyle = '#36f57d';
            for (let i = 0; i < this.noiseSpeckles.length; i++) {
                const s = this.noiseSpeckles[i];
                ctx.globalAlpha = s.alpha;
                ctx.fillRect(s.x, s.y, s.size, s.size);
            }
            ctx.globalAlpha = 1.0;
        }

        this.drawGridLines(ctx, width, height, isAzimuth);

        if (this.options.showClutter) {
            this.drawClutterLayer(ctx, width, height, isAzimuth);
        }

        this.drawGuidanceLines(ctx, width, height, isAzimuth);
        this.drawAircraftTargets(ctx, width, height, isAzimuth);
    }

    drawGridLines(ctx, width, height, isAzimuth) {
        const gridSpecs = [
            { nm: 25, label: '25', color: 'rgba(255,255,255,0.16)' },
            { nm: 20, label: '20', color: 'rgba(255,255,255,0.16)' },
            { nm: 15, label: '15', color: 'rgba(255,255,255,0.16)' },
            { nm: 10, label: '10', color: 'rgba(255,255,255,0.26)' },
            { nm: 6.2, label: 'LO', color: '#f5a623', textColor: '#f5a623' },
            { nm: 5, label: '5', color: 'rgba(80, 227, 194, 0.35)' },
            { nm: 0.9, label: 'DH', color: '#d0021b', textColor: '#d0021b' },
            { nm: 0, label: 'THR', color: '#f5a623', textColor: '#f5a623' }
        ];

        ctx.lineWidth = 1;
        ctx.font = 'bold 10px Consolas, monospace';

        gridSpecs.forEach(g => {
            const x = this.nmToX(g.nm, width);
            ctx.strokeStyle = g.color;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();

            ctx.fillStyle = g.textColor || 'rgba(255, 255, 255, 0.65)';
            const labelY = isAzimuth ? 14 : height - 6;
            ctx.fillText(g.label, x + 3, labelY);
        });

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        [0.25, 0.5, 0.75].forEach(r => {
            ctx.beginPath();
            ctx.moveTo(0, height * r);
            ctx.lineTo(width, height * r);
            ctx.stroke();
        });
    }

    drawClutterLayer(ctx, width, height, isAzimuth) {
        const anchorY = isAzimuth ? height * 0.45 : height * 0.72;
        this.clutterBlobs.forEach(b => {
            ctx.fillStyle = `rgba(40, 240, 110, ${b.alpha * 0.7})`;
            ctx.fillRect(b.x, anchorY + b.yOffset, b.w, b.h);
        });
    }

    drawGuidanceLines(ctx, width, height, isAzimuth) {
        const startNm = 26.5;
        const step = 0.25;

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let nm = startNm; nm >= 0; nm -= step) {
            const x = this.nmToX(nm, width);
            const y = isAzimuth ? this.getIdealAzimuthY(nm, width, height) : this.getIdealElevationY(nm, width, height);
            if (nm === startNm) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        if (this.options.showCorridor) {
            ctx.strokeStyle = '#9fe066';
            ctx.lineWidth = 1.1;

            [-1, 1].forEach(dir => {
                ctx.beginPath();
                for (let nm = 16; nm >= 0; nm -= step) {
                    const x = this.nmToX(nm, width);
                    const centerY = isAzimuth ? this.getIdealAzimuthY(nm, width, height) : this.getIdealElevationY(nm, width, height);
                    const spread = (6 + nm * 1.4) * dir;
                    if (nm === 16) ctx.moveTo(x, centerY + spread);
                    else ctx.lineTo(x, centerY + spread);
                }
                ctx.stroke();
            });
        }
    }

    drawAircraftTargets(ctx, width, height, isAzimuth) {
        const scopeKey = isAzimuth ? 'azimuth' : 'elevation';

        this.aircraftList.forEach(ac => {
            const x = this.nmToX(ac.distNm, width);
            const idealY = isAzimuth ? this.getIdealAzimuthY(ac.distNm, width, height) : this.getIdealElevationY(ac.distNm, width, height);
            const gsErrorFt = ac.getGlideslopeErrorFt();
            const offsetPx = isAzimuth ? (ac.lateralOffsetFt * 0.035) : (-gsErrorFt * 0.08);
            const y = idealY + offsetPx;
            const isSelected = ac.id === this.selectedId;

            // Projected Heading Vector Line on Azimuth Scope
            if (isAzimuth) {
                const relAngleRad = ((ac.heading - ac.runwayHeading) * Math.PI) / 180;
                const vecLen = 65;
                ctx.strokeStyle = 'rgba(105, 165, 255, 0.85)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x + Math.cos(relAngleRad) * vecLen, y + Math.sin(relAngleRad) * vecLen);
                ctx.stroke();
            }

            // Jagged White Radar History Trail
            if (this.options.showTrails && ac.trail.length > 1) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ac.trail.forEach((pt, idx) => {
                    const tx = this.nmToX(pt.distNm, width);
                    const tIdealY = isAzimuth ? this.getIdealAzimuthY(pt.distNm, width, height) : this.getIdealElevationY(pt.distNm, width, height);
                    const tOff = isAzimuth ? (pt.latFt * 0.035) : (-pt.gsFt * 0.08);
                    if (idx === 0) ctx.moveTo(tx, tIdealY + tOff);
                    else ctx.lineTo(tx, tIdealY + tOff);
                });
                ctx.lineTo(x, y);
                ctx.stroke();
            }

            // Green Primary Radar Echo Return
            ctx.fillStyle = 'rgba(44, 246, 123, 0.85)';
            ctx.fillRect(x - 4, y - 9, 8, 18);

            // Selection Ring around Selected Blip
            if (isSelected) {
                ctx.strokeStyle = '#fff200';
                ctx.lineWidth = 1.3;
                ctx.beginPath();
                ctx.arc(x, y, 10, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Crisp Crosshair 'X'
            ctx.strokeStyle = isSelected ? '#fff200' : '#ffffff';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(x - 4, y - 4);
            ctx.lineTo(x + 4, y + 4);
            ctx.moveTo(x + 4, y - 4);
            ctx.lineTo(x - 4, y + 4);
            ctx.stroke();

            // Register Blip Hitbox for Click Selection
            this.hitTargets[scopeKey].push({
                type: 'blip',
                aircraftId: ac.id,
                x: x - 12,
                y: y - 12,
                w: 24,
                h: 24
            });

            // Independent Draggable Info Panel for Both Glidepath & Localizer
            if (this.options.showDataTags) {
                const tagOffset = isAzimuth ? ac.locTagOffset : ac.gsTagOffset;
                const boxW = 86;
                const boxH = 44;

                // Keep draggable card clamped comfortably inside canvas boundaries
                const boxX = Math.max(6, Math.min(width - boxW - 6, x + tagOffset.x));
                const boxY = Math.max(6, Math.min(height - boxH - 6, y + tagOffset.y));

                // Draw Leader Line connecting Blip to Draggable Info Panel
                const anchorX = Math.max(boxX, Math.min(boxX + boxW, x));
                const anchorY = Math.max(boxY, Math.min(boxY + boxH, y));
                ctx.strokeStyle = isSelected ? 'rgba(255, 242, 0, 0.75)' : 'rgba(255, 255, 255, 0.55)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(anchorX, anchorY);
                ctx.stroke();

                // Draw Info Panel Background
                ctx.fillStyle = isSelected ? 'rgba(255, 252, 232, 0.94)' : 'rgba(240, 242, 245, 0.9)';
                ctx.fillRect(boxX, boxY, boxW, boxH);

                // Draw Border
                ctx.strokeStyle = isSelected ? '#f5a623' : '#2a2e39';
                ctx.lineWidth = isSelected ? 1.8 : 1;
                ctx.strokeRect(boxX, boxY, boxW, boxH);

                // Render Scope-Specific Aviation Telemetry inside Card
                ctx.font = 'bold 10px Consolas, monospace';
                ctx.fillStyle = '#111';
                ctx.fillText(`${ac.callsign} ${ac.distNm.toFixed(1)}NM`, boxX + 5, boxY + 12);

                ctx.font = '10px Consolas, monospace';
                if (isAzimuth) {
                    const side = ac.lateralOffsetFt >= 0 ? 'R' : 'L';
                    ctx.fillText(`HDG:${Math.round(ac.heading)}° ${Math.round(ac.speedKts)}kt`, boxX + 5, boxY + 25);
                    ctx.fillText(`ERR:${Math.abs(Math.round(ac.lateralOffsetFt))}ft${side} (${ac.getAzimuthErrorDeg()}°)`, boxX + 5, boxY + 37);
                } else {
                    const vsSign = ac.verticalSpeedFpm >= 0 ? '+' : '';
                    ctx.fillText(`ALT:${Math.round(ac.altitudeFt)}ft`, boxX + 5, boxY + 25);
                    ctx.fillText(`GS:${Math.round(gsErrorFt)}ft (${vsSign}${Math.round(ac.verticalSpeedFpm)})`, boxX + 5, boxY + 37);
                }

                // Register Draggable Info Panel Hitbox
                this.hitTargets[scopeKey].push({
                    type: 'card',
                    aircraftId: ac.id,
                    x: boxX,
                    y: boxY,
                    w: boxW,
                    h: boxH
                });
            }
        });
    }

    /**
     * Enables Click-to-Select and Drag-to-Move Info Panels on both Canvas scopes
     */
    bindCanvasInteractions() {
        const attachScopeEvents = (canvas, scopeMode) => {
            canvas.addEventListener('mousedown', (e) => {
                const rect = canvas.getBoundingClientRect();
                const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
                const my = (e.clientY - rect.top) * (canvas.height / rect.height);

                const targets = this.hitTargets[scopeMode];
                // Check topmost hitboxes first (reverse order)
                for (let i = targets.length - 1; i >= 0; i--) {
                    const t = targets[i];
                    if (mx >= t.x && mx <= t.x + t.w && my >= t.y && my <= t.y + t.h) {
                        this.selectedId = t.aircraftId;
                        this.syncDropdownAndControls(true);

                        if (t.type === 'card') {
                            const ac = this.getSelectedAircraft();
                            const offsetObj = scopeMode === 'azimuth' ? ac.locTagOffset : ac.gsTagOffset;
                            this.dragState = {
                                scopeMode,
                                aircraftId: ac.id,
                                startMouseX: mx,
                                startMouseY: my,
                                origOffsetX: offsetObj.x,
                                origOffsetY: offsetObj.y
                            };
                        }
                        break;
                    }
                }
            });

            canvas.addEventListener('mousemove', (e) => {
                const rect = canvas.getBoundingClientRect();
                const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
                const my = (e.clientY - rect.top) * (canvas.height / rect.height);

                if (this.dragState && this.dragState.scopeMode === scopeMode) {
                    const ac = this.aircraftList.find(a => a.id === this.dragState.aircraftId);
                    if (ac) {
                        const dx = mx - this.dragState.startMouseX;
                        const dy = my - this.dragState.startMouseY;
                        const offsetObj = scopeMode === 'azimuth' ? ac.locTagOffset : ac.gsTagOffset;
                        offsetObj.x = this.dragState.origOffsetX + dx;
                        offsetObj.y = this.dragState.origOffsetY + dy;
                    }
                    canvas.style.cursor = 'grabbing';
                    return;
                }

                // Hover cursor feedback
                const targets = this.hitTargets[scopeMode];
                let hoveredType = null;
                for (let i = targets.length - 1; i >= 0; i--) {
                    const t = targets[i];
                    if (mx >= t.x && mx <= t.x + t.w && my >= t.y && my <= t.y + t.h) {
                        hoveredType = t.type;
                        break;
                    }
                }
                canvas.style.cursor = hoveredType === 'card' ? 'grab' : (hoveredType === 'blip' ? 'pointer' : 'default');
            });

            window.addEventListener('mouseup', () => {
                if (this.dragState) {
                    this.dragState = null;
                }
            });
        };

        attachScopeEvents(this.gsCanvas, 'elevation');
        attachScopeEvents(this.locCanvas, 'azimuth');
    }

    bindUIControls() {
        const selectEl = document.getElementById('parAircraftSelect');
        const hdgSlider = document.getElementById('parHeadingSlider');
        const altSlider = document.getElementById('parAltitudeSlider');
        const spdSlider = document.getElementById('parSpeedSlider');

        selectEl?.addEventListener('change', (e) => {
            this.selectedId = e.target.value;
            this.syncDropdownAndControls(true);
        });

        hdgSlider?.addEventListener('input', (e) => {
            const ac = this.getSelectedAircraft();
            if (!ac) return;
            const targetHdg = parseInt(e.target.value, 10);
            ac.commandHeading(targetHdg);
            this.syncDropdownAndControls(true);
        });

        altSlider?.addEventListener('input', (e) => {
            const ac = this.getSelectedAircraft();
            if (!ac) return;
            const targetAlt = parseInt(e.target.value, 10);
            ac.commandAltitude(targetAlt);
            this.syncDropdownAndControls(true);
        });

        spdSlider?.addEventListener('input', (e) => {
            const ac = this.getSelectedAircraft();
            if (!ac) return;
            const targetSpd = parseInt(e.target.value, 10);
            ac.commandSpeed(targetSpd);
            this.syncDropdownAndControls(true);
        });

        document.getElementById('parHdgLeftBtn')?.addEventListener('click', () => {
            const ac = this.getSelectedAircraft();
            if (ac) {
                ac.commandHeading(ac.assignedHeading - 5);
                this.syncDropdownAndControls(true);
            }
        });

        document.getElementById('parHdgRightBtn')?.addEventListener('click', () => {
            const ac = this.getSelectedAircraft();
            if (ac) {
                ac.commandHeading(ac.assignedHeading + 5);
                this.syncDropdownAndControls(true);
            }
        });

        document.getElementById('parInterceptBtn')?.addEventListener('click', () => {
            const ac = this.getSelectedAircraft();
            if (ac) {
                ac.commandCaptureApproach();
                this.syncDropdownAndControls(true);
            }
        });

        document.getElementById('parAltDownBtn')?.addEventListener('click', () => {
            const ac = this.getSelectedAircraft();
            if (ac) {
                ac.commandAltitude(ac.assignedAltitudeFt - 200);
                this.syncDropdownAndControls(true);
            }
        });

        document.getElementById('parAltUpBtn')?.addEventListener('click', () => {
            const ac = this.getSelectedAircraft();
            if (ac) {
                ac.commandAltitude(ac.assignedAltitudeFt + 200);
                this.syncDropdownAndControls(true);
            }
        });

        document.getElementById('parFollowGsBtn')?.addEventListener('click', () => {
            const ac = this.getSelectedAircraft();
            if (ac) {
                ac.commandCaptureApproach();
                this.syncDropdownAndControls(true);
            }
        });

        document.getElementById('parSpdDownBtn')?.addEventListener('click', () => {
            const ac = this.getSelectedAircraft();
            if (ac) {
                ac.commandSpeed(ac.assignedSpeedKts - 10);
                this.syncDropdownAndControls(true);
            }
        });

        document.getElementById('parSpdUpBtn')?.addEventListener('click', () => {
            const ac = this.getSelectedAircraft();
            if (ac) {
                ac.commandSpeed(ac.assignedSpeedKts + 10);
                this.syncDropdownAndControls(true);
            }
        });

        document.getElementById('parFinalSpdBtn')?.addEventListener('click', () => {
            const ac = this.getSelectedAircraft();
            if (ac) {
                ac.commandSpeed(125);
                this.syncDropdownAndControls(true);
            }
        });

        const setupIconToggle = (btnId, optionKey) => {
            const btn = document.getElementById(btnId);
            btn?.addEventListener('click', () => {
                this.options[optionKey] = !this.options[optionKey];
                btn.classList.toggle('active', this.options[optionKey]);
            });
        };

        setupIconToggle('btnToggleClutter', 'showClutter');
        setupIconToggle('btnToggleTrails', 'showTrails');
        setupIconToggle('btnToggleCorridor', 'showCorridor');
        setupIconToggle('btnToggleTags', 'showDataTags');
        setupIconToggle('btnTogglePause', 'paused');

        document.getElementById('parSpawnBtn')?.addEventListener('click', () => {
            const id = 'ac' + Date.now();
            const num = Math.floor(100 + Math.random() * 899);
            this.aircraftList.push(new PARAircraft({
                id,
                callsign: `BAF${num}`,
                distNm: 15.0,
                lateralOffsetFt: (Math.random() - 0.5) * 450,
                altitudeFt: 4750,
                heading: 144,
                speedKts: 165,
                approachMode: 'ILS_CAPTURE',
                gsTagOffset: { x: 24, y: -48 },
                locTagOffset: { x: 24, y: 20 }
            }));
            this.selectedId = id;
            this.syncDropdownAndControls(true);
        });

        document.getElementById('parResetBtn')?.addEventListener('click', () => {
            this.initDefaultAircraft();
        });
    }

    getSelectedAircraft() {
        return this.aircraftList.find(a => a.id === this.selectedId);
    }

    syncDropdownAndControls(forceUpdate = false) {
        const selectEl = document.getElementById('parAircraftSelect');
        if (selectEl) {
            if (forceUpdate || selectEl.options.length !== this.aircraftList.length) {
                selectEl.innerHTML = this.aircraftList.map(ac =>
                    `<option value="${ac.id}" ${ac.id === this.selectedId ? 'selected' : ''}>${ac.callsign} (${ac.distNm.toFixed(1)} NM)</option>`
                ).join('');
            } else {
                // Keep dropdown distance text fresh without resetting open dropdown state
                Array.from(selectEl.options).forEach((opt, idx) => {
                    const acItem = this.aircraftList[idx];
                    if (acItem) {
                        opt.textContent = `${acItem.callsign} (${acItem.distNm.toFixed(1)} NM)`;
                        opt.selected = acItem.id === this.selectedId;
                    }
                });
            }
        }

        const ac = this.getSelectedAircraft();
        if (!ac) return;

        const hdgSlider = document.getElementById('parHeadingSlider');
        const altSlider = document.getElementById('parAltitudeSlider');
        const spdSlider = document.getElementById('parSpeedSlider');

        if (hdgSlider && (forceUpdate || document.activeElement !== hdgSlider)) {
            hdgSlider.value = Math.round(ac.assignedHeading);
        }
        if (altSlider && (forceUpdate || document.activeElement !== altSlider)) {
            altSlider.value = Math.round(ac.assignedAltitudeFt);
        }
        if (spdSlider && (forceUpdate || document.activeElement !== spdSlider)) {
            spdSlider.value = Math.round(ac.assignedSpeedKts);
        }

        const curHdgEl = document.getElementById('parCurHdg');
        const tgtHdgEl = document.getElementById('parTargetHdgVal');
        const curAltEl = document.getElementById('parCurAlt');
        const tgtAltEl = document.getElementById('parTargetAltVal');
        const curSpdEl = document.getElementById('parCurSpd');
        const tgtSpdEl = document.getElementById('parTargetSpdVal');
        const statusPill = document.getElementById('parPilotStatusPill');

        if (curHdgEl) curHdgEl.textContent = `${Math.round(ac.heading)}°`;
        if (tgtHdgEl) {
            tgtHdgEl.textContent = ac.approachMode === 'ILS_CAPTURE'
                ? `AUTO (${Math.round(ac.assignedHeading)}°)`
                : `${Math.round(ac.assignedHeading)}°`;
        }

        if (curAltEl) curAltEl.textContent = `${Math.round(ac.altitudeFt)}ft`;
        if (tgtAltEl) {
            tgtAltEl.textContent = ac.approachMode === 'ILS_CAPTURE'
                ? `3° GS (${Math.round(ac.assignedAltitudeFt)}ft)`
                : `${Math.round(ac.assignedAltitudeFt)} ft`;
        }

        if (curSpdEl) curSpdEl.textContent = `${Math.round(ac.speedKts)}kt`;
        if (tgtSpdEl) tgtSpdEl.textContent = `${Math.round(ac.assignedSpeedKts)} kt`;

        if (statusPill) {
            if (ac.pilotReactionTimer > 0) {
                statusPill.textContent = 'PILOT COPYING...';
                statusPill.style.color = '#f5a623';
                statusPill.style.borderColor = '#f5a623';
            } else {
                statusPill.textContent = ac.approachMode === 'ILS_CAPTURE' ? 'ON APPROACH' : 'FLYING VECTOR';
                statusPill.style.color = '#50e3c2';
                statusPill.style.borderColor = '#50e3c2';
            }
        }
    }

    updateSelectedTelemetryUI() {
        const ac = this.getSelectedAircraft();
        const readout = document.getElementById('parSelectedReadout');
        if (!ac || !readout) return;

        const vsSign = ac.verticalSpeedFpm >= 0 ? '+' : '';
        readout.innerHTML = `
            <div><strong>${ac.callsign}</strong> | Mode: <span style="color:#50e3c2">${ac.approachMode}</span></div>
            <div>Range: ${ac.distNm.toFixed(2)} NM | Alt: ${Math.round(ac.altitudeFt)} ft (${vsSign}${Math.round(ac.verticalSpeedFpm)} fpm)</div>
            <div>Heading: ${Math.round(ac.heading)}° → ${Math.round(ac.assignedHeading)}° | Speed: ${Math.round(ac.speedKts)} kts</div>
            <div>Loc Err: ${Math.round(ac.lateralOffsetFt)} ft | GS Err: ${Math.round(ac.getGlideslopeErrorFt())} ft</div>
        `;
    }
}

export function initializeParDisplay() {
    const localizerCanvas = document.getElementById('parLocalizerCanvas');
    const glideslopeCanvas = document.getElementById('parGlideslopeCanvas');
    if (localizerCanvas && glideslopeCanvas) {
        new PARDisplay(localizerCanvas, glideslopeCanvas);
    }
}