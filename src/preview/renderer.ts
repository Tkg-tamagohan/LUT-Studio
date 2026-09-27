import type { LutData } from "../engine";

/**
 * WebGL2 で画像にLUTを適用して描画するプレビューレンダラ。
 * LutData は青を最速に格納するため、3Dテクスチャへそのまま転送すると
 * テクスチャ座標は x=青, y=緑, z=赤 となる（texImage3D は x が最速）。
 * シェーダ側で (b, g, r) の順にサンプルして対応付ける。
 */

const VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  // 全画面三角形を頂点IDから生成する（バッファ不要）。
  vec2 pos = vec2(
    float((gl_VertexID & 1) << 2) - 1.0,
    float((gl_VertexID & 2) << 1) - 1.0
  );
  v_uv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D u_image;
uniform sampler3D u_lut;
uniform float u_lutSize;
in vec2 v_uv;
out vec4 o_color;
void main() {
  vec4 src = texture(u_image, v_uv);
  // テクセル中心を引いて3線形補間させるため scale/offset を掛ける。
  // LutData のメモリ配置は青最速のため座標順は (b, g, r)。
  float scale = (u_lutSize - 1.0) / u_lutSize;
  float offset = 0.5 / u_lutSize;
  vec3 pos = vec3(src.b, src.g, src.r) * scale + offset;
  o_color = vec4(texture(u_lut, pos).rgb, src.a);
}
`;

function compileShader(
  gl: WebGL2RenderingContext,
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

function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
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
  return program;
}

export interface PreviewRenderer {
  /** 表示画像を差し替える。 */
  setImage(bitmap: ImageBitmap): void;
  /** 適用するLUTを差し替える。 */
  setLut(lut: LutData): void;
  /** 現在の画像とLUTで描画する。キャンバスサイズの変更もここで反映する。 */
  render(): void;
  dispose(): void;
}

/**
 * キャンバスに対応するレンダラを作る。WebGL2非対応、
 * またはシェーダ構築に失敗した環境では null を返す。
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
): PreviewRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
  });
  if (!gl) return null;
  const program = createProgram(gl);
  if (!program) return null;

  // uniform の設定は対象プログラムを useProgram してから行う。
  gl.useProgram(program);
  const lutSizeLoc = gl.getUniformLocation(program, "u_lutSize");
  gl.uniform1i(gl.getUniformLocation(program, "u_image"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_lut"), 1);

  const imageTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, imageTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const lutTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_3D, lutTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

  let lutSize = 0;

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
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bitmap,
      );
    },

    setLut(lut) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lutTex);
      // 画像アップロード用の反転フラグが残っているとLUTの赤軸（z）が反転する。
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      if (lut.size !== lutSize) {
        lutSize = lut.size;
        // RGB16F はWebGL2コアで線形フィルタ可能。FLOAT型でFloat32Arrayを渡せる。
        gl.texImage3D(
          gl.TEXTURE_3D,
          0,
          gl.RGB16F,
          lut.size,
          lut.size,
          lut.size,
          0,
          gl.RGB,
          gl.FLOAT,
          lut.data,
        );
        gl.useProgram(program);
        gl.uniform1f(lutSizeLoc, lut.size);
      } else {
        gl.texSubImage3D(
          gl.TEXTURE_3D,
          0,
          0,
          0,
          0,
          lut.size,
          lut.size,
          lut.size,
          gl.RGB,
          gl.FLOAT,
          lut.data,
        );
      }
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
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
