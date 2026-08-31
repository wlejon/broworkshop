// tools/shader-lab/gl-runtime.js

const VERTEX_SHADER_SRC = `#version 300 es
in vec2 a_position;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export class GLRuntime {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2');
        if (!this.gl) {
            throw new Error('WebGL2 not supported on this canvas');
        }

        this.program = null;
        this.vao = null;
        this.vbo = null;
        this.uniformLocations = {};

        this.initQuad();
    }

    initQuad() {
        const gl = this.gl;
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        const positions = new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
             1.0,  1.0,
        ]);

        this.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
    }

    compileShader(src, type) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(info || 'Shader compilation failed');
        }
        return shader;
    }

    setFragmentShader(fragmentSource) {
        const gl = this.gl;

        let vertShader = null;
        let fragShader = null;
        let prog = null;

        try {
            vertShader = this.compileShader(VERTEX_SHADER_SRC, gl.VERTEX_SHADER);
            fragShader = this.compileShader(fragmentSource, gl.FRAGMENT_SHADER);

            prog = gl.createProgram();
            gl.attachShader(prog, vertShader);
            gl.attachShader(prog, fragShader);
            gl.bindAttribLocation(prog, 0, 'a_position');
            gl.linkProgram(prog);

            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                const info = gl.getProgramInfoLog(prog);
                throw new Error(info || 'Program linking failed');
            }

            if (this.program) {
                gl.deleteProgram(this.program);
            }

            this.program = prog;

            // Cache uniforms
            this.uniformLocations = {
                u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
                u_time: gl.getUniformLocation(prog, 'u_time'),
                u_mouse: gl.getUniformLocation(prog, 'u_mouse'),
                u_param1: gl.getUniformLocation(prog, 'u_param1'),
                u_param2: gl.getUniformLocation(prog, 'u_param2'),
                u_param3: gl.getUniformLocation(prog, 'u_param3'),
                u_param4: gl.getUniformLocation(prog, 'u_param4'),
            };

            return { success: true, log: 'Program compiled & linked cleanly.' };
        } catch (err) {
            if (prog) gl.deleteProgram(prog);
            return { success: false, error: err.message };
        } finally {
            if (vertShader) gl.deleteShader(vertShader);
            if (fragShader) gl.deleteShader(fragShader);
        }
    }

    render(uniforms) {
        const gl = this.gl;
        if (!this.program) return;

        const w = this.canvas.width;
        const h = this.canvas.height;

        gl.viewport(0, 0, w, h);
        gl.useProgram(this.program);

        const loc = this.uniformLocations;
        if (loc.u_resolution) gl.uniform2f(loc.u_resolution, w, h);
        if (loc.u_time) gl.uniform1f(loc.u_time, uniforms.time || 0);
        if (loc.u_mouse) {
            const m = uniforms.mouse || [0, 0, 0, 0];
            gl.uniform4f(loc.u_mouse, m[0], m[1], m[2], m[3]);
        }
        if (loc.u_param1) gl.uniform1f(loc.u_param1, uniforms.param1 || 1.0);
        if (loc.u_param2) gl.uniform1f(loc.u_param2, uniforms.param2 || 1.0);
        if (loc.u_param3) gl.uniform1f(loc.u_param3, uniforms.param3 || 1.0);
        if (loc.u_param4) gl.uniform1f(loc.u_param4, uniforms.param4 || 1.0);

        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
    }
}
