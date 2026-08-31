// presets.js — Complex animation sequences and keyframe definitions for WAAPI Lab.

export const ANIMATION_PRESETS = [
    {
        id: 'elastic-pop',
        name: 'Elastic Pop & Bounce',
        description: 'Dynamic spring-like scale, rotation, and overshoot bounce.',
        targetType: 'badge',
        timing: {
            duration: 1200,
            iterations: Infinity,
            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            direction: 'alternate',
            fill: 'both'
        },
        keyframes: [
            {
                transform: 'scale(0.7) rotate(-12deg)',
                opacity: 0.6,
                boxShadow: '0 4px 10px rgba(0, 240, 255, 0.2)',
                offset: 0
            },
            {
                transform: 'scale(1.18) rotate(6deg)',
                opacity: 1,
                boxShadow: '0 16px 36px rgba(0, 240, 255, 0.6)',
                offset: 0.6
            },
            {
                transform: 'scale(0.95) rotate(-2deg)',
                boxShadow: '0 8px 20px rgba(0, 240, 255, 0.3)',
                offset: 0.8
            },
            {
                transform: 'scale(1) rotate(0deg)',
                opacity: 1,
                boxShadow: '0 12px 28px rgba(0, 240, 255, 0.4)',
                offset: 1
            }
        ]
    },
    {
        id: 'card-flip-3d',
        name: '3D Card Flip & Elevate',
        description: 'Perspective transform with rotateY(360deg), elevation, and shadow depth.',
        targetType: 'card',
        timing: {
            duration: 2000,
            iterations: Infinity,
            easing: 'cubic-bezier(0.45, 0.05, 0.55, 0.95)',
            direction: 'normal',
            fill: 'both'
        },
        keyframes: [
            {
                transform: 'perspective(900px) rotateY(0deg) translateZ(0px)',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.4)',
                filter: 'brightness(1)',
                offset: 0
            },
            {
                transform: 'perspective(900px) rotateY(180deg) translateZ(90px)',
                boxShadow: '0 30px 60px rgba(168, 85, 247, 0.5)',
                filter: 'brightness(1.25)',
                offset: 0.5
            },
            {
                transform: 'perspective(900px) rotateY(360deg) translateZ(0px)',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.4)',
                filter: 'brightness(1)',
                offset: 1
            }
        ]
    },
    {
        id: 'staggered-ripple',
        name: 'Staggered Wave Ripple',
        description: 'Sequential scale and opacity waves propagating through child elements.',
        targetType: 'rippleGrid',
        timing: {
            duration: 1600,
            iterations: Infinity,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            direction: 'alternate',
            fill: 'both'
        },
        keyframes: [
            {
                transform: 'scale(0.4) rotate(0deg)',
                opacity: 0.3,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #00f0ff, #3b82f6)',
                offset: 0
            },
            {
                transform: 'scale(1.15) rotate(45deg)',
                opacity: 0.95,
                borderRadius: '25%',
                background: 'linear-gradient(135deg, #a855f7, #ec4899)',
                offset: 0.7
            },
            {
                transform: 'scale(1) rotate(90deg)',
                opacity: 1,
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #3b82f6, #00f0ff)',
                offset: 1
            }
        ]
    },
    {
        id: 'morphing-pulse',
        name: 'Morphing Organic Pulse',
        description: 'Dynamic morphing of border-radius, gradient colors, and breathing scale.',
        targetType: 'morphBlob',
        timing: {
            duration: 2400,
            iterations: Infinity,
            easing: 'ease-in-out',
            direction: 'alternate',
            fill: 'both'
        },
        keyframes: [
            {
                borderRadius: '60% 40% 30% 70% / 60% 30% 70% 40%',
                transform: 'scale(0.85) rotate(0deg)',
                filter: 'hue-rotate(0deg) drop-shadow(0 0 20px rgba(0, 240, 255, 0.4))',
                offset: 0
            },
            {
                borderRadius: '30% 60% 70% 40% / 50% 60% 30% 60%',
                transform: 'scale(1.12) rotate(120deg)',
                filter: 'hue-rotate(120deg) drop-shadow(0 0 40px rgba(168, 85, 247, 0.7))',
                offset: 0.5
            },
            {
                borderRadius: '60% 40% 60% 40% / 70% 30% 50% 60%',
                transform: 'scale(0.95) rotate(240deg)',
                filter: 'hue-rotate(240deg) drop-shadow(0 0 30px rgba(255, 0, 127, 0.5))',
                offset: 0.8
            },
            {
                borderRadius: '60% 40% 30% 70% / 60% 30% 70% 40%',
                transform: 'scale(1) rotate(360deg)',
                filter: 'hue-rotate(360deg) drop-shadow(0 0 25px rgba(0, 240, 255, 0.4))',
                offset: 1
            }
        ]
    },
    {
        id: 'glitch-shake',
        name: 'Cyberpunk Glitch & Slices',
        description: 'High-frequency polygon clip-path slicing with RGB channel jitter.',
        targetType: 'glitchBanner',
        timing: {
            duration: 900,
            iterations: Infinity,
            easing: 'steps(6, end)',
            direction: 'normal',
            fill: 'both'
        },
        keyframes: [
            {
                clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)',
                transform: 'translate(0, 0) skewX(0deg)',
                filter: 'drop-shadow(0 0 0 transparent)',
                offset: 0
            },
            {
                clipPath: 'polygon(0 15%, 100% 15%, 100% 45%, 0 45%)',
                transform: 'translate(-6px, 2px) skewX(-4deg)',
                filter: 'drop-shadow(-4px 0 0 #ff0055) drop-shadow(4px 0 0 #00ffff)',
                offset: 0.2
            },
            {
                clipPath: 'polygon(0 60%, 100% 60%, 100% 85%, 0 85%)',
                transform: 'translate(5px, -3px) skewX(5deg)',
                filter: 'drop-shadow(4px 0 0 #ff0055) drop-shadow(-4px 0 0 #00ffff)',
                offset: 0.45
            },
            {
                clipPath: 'polygon(0 30%, 100% 30%, 100% 50%, 0 50%)',
                transform: 'translate(-3px, -1px) skewX(-2deg)',
                filter: 'drop-shadow(-2px 0 0 #ff0055)',
                offset: 0.7
            },
            {
                clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)',
                transform: 'translate(0, 0) skewX(0deg)',
                filter: 'drop-shadow(0 0 10px rgba(0, 240, 255, 0.5))',
                offset: 1
            }
        ]
    },
    {
        id: 'neon-hyperspace',
        name: 'Neon Hyperspace Orb',
        description: 'Spherical energy burst with radial gradients and orbital lighting.',
        targetType: 'orb',
        timing: {
            duration: 1500,
            iterations: Infinity,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            direction: 'alternate',
            fill: 'both'
        },
        keyframes: [
            {
                transform: 'scale(0.8) translateY(15px)',
                boxShadow: '0 0 20px #00f0ff, inset 0 0 20px #00f0ff',
                filter: 'brightness(0.9)',
                offset: 0
            },
            {
                transform: 'scale(1.2) translateY(-20px)',
                boxShadow: '0 0 60px #ff007f, 0 0 100px #a855f7, inset 0 0 40px #ff007f',
                filter: 'brightness(1.4)',
                offset: 1
            }
        ]
    }
];

export function getPresetById(id) {
    return ANIMATION_PRESETS.find(p => p.id === id) || ANIMATION_PRESETS[0];
}
