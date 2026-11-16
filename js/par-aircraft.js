/**
 * Module: par-aircraft.js
 * Handles autonomous flight dynamics, pilot reaction latency, banking/turn inertia,
 * vertical speed (FPM) climbs/descents, and independent draggable label offsets for both scopes.
 */

export class PARAircraft {
    constructor(config) {
        this.id = config.id;
        this.callsign = config.callsign;
        this.runwayHeading = config.runwayHeading || 144;

        // Position & Trajectory State
        this.distNm = config.distNm ?? 10.0;
        this.lateralOffsetFt = config.lateralOffsetFt ?? 0;
        this.altitudeFt = config.altitudeFt ?? Math.round(this.distNm * 318);

        // Current Aerodynamic State
        this.heading = config.heading ?? this.runwayHeading;
        this.speedKts = config.speedKts ?? 150;
        this.verticalSpeedFpm = 0;

        // ATC Assigned Targets (Updated immediately when controller issues commands)
        this.assignedHeading = this.heading;
        this.assignedAltitudeFt = this.altitudeFt;
        this.assignedSpeedKts = this.speedKts;
        this.approachMode = config.approachMode || 'VECTOR';

        // Pilot Reaction Latency (Simulates pilot readback & control input delay)
        this.pilotReactionTimer = 0;
        this.activeHeadingTarget = this.heading;
        this.activeAltitudeTarget = this.altitudeFt;

        // Aircraft Performance Limits
        this.maxTurnRateDegSec = 2.8;
        this.maxAccelKtsSec = 2.5;
        this.maxPitchRateFpmSec = 400;
        this.maxClimbFpm = 1800;
        this.maxDescentFpm = -1500;

        // Independent Draggable Data Block Offsets (relative to aircraft screen position)
        this.gsTagOffset = config.gsTagOffset || { x: 24, y: -48 };
        this.locTagOffset = config.locTagOffset || { x: 24, y: 20 };

        // History Trail for Radar Display
        this.trail = [];
        this.trailTimer = 0;

        this._seedInitialTrail();
    }

    _seedInitialTrail() {
        for (let i = 18; i >= 1; i--) {
            const pastDist = this.distNm + i * 0.11;
            const idealAlt = pastDist * 318;
            this.trail.push({
                distNm: pastDist,
                latFt: this.lateralOffsetFt + (Math.random() - 0.5) * 35,
                gsFt: (this.altitudeFt - idealAlt) + (Math.random() - 0.5) * 18
            });
        }
    }

    /**
     * ATC Issues a new Heading Command
     */
    commandHeading(newHeading) {
        this.approachMode = 'VECTOR';
        this.assignedHeading = ((Math.round(newHeading) % 360) + 360) % 360;
        this.pilotReactionTimer = 1.4;
    }

    /**
     * ATC Issues a new Altitude Command
     */
    commandAltitude(newAltFt) {
        this.approachMode = 'VECTOR';
        this.assignedAltitudeFt = Math.max(0, Math.min(6000, Math.round(newAltFt)));
        this.pilotReactionTimer = 1.2;
    }

    /**
     * ATC Issues a new Airspeed Command
     */
    commandSpeed(newSpeedKts) {
        this.assignedSpeedKts = Math.max(95, Math.min(250, Math.round(newSpeedKts)));
    }

    /**
     * Clears pilot to autonomously intercept and fly the 3-degree PAR/ILS Glide & Centerline
     */
    commandCaptureApproach() {
        this.approachMode = 'ILS_CAPTURE';
        this.pilotReactionTimer = 1.0;
    }

