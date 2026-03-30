'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { gsap } from 'gsap';

/* ─── WebGL shaders ──────────────────────────────────────────────────── */

const vertexShader = `
  attribute vec4 position;
  void main() {
    gl_Position = position;
  }
`;

const fragmentShader = `
  precision mediump float;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec2 u_mouse;
  uniform float u_intensity;

  vec3 hash3(vec2 p) {
    vec3 q = vec3(dot(p, vec2(127.1, 311.7)),
                  dot(p, vec2(269.5, 183.3)),
                  dot(p, vec2(419.2, 371.9)));
    return fract(sin(q) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(dot(hash3(i + vec2(0.0,0.0)).xy, f - vec2(0.0,0.0)),
                   dot(hash3(i + vec2(1.0,0.0)).xy, f - vec2(1.0,0.0)), u.x),
               mix(dot(hash3(i + vec2(0.0,1.0)).xy, f - vec2(0.0,1.0)),
                   dot(hash3(i + vec2(1.0,1.0)).xy, f - vec2(1.0,1.0)), u.x), u.y);
  }

  float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 1.0;
    float frequency = 0.25;
    for(int i = 0; i < 10; i++) {
      if(i >= octaves) break;
      value += amplitude * noise(p * frequency);
      amplitude *= 0.52;
      frequency *= 1.13;
    }
    return value;
  }

  float voronoi(vec2 p) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float md = 50.0;
    for(int i = -2; i <= 2; i++) {
      for(int j = -2; j <= 2; j++) {
        vec2 g = vec2(i, j);
        vec2 o = hash3(n + g).xy;
        o = 0.5 + 0.41 * sin(u_time * 1.5 + 6.28 * o);
        vec2 r = g + o - f;
        float d = dot(r, r);
        md = min(md, d);
      }
    }
    return sqrt(md);
  }

  float plasma(vec2 p, float time) {
    float a = sin(p.x * 8.0 + time * 2.0);
    float b = sin(p.y * 8.0 + time * 1.7);
    float c = sin((p.x + p.y) * 6.0 + time * 1.3);
    float d = sin(sqrt(p.x * p.x + p.y * p.y) * 8.0 + time * 2.3);
    return (a + b + c + d) * 0.5;
  }

  vec2 curl(vec2 p, float time) {
    float eps = 0.5;
    float n1 = fbm(p + vec2(eps, 0.0), 6);
    float n2 = fbm(p - vec2(eps, 0.0), 6);
    float n3 = fbm(p + vec2(0.0, eps), 6);
    float n4 = fbm(p - vec2(0.0, eps), 6);
    return vec2((n3 - n4) / (2.0 * eps), (n2 - n1) / (2.0 * eps));
  }

  float grain(vec2 uv, float time) {
    vec2 seed = uv * time;
    return fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 st = (uv - 0.5) * 2.0;
    st.x *= u_resolution.x / u_resolution.y;

    float time = u_time * 0.25;

    vec2 curlForce = curl(st * 2.0, time) * 0.6;
    vec2 flowField = st + curlForce;

    float dist1 = fbm(flowField * 1.5 + time * 1.2, 8) * 0.4;
    float dist2 = fbm(flowField * 2.3 - time * 0.8, 6) * 0.3;
    float dist3 = fbm(flowField * 3.1 + time * 1.8, 4) * 0.2;
    float dist4 = fbm(flowField * 4.7 - time * 1.1, 3) * 0.15;

    float cells = voronoi(flowField * 2.5 + time * 0.5);
    cells = smoothstep(0.1, 0.7, cells);

    float plasmaEffect = plasma(flowField + vec2(dist1, dist2), time * 1.5) * 0.2;
    float totalDist = dist1 + dist2 + dist3 + dist4 + plasmaEffect;

    float streak1 = sin((st.x + totalDist) * 15.0 + time * 3.0) * 0.5 + 0.5;
    float streak2 = sin((st.x + totalDist * 0.7) * 25.0 - time * 2.0) * 0.5 + 0.5;
    float streak3 = sin((st.x + totalDist * 1.3) * 35.0 + time * 4.0) * 0.5 + 0.5;

    streak1 = smoothstep(0.3, 0.7, streak1);
    streak2 = smoothstep(0.2, 0.8, streak2);
    streak3 = smoothstep(0.4, 0.6, streak3);

    float combinedStreaks = streak1 * 0.6 + streak2 * 0.4 + streak3 * 0.5;

    float shape1 = 1.0 - abs(st.x + totalDist * 0.6);
    float shape2 = 1.0 - abs(st.x + totalDist * 0.4 + sin(st.y * 3.0 + time) * 0.15);
    float shape3 = 1.0 - abs(st.x + totalDist * 0.8 + cos(st.y * 2.0 - time) * 0.1);

    shape1 = smoothstep(0.0, 1.0, shape1);
    shape2 = smoothstep(0.1, 0.9, shape2);
    shape3 = smoothstep(0.2, 0.8, shape3);

    float finalShape = max(shape1 * 0.8, max(shape2 * 0.6, shape3 * 0.4));

    // AitherOS palette: deep purples, electric cyan, violet
    vec3 color1 = vec3(0.6, 0.1, 1.0);   // Deep violet
    vec3 color2 = vec3(0.08, 1.0, 0.97); // Electric cyan
    vec3 color3 = vec3(0.5, 0.3, 1.0);   // Mid purple
    vec3 color4 = vec3(0.1, 0.5, 1.0);   // Electric blue
    vec3 color5 = vec3(0.08, 0.95, 0.85);// Teal
    vec3 color6 = vec3(0.25, 0.05, 0.6); // Dark purple
    vec3 color7 = vec3(0.85, 0.4, 1.0);  // Light violet

    float gradient = 1.0 - uv.y;
    float colorNoise = fbm(flowField * 3.0 + time * 0.5, 4) * 0.5 + 0.5;
    float colorShift = sin(time * 1.5 + st.y * 2.0) * 0.5 + 0.5;

    vec3 finalColor;
    float t1 = smoothstep(0.85, 1.0, gradient);
    float t2 = smoothstep(0.7, 0.85, gradient);
    float t3 = smoothstep(0.5, 0.7, gradient);
    float t4 = smoothstep(0.3, 0.5, gradient);
    float t5 = smoothstep(0.15, 0.3, gradient);
    float t6 = smoothstep(0.0, 0.15, gradient);

    finalColor = mix(color6, color7, t6);
    finalColor = mix(finalColor, color5, t5);
    finalColor = mix(finalColor, color4, t4);
    finalColor = mix(finalColor, color3, t3);
    finalColor = mix(finalColor, color2, t2);
    finalColor = mix(finalColor, color1, t1);

    finalColor = mix(finalColor, color1, colorNoise * 0.82);
    finalColor = mix(finalColor, color5, colorShift * 0.5);

    vec2 aberration = curlForce * 0.02;
    vec3 aberrationColor = finalColor;
    aberrationColor.r = mix(finalColor.r, color1.r, length(aberration) * 2.0);
    aberrationColor.b = mix(finalColor.b, color4.b, length(aberration) * 1.5);
    aberrationColor.g = mix(finalColor.g, color5.g, length(aberration) * 1.2);

    float pulse1 = sin(time * 3.0 + st.y * 6.0) * 0.5 + 0.5;
    float pulse2 = sin(time * 4.5 - st.y * 8.0) * 0.5 + 0.5;
    float energyPulse = smoothstep(0.3, 0.7, pulse1 * pulse2);

    float intensity = finalShape * combinedStreaks * (1.0 + energyPulse * 0.4);
    intensity *= (1.0 + cells * 0.2);
    intensity *= u_intensity;

    vec2 mouse = u_mouse / u_resolution.xy;
    mouse = (mouse - 0.5) * 2.0;
    mouse.x *= u_resolution.x / u_resolution.y;

    float mouseInfluence = 1.0 - length(st - mouse) * 0.6;
    mouseInfluence = max(0.0, mouseInfluence);
    mouseInfluence = smoothstep(0.0, 1.0, mouseInfluence);

    intensity += mouseInfluence * 0.6;
    aberrationColor = mix(aberrationColor, color1, 0.3);

    vec3 result = aberrationColor * intensity;
    float bloom = smoothstep(0.4, 1.0, intensity) * 0.54;
    result += bloom * finalColor;

    result = pow(result, vec3(0.85));
    result = mix(result, result * result, 0.2);

    float vignette = 1.0 - length(uv - 0.5) * 0.85;
    vignette = smoothstep(0.2, 1.0, vignette);

    vec3 bgColor = vec3(0.04, 0.05, 0.07) + finalColor * 0.03;
    result = mix(bgColor, result, smoothstep(0.0, 0.4, intensity));
    result *= vignette;

    result = mix(vec3(dot(result, vec3(0.299, 0.587, 0.114))), result, 1.3);

    float grainValue = grain(uv, time * 0.5) * 2.0 - 1.0;
    result += grainValue * 0.11;

    float scanline = sin(uv.y * u_resolution.y * 2.0) * 0.04;
    result += scanline;

    gl_FragColor = vec4(result, 1.0);
  }
`;

