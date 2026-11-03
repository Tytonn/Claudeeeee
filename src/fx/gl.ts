/**
 * What every scene's renderer shares: the WebGL context's types, the one full-screen triangle
 * every pass draws, and the plumbing to compile a program and find its uniforms.
 */

export type GL = WebGLRenderingContext | WebGL2RenderingContext;

export type Program = {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
};

/** A texture to draw into. */
export type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number };

/** The vertex shader of every pass: one triangle that covers the screen. */
export const VERT = /* glsl */ `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** Compiles and links a program and finds its uniforms; null (with a warning) if it won't build. */
export function buildProgram(gl: GL, vert: string, frag: string, uniforms: string[], label: string): Program | null {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn(`${label} shader:`, gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, vert);
  const fs = compile(gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn(`${label} program:`, gl.getProgramInfoLog(prog));
    return null;
  }
  const loc: Program["loc"] = {};
  for (const name of uniforms) loc[name] = gl.getUniformLocation(prog, name);
  return { prog, loc };
}

/** Frees a texture to draw into. */
export function dropTarget(gl: GL, t: Target) {
  gl.deleteFramebuffer(t.fb);
  gl.deleteTexture(t.tex);
}
