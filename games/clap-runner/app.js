// app.js — Main application entry point for Clap Runner
import { GestureController } from './gesture_controller.js';
import { ClapRunnerGame } from './game.js';
import * as SFX from './audio_sfx.js';

window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const valScore = document.getElementById('valScore');
    const valMultiplier = document.getElementById('valMultiplier');
    const valDist = document.getElementById('valDist');
    const valCoins = document.getElementById('valCoins');
    const valHiScore = document.getElementById('valHiScore');

    const vadDot = document.getElementById('vadDot');
    const vuBar = document.getElementById('vuBar');
    const toneDot = document.getElementById('toneDot');
    const toneHzLabel = document.getElementById('toneHzLabel');
    const gestureBadge = document.getElementById('gestureBadge');

    const btnMicToggle = document.getElementById('btnMicToggle');
    const btnCalibrate = document.getElementById('btnCalibrate');
    const btnAudioMute = document.getElementById('btnAudioMute');

    const modalTitle = document.getElementById('modalTitle');
    const modalSettings = document.getElementById('modalSettings');
    const modalGameOver = document.getElementById('modalGameOver');
    const goStatsText = document.getElementById('goStatsText');

    const btnPlayGame = document.getElementById('btnPlayGame');
    const btnRestartGame = document.getElementById('btnRestartGame');
    const btnCloseSettings = document.getElementById('btnCloseSettings');
    const sliderClapSens = document.getElementById('sliderClapSens');
    const sliderWhistleHz = document.getElementById('sliderWhistleHz');

    let badgeTimeout = null;

    function flashBadge(text) {
        gestureBadge.textContent = text;
        gestureBadge.classList.add('fired');
        if (badgeTimeout) clearTimeout(badgeTimeout);
        badgeTimeout = setTimeout(() => {
            gestureBadge.classList.remove('fired');
        }, 300);
    }

    // Sound handler
    function handleSound(sfxName) {
        switch (sfxName) {
            case 'jump': SFX.playJump(); break;
            case 'superJump': SFX.playSuperJump(); break;
            case 'glideStart': SFX.startGlideSound(); break;
            case 'glideStop': SFX.stopGlideSound(); break;
            case 'slide': SFX.playSlide(); break;
            case 'coin': SFX.playCoin(); break;
            case 'multiplier': SFX.playMultiplier(); break;
            case 'shield': SFX.playShield(); break;
            case 'crash': SFX.playCrash(); break;
            case 'gameOver': SFX.playGameOver(); break;
        }
    }

    // Initialize Game
    const game = new ClapRunnerGame(canvas, {
        onScoreChange: (stats) => {
            valScore.textContent = stats.score.toLocaleString();
            valMultiplier.textContent = `${stats.multiplier}X`;
            valDist.textContent = `${stats.distance} m`;
            valCoins.textContent = stats.coins;
            valHiScore.textContent = stats.highScore.toLocaleString();
        },
        onGameOver: (stats) => {
            goStatsText.textContent = `Score: ${stats.score.toLocaleString()} | Distance: ${stats.distance}m | Coins: ${stats.coins}`;
            modalGameOver.classList.remove('hidden');
        },
        onSound: handleSound
    });

    // Initialize Gesture Controller
    const gestureController = new GestureController({
        onAction: (action, detail) => {
            if (action === 'jump') {
                flashBadge('⚡ JUMP');
                game.handleJump(detail?.strength);
            } else if (action === 'superJump') {
                flashBadge('💥 SUPER JUMP');
                game.handleSuperJump();
            } else if (action === 'glide') {
                flashBadge('🪂 HOVER GLIDE');
                game.handleGlideStart();
            } else if (action === 'slide') {
                flashBadge('💨 SLIDE DASH');
                game.handleSlideStart();
            }
        },
        onActionEnd: (action) => {
            if (action === 'glide') {
                game.handleGlideEnd();
            } else if (action === 'slide') {
                game.handleSlideEnd();
            }
        },
        onTelemetry: (telem) => {
            if (telem.vad) {
                vadDot.classList.add('active');
            } else {
                vadDot.classList.remove('active');
            }

            vuBar.style.width = `${Math.min(100, Math.round(telem.energy * 100))}%`;

            if (telem.tonal && telem.pitchHz > 0) {
                toneDot.classList.add('active');
                toneHzLabel.textContent = `TONE: ${telem.pitchHz} Hz`;
            } else {
                toneDot.classList.remove('active');
                toneHzLabel.textContent = 'TONE: -- Hz';
            }
        }
    });

    // Mic Toggle
    btnMicToggle.addEventListener('click', async () => {
        SFX.ensureAudio();
        if (gestureController.micActive) {
            gestureController.stopMic();
            btnMicToggle.textContent = '🎤 Enable Mic';
            btnMicToggle.classList.remove('active');
            flashBadge('KEYBOARD ONLY');
        } else {
            btnMicToggle.textContent = '⌛ Connecting...';
            const ok = await gestureController.startMic();
            if (ok) {
                btnMicToggle.textContent = '🔴 Mic Active';
                btnMicToggle.classList.add('active');
                flashBadge('MIC LISTENING');
            } else {
                btnMicToggle.textContent = '🎤 Mic Failed';
                btnMicToggle.classList.remove('active');
                flashBadge('MIC DENIED');
            }
        }
    });

    // Audio Mute Toggle
    btnAudioMute.addEventListener('click', () => {
        SFX.ensureAudio();
        const muted = SFX.toggleMute();
        btnAudioMute.textContent = muted ? '🔇' : '🔊';
    });

    // Settings Modal
    btnCalibrate.addEventListener('click', () => {
        modalSettings.classList.remove('hidden');
    });

    btnCloseSettings.addEventListener('click', () => {
        gestureController.clapThreshold = parseFloat(sliderClapSens.value);
        gestureController.whistleMinHz = parseFloat(sliderWhistleHz.value);
        modalSettings.classList.add('hidden');
    });

    // Game Control Buttons
    btnPlayGame.addEventListener('click', () => {
        SFX.initAudio();
        SFX.ensureAudio();
        modalTitle.classList.add('hidden');
        game.start();
    });

    btnRestartGame.addEventListener('click', () => {
        SFX.ensureAudio();
        modalGameOver.classList.add('hidden');
        game.start();
    });

    // Main Animation Loop
    let lastTime = performance.now();
    function loop(time) {
        const dt = Math.min(0.1, (time - lastTime) / 1000);
        lastTime = time;

        game.update(dt);
        game.render();

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
});
