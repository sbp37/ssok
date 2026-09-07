/**
 * Minimal WebGL textured-mesh renderer for the gel layer.
 *
 * Why WebGL just for this: the gel base texture is translucent, and drawing a
 * deformed grid of it in Canvas 2D leaves hairline seams between cells (gaps
 * or double-blended overlaps). Triangles sharing vertices on the GPU are
 * watertight, so the warped texture is seamless. Everything else stays 2D.
 */
export class MeshGL {
  private gl: WebGLRenderingContext;
  private aPos: number;
  private aUv: number;
  private uRes: WebGLUniformLocation;
  private uAlpha: WebGLUniformLocation;
  private posBuf: WebGLBuffer;
  private uvBuf: WebGLBuffer;
  private idxBuf: WebGLBuffer;
  private quadPos: WebGLBuffer;
  private quadUv: WebGLBuffer;
  private textures = new Map<string, { tex: WebGLTexture; w: number; h: number }>();
  private idxCount = 0;
  w = 0;
  h = 0;

  static create(canvas: HTMLCanvasElement): MeshGL | null {
    try {
      const gl = canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
      });
      if (!gl) return null;
      return new MeshGL(gl);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    const vs = `
      attribute vec2 a_pos; attribute vec2 a_uv; uniform vec2 u_res; varying vec2 v_uv;
      void main(){ v_uv = a_uv; vec2 c = a_pos / u_res * 2.0 - 1.0; gl_Position = vec4(c.x, -c.y, 0.0, 1.0); }`;
    const fs = `
      precision mediump float; uniform sampler2D u_tex; uniform float u_alpha; varying vec2 v_uv;
      void main(){ gl_FragColor = texture2D(u_tex, v_uv) * u_alpha; }`;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    gl.useProgram(prog);
    this.aPos = gl.getAttribLocation(prog, "a_pos");
    this.aUv = gl.getAttribLocation(prog, "a_uv");
    this.uRes = gl.getUniformLocation(prog, "u_res")!;
    this.uAlpha = gl.getUniformLocation(prog, "u_alpha")!;
    gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);
    this.posBuf = gl.createBuffer()!;
    this.uvBuf = gl.createBuffer()!;
    this.idxBuf = gl.createBuffer()!;
    this.quadPos = gl.createBuffer()!;
    this.quadUv = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUv);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.gl.viewport(0, 0, w, h);
    this.gl.uniform2f(this.uRes, w, h);
  }

  /** (re)upload a canvas as texture `key` */
  setTexture(key: string, src: HTMLCanvasElement) {
    const gl = this.gl;
    let t = this.textures.get(key);
    if (!t) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      t = { tex, w: 0, h: 0 };
      this.textures.set(key, t);
    }
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    t.w = src.width;
    t.h = src.height;
  }

  /** static grid topology: uvs + triangle indices for an n×n cell grid */
  setGrid(n: number) {
    const gl = this.gl;
    const uv = new Float32Array((n + 1) * (n + 1) * 2);
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const k = (j * (n + 1) + i) * 2;
        uv[k] = i / n;
        uv[k + 1] = j / n;
      }
    const idx = new Uint16Array(n * n * 6);
    let o = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        idx[o++] = a;
        idx[o++] = b;
        idx[o++] = c;
        idx[o++] = b;
        idx[o++] = d;
        idx[o++] = c;
      }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.idxCount = idx.length;
  }

  begin() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** draw the grid with interleaved device-px positions [x0,y0,x1,y1,...] */
  drawMesh(texKey: string, pos: Float32Array, alpha: number) {
    const gl = this.gl;
    const t = this.textures.get(texKey);
    if (!t) return;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.uniform1f(this.uAlpha, alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.enableVertexAttribArray(this.aUv);
    gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.drawElements(gl.TRIANGLES, this.idxCount, gl.UNSIGNED_SHORT, 0);
  }

  /** draw a textured quad given its 4 corners (device px): tl, tr, bl, br */
  drawQuad(texKey: string, corners: number[], alpha: number) {
    const gl = this.gl;
    const t = this.textures.get(texKey);
    if (!t) return;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.uniform1f(this.uAlpha, alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadPos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(corners), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUv);
    gl.enableVertexAttribArray(this.aUv);
    gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
