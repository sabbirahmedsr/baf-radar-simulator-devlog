/**
 * Module: three-viewer.js
 *
 * Generic, reusable Three.js scene viewer supporting GLB models,
 * animations, UI controls, and dynamic 2D HTML markers via CSS2DRenderer.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export class ThreeDViewer {
    constructor(config) {
        this.config = config;
        this.canvas = document.getElementById(config.canvasId);

        if (!this.canvas) {
            console.error(`[ThreeDViewer] Canvas with id ${config.canvasId} not found.`);
            return;
        }

        this.animations = new Map();
        this.markers = [];
        this.markersVisible = true;
        this.isPlaying = false;

        this.resizeObserver = new ResizeObserver(entries => {
            if (entries.length > 0 && entries[0].contentRect.width > 0) {
                this.loadModel();
                this.resizeObserver.disconnect();
            }
        });
        this.resizeObserver.observe(this.canvas);
    }

    init() {
        this.clock = new THREE.Clock();
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color().setHSL(0.6, 0, 1);
        this.scene.fog = new THREE.Fog(this.scene.background, 1, 5000);

        // --- Camera ---
        const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        this.perspectiveCamera = new THREE.PerspectiveCamera(30, aspect, 0.1, 1000);
        this.perspectiveCamera.position.set(0, 3, 7);

        const frustumSize = 5;
        this.orthographicCamera = new THREE.OrthographicCamera(
            frustumSize * aspect / -2, frustumSize * aspect / 2,
            frustumSize / 2, frustumSize / -2, 0.1, 1000
        );
        this.orthographicCamera.position.set(0, 3, 7);
        this.camera = this.perspectiveCamera;

        // --- WebGL Renderer ---
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.BasicShadowMap;

        // --- CSS2D Renderer (Only initialized if markers are configured) ---
        if (this.config.markers && this.config.markers.length > 0) {
            this.labelRenderer = new CSS2DRenderer();
            this.labelRenderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
            this.labelRenderer.domElement.style.position = 'absolute';
            this.labelRenderer.domElement.style.top = '0px';
            this.labelRenderer.domElement.style.left = '0px';
            this.labelRenderer.domElement.style.pointerEvents = 'none';
            this.labelRenderer.domElement.style.zIndex = '5';
            this.canvas.parentElement.appendChild(this.labelRenderer.domElement);
        }

        // --- Lighting & Sky ---
        this.createLighting();
        this.createSkyAndGround();

        // --- Grid Helper ---
        const gridColor = new THREE.Color().setHSL(0.095, 1, 0.65);
        this.gridHelper = new THREE.GridHelper(50, 50, gridColor, gridColor);
        this.scene.add(this.gridHelper);
        this.gridHelper.visible = false;

        // --- Orbit Controls ---
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
        this.controls.zoomSpeed = 2.0;
        this.controls.target.set(0, 0.5, 0);
        this.controls.saveState();

        // --- Event Listeners ---
        this.setupEventListeners();
    }

    createLighting() {
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 2);
        hemiLight.color.setHSL(0.6, 1, 0.6);
        hemiLight.groundColor.setHSL(0.095, 1, 0.75);
        hemiLight.position.set(0, 50, 0);
        this.scene.add(hemiLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 3);
        dirLight.color.setHSL(0.1, 1, 0.95);
        dirLight.position.set(-1, 1.75, 1);
        dirLight.position.multiplyScalar(30);
        this.scene.add(dirLight);

        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        const d = 50;
        dirLight.shadow.camera.left = -d;
        dirLight.shadow.camera.right = d;
        dirLight.shadow.camera.top = d;
        dirLight.shadow.camera.bottom = -d;
        dirLight.shadow.camera.far = 3500;
        dirLight.shadow.bias = -0.0001;
    }

    createSkyAndGround() {
        const groundGeo = new THREE.PlaneGeometry(10000, 10000);
        const groundMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        groundMat.color.setHSL(0.095, 1, 0.75);
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.position.y = this.config.groundLevel ?? -0.7;
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        const skyGeo = new THREE.SphereGeometry(4000, 32, 15);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                'topColor': { value: new THREE.Color(0x0077ff).setHSL(0.6, 1, 0.6) },
                'bottomColor': { value: new THREE.Color(0xffffff).setHSL(0.095, 1, 0.75) },
                'offset': { value: Math.abs(ground.position.y) },
                'exponent': { value: 0.6 }
            },
            vertexShader: `varying vec3 vWorldPosition; void main() { vec4 worldPosition = modelMatrix * vec4( position, 1.0 ); vWorldPosition = worldPosition.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
            fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPosition; void main() { float h = normalize( vWorldPosition + offset ).y; gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max( h , 0.0), exponent ), 0.0 ) ), 1.0 ); }`,
            side: THREE.BackSide
        });
        const sky = new THREE.Mesh(skyGeo, skyMat);
        this.scene.add(sky);
    }

    loadModel() {
        const loader = new GLTFLoader();
        loader.load(this.config.modelPath, (gltf) => {
            this.model = gltf.scene;
            this.init();
            this.scene.add(this.model);

            this.model.traverse(child => {
                if (child.isMesh) child.castShadow = true;
            });

            if (this.config.markers && this.config.markers.length > 0) {
                this.setupMarkers();
            }

            if (gltf.animations && gltf.animations.length > 0 && this.config.animation) {
                this.mixer = new THREE.AnimationMixer(this.model);
                gltf.animations.forEach(clip => {
                    const action = this.mixer.clipAction(clip);
                    action.setLoop(THREE.LoopRepeat);
                    this.animations.set(clip.name, action);
                });
                this.setupAnimationControls();
            }

            this.animate();
        }, undefined, (error) => console.error(`[ThreeDViewer] Error loading model:`, error));
    }

    setupMarkers() {
        this.config.markers.forEach(markerData => {
            const anchorObject = this.model.getObjectByName(markerData.nodeName);
            if (!anchorObject) {
                console.warn(`[ThreeDViewer] Marker anchor "${markerData.nodeName}" not found in model.`);
                return;
            }

            const markerDiv = document.createElement('div');
            markerDiv.className = `station-marker marker-${markerData.type || 'officer'}`;
            markerDiv.innerHTML = `
                <div class="marker-badge">
                    <span class="marker-dot"></span>
                    <span class="marker-title">${markerData.label}</span>
                    ${markerData.detail ? `<span class="marker-detail">• ${markerData.detail}</span>` : ''}
                </div>
                <div class="marker-stem"></div>
            `;

            const labelObject = new CSS2DObject(markerDiv);
            labelObject.position.set(0, markerData.yOffset || 0, 0);
            anchorObject.add(labelObject);

            this.markers.push(markerDiv);
        });
    }

    toggleMarkers() {
        this.markersVisible = !this.markersVisible;
        this.markers.forEach(el => {
            el.classList.toggle('hidden', !this.markersVisible);
        });
        document.getElementById(this.config.controls?.markers)?.classList.toggle('active', this.markersVisible);
    }

    setupEventListeners() {
        window.addEventListener('resize', () => this.onResize());

        const { controls: ctrlIds } = this.config;
        if (!ctrlIds) return;

        const get = (id) => id ? document.getElementById(id) : null;

        get(ctrlIds.play)?.addEventListener('click', () => this.toggleAnimation());
        get(ctrlIds.maximize)?.addEventListener('click', () => this.toggleFullscreen());
        get(ctrlIds.reset)?.addEventListener('click', () => this.resetView());
        get(ctrlIds.grid)?.addEventListener('click', () => this.toggleGrid());
        get(ctrlIds.camera)?.addEventListener('click', () => this.toggleCameraProjection());
        get(ctrlIds.markers)?.addEventListener('click', () => this.toggleMarkers());

        document.addEventListener('fullscreenchange', () => {
            const container = this.canvas.closest('.animation-container');
            if (!container) return;
            const isFullscreen = document.fullscreenElement === container;
            container.classList.toggle('fullscreen', isFullscreen);
            requestAnimationFrame(() => this.onResize());
        });
    }

    onResize() {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        const aspect = width / height;

        if (this.camera.isPerspectiveCamera) {
            this.camera.aspect = aspect;
        } else if (this.camera.isOrthographicCamera) {
            const frustumHeight = this.camera.top - this.camera.bottom;
            const frustumWidth = frustumHeight * aspect;
            this.camera.left = -frustumWidth / 2;
            this.camera.right = frustumWidth / 2;
        }

        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        if (this.labelRenderer) {
            this.labelRenderer.setSize(width, height);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.mixer) {
            this.mixer.update(this.clock.getDelta());
            this.updateTimelineUI();
        }
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        if (this.labelRenderer) {
            this.labelRenderer.render(this.scene, this.camera);
        }
    }

    resetView() {
        if (!this.controls) return;
        if (this.camera !== this.perspectiveCamera) this.toggleCameraProjection();
        this.controls.reset();
        if (this.mixer) {
            this.animations.forEach(action => {
                action.stop();
                action.time = 0;
                action.paused = true;
            });
            this.isPlaying = false;
            const playBtn = document.getElementById(this.config.controls?.play);
            if (playBtn) playBtn.textContent = 'Play';
            this.updateTimelineUI();
        }
    }

    toggleGrid() {
        if (!this.gridHelper) return;
        this.gridHelper.visible = !this.gridHelper.visible;
        document.getElementById(this.config.controls?.grid)?.classList.toggle('active', this.gridHelper.visible);
    }

    toggleCameraProjection() {
        if (!this.camera || !this.controls) return;
        const isOrtho = this.camera.isOrthographicCamera;
        this.camera = isOrtho ? this.perspectiveCamera : this.orthographicCamera;
        this.controls.object = this.camera;
        this.onResize();
        document.getElementById(this.config.controls?.camera)?.classList.toggle('ortho-active', !isOrtho);
    }

    toggleFullscreen() {
        const container = this.canvas.closest('.animation-container');
        if (!container) return;
        if (!document.fullscreenElement) {
            container.requestFullscreen().catch(err => alert(`Fullscreen error: ${err.message}`));
        } else {
            document.exitFullscreen();
        }
    }

    // --- Animation Specific Methods ---

    setupAnimationControls() {
        const { timeline: timelineId, states } = this.config.animation;
        const timelineContainer = document.getElementById(timelineId);
        if (!timelineContainer || !states) return;

        const firstAction = this.animations.values().next().value;
        const totalDuration = firstAction.getClip().duration;
        const stateKeys = Object.keys(states);

        for (let i = 0; i < stateKeys.length; i++) {
            const currentStateKey = stateKeys[i];
            const nextStateKey = stateKeys[i + 1];
            const startTime = states[currentStateKey] / 24;
            const endTime = nextStateKey ? states[nextStateKey] / 24 : totalDuration;
            const duration = endTime - startTime;
            const button = timelineContainer.querySelector(`[data-state="${currentStateKey}"]`);
            if (button) button.style.flexGrow = duration;
        }

        timelineContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('timeline-step')) {
                this.goToState(e.target.dataset.state);
            }
        });

        this.goToState(stateKeys[0]);
        this.toggleAnimation();
    }

    toggleAnimation() {
        if (this.animations.size === 0) return;
        this.isPlaying = !this.isPlaying;
        this.animations.forEach(action => {
            action.paused = !this.isPlaying;
            if (this.isPlaying && !action.isRunning()) action.play();
        });
        const playBtn = document.getElementById(this.config.controls?.play);
        if (playBtn) playBtn.textContent = this.isPlaying ? 'Pause' : 'Play';
    }

    goToState(state) {
        if (!this.config.animation?.states || !this.mixer) return;
        const frame = this.config.animation.states[state];
        if (typeof frame !== 'number') return;

        const time = frame / 24;
        this.animations.forEach(action => {
            action.time = time;
            action.paused = false;
            if (!action.isRunning()) action.play();
        });
        this.isPlaying = true;
        const playBtn = document.getElementById(this.config.controls?.play);
        if (playBtn) playBtn.textContent = 'Pause';
    }

    updateTimelineUI() {
        const { timeline: timelineId, states } = this.config.animation;
        const timelineContainer = document.getElementById(timelineId);
        if (!timelineContainer || !this.mixer) return;

        const firstAction = this.animations.values().next().value;
        const currentTime = firstAction.time;
        const totalDuration = firstAction.getClip().duration;

        const progressIndicator = timelineContainer.querySelector('.timeline-progress');
        progressIndicator.style.width = `${(currentTime / totalDuration) * 100}%`;

        let activeState = null;
        const stateKeys = Object.keys(states);
        for (let i = stateKeys.length - 1; i >= 0; i--) {
            const stateKey = stateKeys[i];
            if (currentTime >= states[stateKey] / 24) {
                activeState = stateKey;
                break;
            }
        }

        if (timelineContainer.dataset.currentState !== activeState) {
            timelineContainer.dataset.currentState = activeState;
            timelineContainer.querySelectorAll('.timeline-step').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.state === activeState);
            });
        }
    }
}