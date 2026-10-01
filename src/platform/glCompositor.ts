/**
 * WebGL2 합성기 (화면 표시용 GPU 가속)
 * ------------------------------------------------------------
 * 레이어가 많거나 캔버스가 큰(1024px 이상) 그림에서 "레이어 섞기(블렌드)"를 GPU 로 처리합니다.
 *
 *  - 각 레이어의 처리된 그림(뼈대·키프레임·효과까지 끝난 것)을 텍스처로 올립니다.
 *    텍스처는 "내용 키"로 저장해 두므로, 바뀐 레이어만 다시 올립니다. (그리는 중인 레이어 1장 정도)
 *  - 블렌드 모드 10가지를 셰이더로 계산합니다. 계산식은 core/blend.ts 와 똑같습니다(W3C 표준).
 *  - 결과는 그림 크기(예: 64×64)의 숨은 캔버스에 그려지고, 화면 쪽 2D 캔버스가
 *    drawImage 로 확대해서 보여줍니다. (GPU → GPU 복사라 느린 "픽셀 읽어오기"가 없음)
 *
 * WebGL2 를 못 쓰는 환경, 그래픽 드라이버가 리셋된 경우(context lost), 너무 큰 캔버스는
 * render() 가 null 을 돌려주고, 화면은 기존 CPU 방식으로 그려집니다.
 * PNG/GIF 내보내기는 항상 CPU 방식(정확히 같은 결과)을 사용합니다.
 */
import { BLEND_MODES } from '../core/blend';
import type { LayerPiece } from '../core/render';
import { piecesKey } from '../core/render';

const VERT = `#version 300 es
void main() {
  // 화면 전체를 덮는 큰 삼각형 하나 (정점 데이터 없이 번호로 계산)
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** core/blend.ts 의 blendInto 와 같은 계산 (색은 0~1, 알파 미리곱하지 않음) */
const BLEND_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_dst;
uniform sampler2D u_src;
uniform float u_opacity;
uniform int u_mode;
out vec4 outColor;

float hardLight(float b, float s) {
  if (s <= 0.5) return b * (2.0 * s);
  float s2 = 2.0 * s - 1.0;
  return b + s2 - b * s2;
}

float blendChannel(float b, float s) {
  if (u_mode == 1) return b * s;
  if (u_mode == 2) return b + s - b * s;
  if (u_mode == 3) return hardLight(s, b);
  if (u_mode == 4) return min(b, s);
  if (u_mode == 5) return max(b, s);
  if (u_mode == 6) return min(1.0, b + s);
  if (u_mode == 7) return max(0.0, b - s);
  if (u_mode == 8) return abs(b - s);
  if (u_mode == 9) return hardLight(b, s);
  return s;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 d = texelFetch(u_dst, p, 0);
  vec4 s = texelFetch(u_src, p, 0);
  if (s.a <= 0.0) {
    outColor = d;
    return;
  }
  float sa = s.a * u_opacity;
  float ba = d.a;
  float ao = sa + ba * (1.0 - sa);
  if (u_mode == 0 || ba <= 0.0) {
    if (sa >= 1.0) {
      outColor = vec4(s.rgb, 1.0);
      return;
    }
    float k = ba * (1.0 - sa);
    outColor = vec4((s.rgb * sa + d.rgb * k) / ao, ao);
    return;
  }
  vec3 mixed = vec3(blendChannel(d.r, s.r), blendChannel(d.g, s.g), blendChannel(d.b, s.b));
  vec3 co = sa * (1.0 - ba) * s.rgb + sa * ba * mixed + (1.0 - sa) * ba * d.rgb;
  outColor = vec4(co / ao, ao);
}`;