    /**
     * Main Physics Integration Step
     */
    update(dt, timeScale = 3.5) {
        const simDt = dt * timeScale;

        // 1. Pilot Reaction Latency Handling
        if (this.pilotReactionTimer > 0) {
            this.pilotReactionTimer = Math.max(0, this.pilotReactionTimer - dt);
        } else {
            this.activeHeadingTarget = this.assignedHeading;
            this.activeAltitudeTarget = this.assignedAltitudeFt;
        }

        // 2. Autonomous ILS / PAR Final Approach Guidance Calculation
        if (this.approachMode === 'ILS_CAPTURE') {
            const interceptCorrection = Math.max(-30, Math.min(30, -this.lateralOffsetFt * 0.025));
            this.assignedHeading = Math.round((this.runwayHeading + interceptCorrection + 360) % 360);
            this.assignedAltitudeFt = Math.max(0, Math.round(this.distNm * 318));

            if (this.pilotReactionTimer <= 0) {
                this.activeHeadingTarget = this.assignedHeading;
                this.activeAltitudeTarget = this.assignedAltitudeFt;
            }

            if (this.distNm < 4.0) {
                this.assignedSpeedKts = Math.max(115, Math.round(115 + (this.distNm * 8)));
            }
        }

        // 3. Smooth Airspeed Change
        const speedDiff = this.assignedSpeedKts - this.speedKts;
        if (Math.abs(speedDiff) > 0.1) {
            const accel = Math.sign(speedDiff) * Math.min(Math.abs(speedDiff), this.maxAccelKtsSec * simDt);
            this.speedKts += accel;
        }

        // 4. Smooth Heading Change (Bank Angle & Turn Rate Physics)
        const headingDiff = ((this.activeHeadingTarget - this.heading + 540) % 360) - 180;
        if (Math.abs(headingDiff) > 0.05) {
            const turnStep = Math.sign(headingDiff) * Math.min(Math.abs(headingDiff), this.maxTurnRateDegSec * simDt);
            this.heading = (this.heading + turnStep + 360) % 360;
        }

        // 5. Lateral & Forward Motion Trigonometry relative to Runway Heading (144 deg)
        const relAngleRad = ((this.heading - this.runwayHeading) * Math.PI) / 180;
        const speedNmPerSec = this.speedKts / 3600;
        const speedFtPerSec = (this.speedKts * 6076.12) / 3600;

        const forwardNm = Math.cos(relAngleRad) * speedNmPerSec * simDt;
        this.distNm -= forwardNm;

        const lateralMoveFt = Math.sin(relAngleRad) * speedFtPerSec * simDt;
        this.lateralOffsetFt += lateralMoveFt;

        // 6. Smooth Vertical Speed (Pitch Inertia) & Altitude Integration
        const altDiff = this.activeAltitudeTarget - this.altitudeFt;
        let desiredVsFpm = 0;

        if (this.approachMode === 'ILS_CAPTURE' && this.pilotReactionTimer <= 0) {
            const baseDescentFpm = -5.3 * this.speedKts;
            const gsError = this.activeAltitudeTarget - this.altitudeFt;
            desiredVsFpm = Math.max(this.maxDescentFpm, Math.min(600, baseDescentFpm + gsError * 2.5));
        } else {
            if (Math.abs(altDiff) > 5) {
                desiredVsFpm = Math.max(this.maxDescentFpm, Math.min(this.maxClimbFpm, altDiff * 3.0));
            }
        }

        const vsDiff = desiredVsFpm - this.verticalSpeedFpm;
        const vsStep = Math.sign(vsDiff) * Math.min(Math.abs(vsDiff), this.maxPitchRateFpmSec * simDt);
        this.verticalSpeedFpm += vsStep;

        this.altitudeFt = Math.max(0, this.altitudeFt + (this.verticalSpeedFpm / 60) * simDt);

        // 7. Record Radar Trail History
        this.trailTimer += simDt;
        if (this.trailTimer >= 1.8) {
            this.trailTimer = 0;
            this.trail.push({
                distNm: this.distNm,
                latFt: this.lateralOffsetFt + (Math.random() - 0.5) * 16,
                gsFt: this.getGlideslopeErrorFt() + (Math.random() - 0.5) * 10
            });
            if (this.trail.length > 50) this.trail.shift();
        }

        if (this.distNm <= 0.05) {
            this.resetApproach();
        }
    }

    resetApproach() {
        this.distNm = 14.5;
        this.lateralOffsetFt = (Math.random() - 0.5) * 500;
        this.heading = this.runwayHeading;
        this.assignedHeading = this.runwayHeading;
        this.activeHeadingTarget = this.runwayHeading;
        this.altitudeFt = Math.round(this.distNm * 318);
        this.assignedAltitudeFt = this.altitudeFt;
        this.activeAltitudeTarget = this.altitudeFt;
        this.speedKts = 160;
        this.assignedSpeedKts = 160;
        this.approachMode = 'ILS_CAPTURE';
        this.trail = [];
    }

    getAzimuthErrorDeg() {
        const distFt = Math.max(500, this.distNm * 6076.12);
        return +((Math.atan2(this.lateralOffsetFt, distFt) * 180) / Math.PI).toFixed(1);
    }

    getGlideslopeErrorFt() {
        const idealAlt = this.distNm * 318;
        return this.altitudeFt - idealAlt;
    }

    getGlideslopeErrorDeg() {
        const distFt = Math.max(500, this.distNm * 6076.12);
        return +((Math.atan2(this.getGlideslopeErrorFt(), distFt) * 180) / Math.PI).toFixed(1);
    }
}