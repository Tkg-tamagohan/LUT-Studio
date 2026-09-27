import type { LutData } from "../engine";
import type { PreviewRenderer } from "./renderer";

/**
 * WebGL1向けプレビュー。3Dテクスチャが使えないため、LUTを
 * 2Dテクスチャ（size×sizeタイルを tilesPerRow 列で並べたグリッド）
 * へ展開し、青方向の補間はシェーダで2タップ合成する。
 * 8bit精度なのでWebGL2版よりバンディングが出やすい点に注意。
 */

const VERTEX_SHADER = `precision mediump float;
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `precision mediump float;
uniform sampler2D u_image;
uniform sampler2D u_lut;
uniform float u_lutSize;
uniform float u_tilesPerRow;
uniform float u_texSize;
uniform float u_bypass;
varying vec2 v_uv;

// タイル番号 b に対応するタイル内座標 (r, g) を参照する。
vec3 lutSample(vec3 c, float b) {
  float col = mod(b, u_tilesPerRow);
  float row = floor(b / u_tilesPerRow);
  vec2 uv = vec2(
    (col * u_lutSize + c.r * (u_lutSize - 1.0) + 0.5) / u_texSize,
    (row * u_lutSize + c.g * (u_lutSize - 1.0) + 0.5) / u_texSize
  );
  return texture2D(u_lut, uv).rgb;
}

void main() {
  vec4 src = texture2D(u_image, v_uv);
  if (u_bypass > 0.5) {
    gl_FragColor = src;
    return;
  }
  float bpos = src.b * (u_lutSize - 1.0);
  float b0 = floor(bpos);
  float b1 = min(b0 + 1.0, u_lutSize - 1.0);
  vec3 c0 = lutSample(src.rgb, b0);
  vec3 c1 = lutSample(src.rgb, b1);
  gl_FragColor = vec4(mix(c0, c1, bpos - b0), src.a);
}
`;

export interface PackedLut2d {
  /** texSize × texSize の RGB8 データ。 */
  data: Uint8Array;
  /** テクスチャの一辺（= size × tilesPerRow）。 */
  texSize: number;
  /** 1行あたりのタイル数。 */
  tilesPerRow: number;
}

/**
 * 青最速の LutData を2Dグリッドテクスチャへ展開する。
 * タイル b の左上原点は ((b % tpr) * size, floor(b / tpr) * size)。
 */
export function packLut2d(lut: LutData): PackedLut2d {
  const size = lut.size;
  const tilesPerRow = Math.ceil(Math.sqrt(size));
  const texSize = size * tilesPerRow;
  const data = new Uint8Array(texSize * texSize * 3);
  for (let r = 0; r < size; r++) {
    for (let g = 0; g < size; g++) {
      for (let b = 0; b < size; b++) {
        const i = ((r * size + g) * size + b) * 3;
        const col = b % tilesPerRow;
        const row = Math.floor(b / tilesPerRow);
        const x = col * size + r;
        const y = row * size + g;
        const o = (y * texSize + x) * 3;
        data[o] = Math.round(lut.data[i] * 255);
        data[o + 1] = Math.round(lut.data[i + 1] * 255);
        data[o + 2] = Math.round(lut.data[i + 2] * 255);
      }
    }
  }
  return { data, texSize, tilesPerRow };
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * WebGL1 コンテキストでレンダラを作る。非対応や構築失敗時は null。
 */
export function createRendererWebgl1(
  canvas: HTMLCanvasElement,
): PreviewRenderer | null {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
  });
  if (!gl) return null;

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);

  // WebGL1には頂点IDがないため、全画面三角形はバッファで供給する。
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const posLoc = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const uLoc = (name: string) => gl.getUniformLocation(program, name);
  const bypassLoc = uLoc("u_bypass");
  gl.uniform1i(uLoc("u_image"), 0);
  gl.uniform1i(uLoc("u_lut"), 1);

  const setupTex = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
      gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    }
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) {
      gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    }
    return tex;
  };

  gl.activeTexture(gl.TEXTURE0);
  const imageTex = setupTex();
  gl.activeTexture(gl.TEXTURE1);
  const lutTex = setupTex();

  let packedTexSize = 0;

  function syncCanvasSize(): void {
    const w = Math.max(
      1,
      Math.round(canvas.clientWidth * devicePixelRatio),
    );
    const h = Math.max(
      1,
      Math.round(canvas.clientHeight * devicePixelRatio),
    );
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  return {
    setImage(bitmap) {
      gl.activeTexture(gl.TEXTURE0);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bitmap,
      );
    },

    setLut(lut) {
      const packed = packLut2d(lut);
      gl.activeTexture(gl.TEXTURE1);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGB,
        packed.texSize,
        packed.texSize,
        0,
        gl.RGB,
        gl.UNSIGNED_BYTE,
        packed.data,
      );
      if (packed.texSize !== packedTexSize) {
        packedTexSize = packed.texSize;
        gl.useProgram(program);
        gl.uniform1f(uLoc("u_lutSize"), lut.size);
        gl.uniform1f(uLoc("u_tilesPerRow"), packed.tilesPerRow);
        gl.uniform1f(uLoc("u_texSize"), packed.texSize);
      }
    },

    setBypass(on) {
      gl.useProgram(program);
      gl.uniform1f(bypassLoc, on ? 1 : 0);
    },

    render() {
      syncCanvasSize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    dispose() {
      gl.deleteTexture(imageTex);
      gl.deleteTexture(lutTex);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