/** 결과를 캔버스에 옮기기: 위아래 맞추고, 브라우저가 기대하는 "미리곱한 알파"로 */
const PRESENT_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_tex;
uniform int u_height;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(int(gl_FragCoord.x), u_height - 1 - int(gl_FragCoord.y));
  vec4 c = texelFetch(u_tex, p, 0);
  outColor = vec4(c.rgb * c.a, c.a);
}`;

/** GPU 메모리 중 레이어 텍스처에 쓸 최대 크기 */
const TEXTURE_BUDGET_BYTES = 256 * 1024 * 1024;
/** 저장해 둘 레이어 텍스처 최대 개수 (작은 그림에서도 너무 많이 쌓이지 않게) */
const MAX_TEXTURES = 256;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

interface Programs {
  blend: WebGLProgram;
  present: WebGLProgram;
  blendLoc: { dst: WebGLUniformLocation | null; src: WebGLUniformLocation | null; opacity: WebGLUniformLocation | null; mode: WebGLUniformLocation | null };
  presentLoc: { tex: WebGLUniformLocation | null; height: WebGLUniformLocation | null };
  vao: WebGLVertexArrayObject;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[glCompositor] shader:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, frag: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[glCompositor] link:', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

export class GlCompositor {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private programs: Programs | null = null;
  private readonly textures = new Map<string, WebGLTexture>();
  private targets: [Target, Target] | null = null;
  private size = { w: 0, h: 0 };
  private lastKey = '';
  private lost = false;
  readonly maxTextureSize: number;

  /** WebGL2 를 쓸 수 없으면 null */
  static create(): GlCompositor | null {
    try {
      if (typeof document === 'undefined') return null;
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: true,
      });
      if (!gl) return null;
      const c = new GlCompositor(canvas, gl);
      return c.programs ? c : null;
    } catch {
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.textures.clear();
      this.targets = null;
      this.size = { w: 0, h: 0 };
      this.lastKey = '';
      this.init();
    });
    this.init();
  }

  private init(): void {
    const gl = this.gl;
    const blend = link(gl, BLEND_FRAG);
    const present = link(gl, PRESENT_FRAG);
    const vao = gl.createVertexArray();
    if (!blend || !present || !vao) {
      this.programs = null;
      return;
    }
    this.programs = {
      blend,
      present,
      vao,
      blendLoc: {
        dst: gl.getUniformLocation(blend, 'u_dst'),
        src: gl.getUniformLocation(blend, 'u_src'),
        opacity: gl.getUniformLocation(blend, 'u_opacity'),
        mode: gl.getUniformLocation(blend, 'u_mode'),
      },
      presentLoc: { tex: gl.getUniformLocation(present, 'u_tex'), height: gl.getUniformLocation(present, 'u_height') },
    };
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.disable(gl.BLEND);
  }

  /** 지금 쓸 수 있는 상태인지 */
  get ready(): boolean {
    return !!this.programs && !this.lost && !this.gl.isContextLost();
  }

  private newTexture(w: number, h: number, data: Uint8ClampedArray | null): WebGLTexture | null {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const view = data ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, view);
    return tex;
  }

  private ensureTargets(w: number, h: number): boolean {
    if (this.targets && this.size.w === w && this.size.h === h) return true;
    this.freeTargets();
    this.freeTextures();
    const gl = this.gl;
    const make = (): Target | null => {
      const tex = this.newTexture(w, h, null);
      const fbo = gl.createFramebuffer();
      if (!tex || !fbo) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
      return { tex, fbo };
    };
    const a = make();
    const b = make();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!a || !b) return false;
    this.targets = [a, b];
    this.size = { w, h };
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  /** 레이어 그림 → 텍스처 (같은 내용이면 저장된 것 재사용) */
  private layerTexture(piece: LayerPiece, w: number, h: number): WebGLTexture | null {
    const cached = this.textures.get(piece.key);
    if (cached) {
      this.textures.delete(piece.key);
      this.textures.set(piece.key, cached);
      return cached;
    }
    const tex = this.newTexture(w, h, piece.buf);
    if (!tex) return null;
    this.textures.set(piece.key, tex);
    const limit = Math.min(MAX_TEXTURES, Math.max(4, Math.floor(TEXTURE_BUDGET_BYTES / (w * h * 4))));
    while (this.textures.size > limit) {
      const [oldKey, oldTex] = this.textures.entries().next().value as [string, WebGLTexture];
      this.gl.deleteTexture(oldTex);
      this.textures.delete(oldKey);
    }
    return tex;
  }

  /**
   * 레이어들을 아래→위로 섞어서 숨은 캔버스에 그립니다.
   * 성공하면 그 캔버스를, GPU 를 쓸 수 없으면 null 을 돌려줍니다.
   */
  render(pieces: LayerPiece[], w: number, h: number): HTMLCanvasElement | null {
    if (!this.ready || !this.programs) return null;
    if (w < 1 || h < 1 || w > this.maxTextureSize || h > this.maxTextureSize) return null;
    const key = `${w}x${h}|${piecesKey(pieces)}`;
    if (key === this.lastKey && this.size.w === w && this.size.h === h) return this.canvas;
    if (!this.ensureTargets(w, h) || !this.targets) return null;
    const gl = this.gl;
    const pr = this.programs;
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(pr.vao);

    let [cur, next] = this.targets;
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(pr.blend);
    gl.uniform1i(pr.blendLoc.dst, 0);
    gl.uniform1i(pr.blendLoc.src, 1);
    for (const piece of pieces) {
      const tex = this.layerTexture(piece, w, h);
      if (!tex) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cur.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1f(pr.blendLoc.opacity, Math.max(0, Math.min(1, piece.opacity)));
      gl.uniform1i(pr.blendLoc.mode, Math.max(0, BLEND_MODES.indexOf(piece.blendMode)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      [cur, next] = [next, cur];
    }

    // 결과를 숨은 캔버스(기본 프레임버퍼)로
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(pr.present);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cur.tex);
    gl.uniform1i(pr.presentLoc.tex, 0);
    gl.uniform1i(pr.presentLoc.height, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    if (gl.isContextLost()) return null;
    this.lastKey = key;
    return this.canvas;
  }

  /** 테스트/진단용: 마지막 결과를 픽셀로 읽기 (일반 사용 중에는 쓰지 않음, 느림) */
  readPixels(): Uint8ClampedArray | null {
    if (!this.ready || !this.targets) return null;
    const { w, h } = this.size;
    const gl = this.gl;
    const out = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    // 아래→위 순서를 위→아래로, 미리곱한 알파를 원래 색으로
    const res = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = ((h - 1 - y) * w + x) * 4;
        const d = (y * w + x) * 4;
        const a = out[s + 3];
        res[d + 3] = a;
        if (a === 0) continue;
        res[d] = (out[s] * 255) / a;
        res[d + 1] = (out[s + 1] * 255) / a;
        res[d + 2] = (out[s + 2] * 255) / a;
      }
    }
    return res;
  }

  private freeTextures(): void {
    for (const tex of this.textures.values()) this.gl.deleteTexture(tex);
    this.textures.clear();
    this.lastKey = '';
  }

  private freeTargets(): void {
    if (!this.targets) return;
    for (const t of this.targets) {
      this.gl.deleteFramebuffer(t.fbo);
      this.gl.deleteTexture(t.tex);
    }
    this.targets = null;
  }

  /** GPU 메모리 돌려주기 */
  dispose(): void {
    this.freeTextures();
    this.freeTargets();
    if (this.programs) {
      this.gl.deleteProgram(this.programs.blend);
      this.gl.deleteProgram(this.programs.present);
      this.gl.deleteVertexArray(this.programs.vao);
      this.programs = null;
    }
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
