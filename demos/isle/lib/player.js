// player.js — kinematic first-person on-foot / freefly controller.

export function createPlayer(cam, clipmap) {
    let onFoot = false;
    const eyeHeight = 1.8; // metres above ground

    return {
        get onFoot() { return onFoot; },
        set onFoot(v) { onFoot = v; },
        
        toggleMode() {
            onFoot = !onFoot;
            if (onFoot) {
                // Ground the player immediately when entering on-foot
                const groundY = clipmap.elevationAt(cam.pos[0], cam.pos[2]);
                cam.pos[1] = groundY + eyeHeight;
            }
        },

        update(keys, dt, moveSpeed) {
            // Read thrust input from keys
            const thrust = Camera.flyThrustFromKeys(cam, keys);

            if (onFoot) {
                // Grounded: force vertical thrust to 0
                thrust[1] = 0;
                
                // Integrate movement (only horizontal)
                Camera.flyIntegrate(cam, thrust, dt, moveSpeed * 0.15); // On foot is slower (walking speed)
                
                // Snap player camera height to terrain + eyeHeight
                const groundY = clipmap.elevationAt(cam.pos[0], cam.pos[2]);
                cam.pos[1] = groundY + eyeHeight;
            } else {
                // Freefly: integrate full 3D movement
                Camera.flyIntegrate(cam, thrust, dt, moveSpeed);
            }
        }
    };
}
