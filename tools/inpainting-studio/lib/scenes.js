// scenes.js — sample scenes to inpaint over, drawn into a 2D context.

export const SCENES = {
    portrait: 'Cyberpunk portrait',
    landscape: 'Fantasy island',
    room: 'Sci-fi control room',
};

export function drawScene(ctx, key, w, h) {
    ctx.clearRect(0, 0, w, h);
    if (key === 'portrait') {
        const bg = ctx.createLinearGradient(0, 0, w, h);
        bg.addColorStop(0, '#10002b');
        bg.addColorStop(1, '#240046');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ff9e00';                       // head
        ctx.beginPath(); ctx.arc(w * 0.5, h * 0.45, w * 0.18, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3c096c';                       // shoulders
        ctx.beginPath(); ctx.arc(w * 0.5, h * 0.9, w * 0.31, Math.PI, 0); ctx.fill();
    } else if (key === 'landscape') {
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#0077b6');
        sky.addColorStop(1, '#90e0ef');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1d6fa3';                       // sea
        ctx.fillRect(0, h * 0.72, w, h * 0.28);
        ctx.fillStyle = '#2d6a4f';                       // island
        ctx.beginPath(); ctx.arc(w * 0.5, h * 0.85, w * 0.35, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#6c757d';                       // castle
        ctx.fillRect(w * 0.44, h * 0.5, w * 0.12, h * 0.2);
        ctx.fillRect(w * 0.41, h * 0.44, w * 0.05, h * 0.12);
        ctx.fillRect(w * 0.54, h * 0.44, w * 0.05, h * 0.12);
    } else {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1e293b';                       // desk
        ctx.fillRect(0, h * 0.75, w, h * 0.25);
        ctx.fillStyle = '#38bdf8';                       // main screen
        ctx.fillRect(w * 0.2, h * 0.3, w * 0.6, h * 0.35);
        ctx.fillStyle = '#0ea5e9';
        for (let i = 0; i < 4; i++) ctx.fillRect(w * (0.24 + i * 0.14), h * 0.66, w * 0.1, h * 0.05);
    }
}