/* ─── Animated phrase link ───────────────────────────────────────────── */

interface PhraseLinkProps {
  children: React.ReactNode;
  href: string;
}

function PhraseLink({ children, href }: PhraseLinkProps) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onEnter = () => {
      gsap.to(el, { scale: 1.04, rotationX: -2, z: 20, duration: 0.5, ease: 'power3.out' });
    };
    const onLeave = () => {
      gsap.to(el, { scale: 1, rotationX: 0, z: 0, duration: 0.5, ease: 'power3.out' });
    };

    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <a
      ref={ref}
      href={href}
      className="block mb-1 font-black leading-none cursor-pointer transform-gpu"
      style={{
        fontSize: 'clamp(3.5rem, 8vw, 7.5rem)',
        background: 'linear-gradient(135deg, #ffffff 0%, rgba(255,255,255,0.65) 100%)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        letterSpacing: '-0.04em',
        textDecoration: 'none',
      }}
    >
      {children}
    </a>
  );
}

/* ─── Main hero component ────────────────────────────────────────────── */

interface AitherHeroProps {
  onSignupDone?: (email: string) => void;
}

export default function AitherHero({ onSignupDone }: AitherHeroProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const posLocRef = useRef<number>(0);
  const timeLocRef = useRef<WebGLUniformLocation | null>(null);
  const resLocRef = useRef<WebGLUniformLocation | null>(null);
  const mouseLocRef = useRef<WebGLUniformLocation | null>(null);
  const intensityLocRef = useRef<WebGLUniformLocation | null>(null);
  const startRef = useRef(Date.now());
  const rafRef = useRef<number>(0);
  const [intensity, setIntensity] = useState(1.0);
  const intensityRef = useRef(1.0);

  // Beta form state
  const [betaName, setBetaName] = useState('');
  const [betaEmail, setBetaEmail] = useState('');
  const [betaCompany, setBetaCompany] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!betaEmail.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/beta/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: betaEmail.trim(), name: betaName.trim(), company: betaCompany.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Something went wrong');
      setDone(true);
      onSignupDone?.(betaEmail.trim());
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [betaEmail, betaName, betaCompany, onSignupDone]);

  /* ── WebGL init ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl');
    if (!gl) return;
    glRef.current = gl;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };

    const vs = compile(gl.VERTEX_SHADER, vertexShader);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentShader);
    if (!vs || !fs) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    programRef.current = prog;

    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    bufferRef.current = buf;

    posLocRef.current = gl.getAttribLocation(prog, 'position');
    timeLocRef.current = gl.getUniformLocation(prog, 'u_time');
    resLocRef.current = gl.getUniformLocation(prog, 'u_resolution');
    mouseLocRef.current = gl.getUniformLocation(prog, 'u_mouse');
    intensityLocRef.current = gl.getUniformLocation(prog, 'u_intensity');

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      mouseRef.current.x = (e.clientX - rect.left) * dpr;
      mouseRef.current.y = (rect.height - (e.clientY - rect.top)) * dpr;
      const target = { v: intensityRef.current };
      gsap.to(target, {
        v: 1.15,
        duration: 0.3,
        ease: 'power2.out',
        onUpdate: () => { intensityRef.current = target.v; },
      });
      gsap.to(target, {
        v: 1.0,
        duration: 1.0,
        delay: 0.1,
        ease: 'power2.out',
        onUpdate: () => { intensityRef.current = target.v; },
      });
    };
    canvas.addEventListener('mousemove', onMouseMove);

    /* ── Animation loop ── */
    const loop = () => {
      const t = (Date.now() - startRef.current) * 0.001;
      const gl2 = glRef.current;
      const prog2 = programRef.current;
      const buf2 = bufferRef.current;
      if (gl2 && prog2 && buf2 && timeLocRef.current && resLocRef.current && mouseLocRef.current && intensityLocRef.current) {
        gl2.useProgram(prog2);
        gl2.bindBuffer(gl2.ARRAY_BUFFER, buf2);
        gl2.enableVertexAttribArray(posLocRef.current);
        gl2.vertexAttribPointer(posLocRef.current, 2, gl2.FLOAT, false, 0, 0);
        gl2.uniform1f(timeLocRef.current, t);
        gl2.uniform2f(resLocRef.current, gl2.canvas.width, (gl2.canvas as HTMLCanvasElement).height);
        gl2.uniform2f(mouseLocRef.current, mouseRef.current.x, mouseRef.current.y);
        gl2.uniform1f(intensityLocRef.current, intensityRef.current);
        gl2.drawArrays(gl2.TRIANGLE_STRIP, 0, 4);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  const inputStyle: React.CSSProperties = {
    flex: 1,
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(154,102,255,0.3)',
    borderRadius: 10,
    padding: '0.7rem 1rem',
    color: '#EAEAEA',
    fontSize: '0.9rem',
    outline: 'none',
    backdropFilter: 'blur(8px)',
  };

  return (
    <section className="relative h-screen w-full overflow-hidden" style={{ background: '#0A0B10' }}>
      {/* WebGL canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Dark overlay so text is always legible */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(10,11,16,0.72) 0%, rgba(10,11,16,0.45) 50%, rgba(10,11,16,0.72) 100%)' }} />

      <div className="relative z-10 h-full flex flex-col justify-between px-8 pb-8 pt-24 md:px-12 md:pb-12 md:pt-28 lg:px-16 lg:pb-16 lg:pt-32">

        {/* ── Top bar ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#56D090', boxShadow: '0 0 8px #56D090', animation: 'pulse-ring 2s ease-out infinite' }} />
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Now in private beta · Invitation only
            </span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            aither.systems
          </span>
        </div>

        {/* ── Bottom content ── */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-10 lg:gap-16">

          {/* Left — large key phrases */}
          <nav className="flex-shrink-0">
            <PhraseLink href="#how-it-works">ORCHESTRATE</PhraseLink>
            <PhraseLink href="#features">COLLABORATE</PhraseLink>
            <PhraseLink href="#features">EXECUTE</PhraseLink>
            <PhraseLink href="#use-cases">REMEMBER</PhraseLink>
          </nav>

          {/* Right — description + beta form */}
          <div className="lg:max-w-md w-full space-y-5 lg:pb-1">
            <div>
              <p style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: '1.05rem', lineHeight: 1.5, marginBottom: '0.5rem' }}>
                The Operating System for Autonomous AI Teams
              </p>
              <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.88rem', lineHeight: 1.65 }}>
                AitherOS orchestrates teams of specialized agents that plan, collaborate, debate, and execute complex tasks — with full transparency, live streaming, and long-term memory.
              </p>
            </div>

            {/* Beta form */}
            <div id="beta">
              {done ? (
                <div style={{
                  background: 'rgba(86,208,144,0.1)',
                  border: '1px solid rgba(86,208,144,0.35)',
                  borderRadius: 14,
                  padding: '1.25rem 1.5rem',
                  backdropFilter: 'blur(12px)',
                }}>
                  <p style={{ color: '#56D090', fontWeight: 700, fontSize: '1rem', marginBottom: '0.3rem' }}>
                    You&apos;re on the list.
                  </p>
                  <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>
                    We&apos;ll reach out to {betaEmail} when your access is ready.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      placeholder="Your name"
                      value={betaName}
                      onChange={e => setBetaName(e.target.value)}
                      style={inputStyle}
                    />
                    <input
                      type="text"
                      placeholder="Company (optional)"
                      value={betaCompany}
                      onChange={e => setBetaCompany(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="email"
                      placeholder="your@email.com"
                      required
                      value={betaEmail}
                      onChange={e => setBetaEmail(e.target.value)}
                      style={inputStyle}
                    />
                    <button
                      type="submit"
                      disabled={submitting || !betaEmail.trim()}
                      style={{
                        background: submitting
                          ? 'rgba(154,102,255,0.4)'
                          : 'linear-gradient(135deg, #9A66FF, #7B4FDF)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 10,
                        padding: '0.7rem 1.25rem',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        cursor: submitting ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                        boxShadow: submitting ? 'none' : '0 4px 20px rgba(154,102,255,0.45)',
                      }}
                    >
                      {submitting ? 'Sending…' : 'Request Access →'}
                    </button>
                  </div>
                  {error && <p style={{ color: '#FF6B6B', fontSize: '0.82rem', margin: 0 }}>{error}</p>}
                  <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.75rem', margin: 0 }}>
                    No spam. We&apos;ll only email you when your access is ready.
                  </p>
                </form>
              )}
            </div>

            <a href="#how-it-works" style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.82rem', textDecoration: 'none', display: 'inline-block' }}>
              See how it works ↓
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
