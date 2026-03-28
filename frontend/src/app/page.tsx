'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform, AnimatePresence } from 'motion/react';
import Link from 'next/link';

/* ─── Brand palette ─── */
const C = {
  purple: '#9A66FF',
  cyan: '#14FFF7',
  green: '#56D090',
  amber: '#FFBF47',
  bg: '#0A0D11',
  card: '#1C1F26',
  border: 'rgba(154,102,255,0.18)',
  text: '#EAEAEA',
  muted: '#8892A4',
};

/* ─── Particle canvas ─── */
function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const stars = Array.from({ length: 180 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.2 + 0.2,
      alpha: Math.random(),
      speed: Math.random() * 0.003 + 0.001,
      color: Math.random() > 0.85
        ? (Math.random() > 0.5 ? C.purple : C.cyan)
        : '#ffffff',
    }));

    let t = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      t += 0.01;
      stars.forEach((s) => {
        s.alpha = 0.3 + 0.7 * Math.abs(Math.sin(t * s.speed * 60));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.globalAlpha = s.alpha * 0.6;
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      style={{ opacity: 0.7 }}
    />
  );
}

/* ─── Typewriter effect ─── */
const HEADLINES = [
  'The Operating System for Autonomous AI Teams.',
  'Coordinate Autonomous Agents.',
  'Ship Smarter, Not Harder.',
  'Orchestrate Intelligence at Scale.',
];
function Typewriter() {
  const [idx, setIdx] = useState(0);
  const [display, setDisplay] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const target = HEADLINES[idx];
    let timeout: ReturnType<typeof setTimeout>;

    if (!deleting && display.length < target.length) {
      timeout = setTimeout(() => setDisplay(target.slice(0, display.length + 1)), 55);
    } else if (!deleting && display.length === target.length) {
      timeout = setTimeout(() => setDeleting(true), 2400);
    } else if (deleting && display.length > 0) {
      timeout = setTimeout(() => setDisplay(display.slice(0, -1)), 28);
    } else if (deleting && display.length === 0) {
      setDeleting(false);
      setIdx((i) => (i + 1) % HEADLINES.length);
    }
    return () => clearTimeout(timeout);
  }, [display, deleting, idx]);

  return (
    <span style={{ color: C.purple }}>
      {display}
      <span
        style={{
          display: 'inline-block',
          width: 3,
          height: '1em',
          background: C.purple,
          marginLeft: 3,
          verticalAlign: 'middle',
          animation: 'blink 1s step-end infinite',
        }}
      />
    </span>
  );
}

/* ─── Animated grid / mesh bg ─── */
function GridMesh({ style }: { style?: React.CSSProperties }) {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px),
          linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
        maskImage:
          'radial-gradient(ellipse 80% 60% at 50% 50%, black 30%, transparent 100%)',
        ...style,
      }}
    />
  );
}

/* ─── Feature card ─── */
function FeatureCard({
  icon,
  title,
  desc,
  color,
  delay = 0,
}: {
  icon: string;
  title: string;
  desc: string;
  color: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.55, delay, ease: 'easeOut' }}
      whileHover={{ scale: 1.03, y: -4 }}
      style={{
        background: `linear-gradient(135deg, ${C.card} 0%, rgba(28,31,38,0.6) 100%)`,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: '2rem 1.75rem',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'default',
      }}
    >
      {/* glow spot */}
      <div
        style={{
          position: 'absolute',
          top: -30,
          right: -30,
          width: 120,
          height: 120,
          borderRadius: '50%',
          background: color,
          opacity: 0.07,
          filter: 'blur(30px)',
        }}
      />
      <div style={{ fontSize: 36, marginBottom: 16 }}>{icon}</div>
      <h3
        style={{
          color: C.text,
          fontSize: '1.15rem',
          fontWeight: 700,
          marginBottom: 10,
          letterSpacing: '-0.02em',
        }}
      >
        {title}
      </h3>
      <p style={{ color: C.muted, fontSize: '0.92rem', lineHeight: 1.65 }}>{desc}</p>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
          opacity: 0.5,
        }}
      />
    </motion.div>
  );
}

/* ─── Agent orb (animated workflow) ─── */
function AgentOrb({
  label,
  color,
  style,
  delay = 0,
}: {
  label: string;
  color: string;
  style?: React.CSSProperties;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay, ease: 'backOut' }}
      style={{
        position: 'absolute',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        ...style,
      }}
    >
      <motion.div
        animate={{ boxShadow: [`0 0 12px ${color}44`, `0 0 28px ${color}88`, `0 0 12px ${color}44`] }}
        transition={{ duration: 2.5, repeat: Infinity, delay }}
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: `radial-gradient(circle at 35% 35%, ${color}cc, ${color}44)`,
          border: `2px solid ${color}88`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
        }}
      >
        🤖
      </motion.div>
      <span
        style={{
          color: C.text,
          fontSize: '0.75rem',
          fontWeight: 600,
          background: `${color}18`,
          border: `1px solid ${color}44`,
          borderRadius: 20,
          padding: '2px 10px',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </motion.div>
  );
}

/* ─── Animated connection line ─── */
function Connector({
  x1, y1, x2, y2, color, delay = 0, strokeDasharray: sda,
}: {
  x1: number; y1: number; x2: number; y2: number; color: string; delay?: number; strokeDasharray?: string;
}) {
  const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  return (
    <motion.line
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={color}
      strokeWidth={1.5}
      strokeDasharray={sda ?? len}
      strokeDashoffset={len}
      animate={{ strokeDashoffset: 0 }}
      transition={{ duration: 1.0, delay, ease: 'easeOut' }}
      opacity={0.45}
    />
  );
}

/* ─── Stat counter ─── */
function StatCounter({ end, suffix, label }: { end: number; suffix: string; label: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          let start = 0;
          const step = end / 60;
          const id = setInterval(() => {
            start = Math.min(start + step, end);
            setVal(Math.round(start));
            if (start >= end) clearInterval(id);
          }, 16);
        }
      },
      { threshold: 0.5 },
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [end]);

  return (
    <div ref={ref} style={{ textAlign: 'center' }}>
      <div
        style={{
          fontSize: '3rem',
          fontWeight: 800,
          letterSpacing: '-0.04em',
          background: `linear-gradient(135deg, ${C.purple}, ${C.cyan})`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          lineHeight: 1,
        }}
      >
        {val}
        {suffix}
      </div>
      <div style={{ color: C.muted, fontSize: '0.88rem', marginTop: 6 }}>{label}</div>
    </div>
  );
}

/* ─── Main page ─── */
export default function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroOpacity = useTransform(scrollYProgress, [0, 1], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 80]);

  return (
    <div
      style={{
        background: C.bg,
        color: C.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        overflowX: 'hidden',
      }}
    >
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        @keyframes spin-slow { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        .glow-text {
          text-shadow: 0 0 40px rgba(154,102,255,0.45), 0 0 80px rgba(154,102,255,0.2);
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: rgba(154,102,255,0.4); border-radius: 3px; }
      `}</style>

      <StarField />

      {/* ── NAV ── */}
      <nav
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 2.5rem',
          background: 'rgba(10,13,17,0.85)',
          backdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${C.purple}, ${C.cyan})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              fontWeight: 800,
              color: '#fff',
            }}
          >
            A
          </div>
          <span style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>
            AitherOS
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <a href="#features" style={{ color: C.muted, fontSize: '0.9rem', textDecoration: 'none' }}>
            Features
          </a>
          <a href="#how-it-works" style={{ color: C.muted, fontSize: '0.9rem', textDecoration: 'none' }}>
            How it works
          </a>
          <a href="#use-cases" style={{ color: C.muted, fontSize: '0.9rem', textDecoration: 'none' }}>
            Use Cases
          </a>
          <Link
            href="/dashboard/overview"
            style={{
              background: `linear-gradient(135deg, ${C.purple}, #7B4FDF)`,
              color: '#fff',
              padding: '0.45rem 1.2rem',
              borderRadius: 8,
              fontSize: '0.88rem',
              fontWeight: 600,
              textDecoration: 'none',
              boxShadow: `0 0 20px ${C.purple}44`,
            }}
          >
            Open App →
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section
        ref={heroRef}
        style={{
          position: 'relative',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '8rem 2rem 4rem',
          overflow: 'hidden',
        }}
      >
        {/* ambient gradient blobs */}
        <div
          style={{
            position: 'absolute',
            top: '10%',
            left: '15%',
            width: 600,
            height: 600,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${C.purple}18 0%, transparent 70%)`,
            filter: 'blur(60px)',
            animation: 'float 8s ease-in-out infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '10%',
            right: '10%',
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${C.cyan}12 0%, transparent 70%)`,
            filter: 'blur(50px)',
            animation: 'float 10s ease-in-out infinite reverse',
          }}
        />

        <GridMesh />

        <motion.div style={{ opacity: heroOpacity, y: heroY, position: 'relative', zIndex: 1 }}>
          {/* badge */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: `${C.purple}14`,
              border: `1px solid ${C.purple}44`,
              borderRadius: 100,
              padding: '0.35rem 1rem',
              marginBottom: '2rem',
              fontSize: '0.82rem',
              color: C.purple,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: C.green,
                boxShadow: `0 0 8px ${C.green}`,
                animation: 'pulse-ring 2s ease-out infinite',
                display: 'inline-block',
              }}
            />
            Now in private beta · Coming soon to everyone
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="glow-text"
            style={{
              fontSize: 'clamp(2.8rem, 6vw, 5.5rem)',
              fontWeight: 900,
              lineHeight: 1.05,
              letterSpacing: '-0.04em',
              marginBottom: '1.25rem',
              maxWidth: 900,
            }}
          >
            The Operating System
            <br />
            for{' '}
            <span
              style={{
                background: `linear-gradient(135deg, ${C.purple} 0%, ${C.cyan} 100%)`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Autonomous AI Teams
            </span>
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            style={{
              fontSize: 'clamp(1.2rem, 2.5vw, 1.6rem)',
              fontWeight: 400,
              color: C.muted,
              marginBottom: '2.5rem',
              minHeight: '2.4em',
            }}
          >
            <Typewriter />
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            style={{
              color: C.muted,
              maxWidth: 640,
              margin: '0 auto 3rem',
              fontSize: '1.05rem',
              lineHeight: 1.7,
            }}
          >
            AitherOS orchestrates teams of specialized AI agents that plan, collaborate, debate, and
            execute complex tasks — with full transparency, live streaming, and long-term memory.
            Not a chatbot. An actual workforce.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}
          >
            <Link
              href="/dashboard/overview"
              style={{
                background: `linear-gradient(135deg, ${C.purple}, #7B4FDF)`,
                color: '#fff',
                padding: '0.85rem 2rem',
                borderRadius: 10,
                fontSize: '1rem',
                fontWeight: 700,
                textDecoration: 'none',
                boxShadow: `0 4px 24px ${C.purple}55`,
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
            >
              Launch App →
            </Link>
            <a
              href="#how-it-works"
              style={{
                background: 'transparent',
                color: C.text,
                padding: '0.85rem 2rem',
                borderRadius: 10,
                fontSize: '1rem',
                fontWeight: 600,
                textDecoration: 'none',
                border: `1px solid ${C.border}`,
                backdropFilter: 'blur(8px)',
              }}
            >
              See how it works
            </a>
          </motion.div>

          {/* floating image placeholder */}
          <motion.div
            initial={{ opacity: 0, y: 48 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.65, ease: 'easeOut' }}
            style={{
              marginTop: '4.5rem',
              position: 'relative',
              display: 'inline-block',
            }}
          >
            {/* outer glow ring */}
            <div
              style={{
                position: 'absolute',
                inset: -2,
                borderRadius: 20,
                background: `linear-gradient(135deg, ${C.purple}88, ${C.cyan}44, transparent)`,
                zIndex: -1,
                filter: 'blur(1px)',
              }}
            />
            <div
              style={{
                width: 'min(860px, 90vw)',
                height: 'clamp(240px, 30vw, 420px)',
                borderRadius: 18,
                background: `linear-gradient(135deg, ${C.card} 0%, #13161C 100%)`,
                border: `1px solid ${C.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <GridMesh />
              {/* mock dashboard UI */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  padding: '1.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                {/* title bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF605C' }} />
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#FFBD44' }} />
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#00CA4E' }} />
                  <div style={{ flex: 1, height: 14, background: 'rgba(255,255,255,0.05)', borderRadius: 4, marginLeft: 16 }} />
                </div>
                {/* mock content rows */}
                <div style={{ display: 'flex', gap: 12, flex: 1 }}>
                  {/* sidebar */}
                  <div style={{ width: 140, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {['Overview', 'Workforces', 'Executions', 'Agents', 'Knowledge'].map((item, i) => (
                      <motion.div
                        key={item}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.8 + i * 0.08 }}
                        style={{
                          height: 28,
                          borderRadius: 6,
                          background: i === 1 ? `${C.purple}33` : 'rgba(255,255,255,0.04)',
                          border: i === 1 ? `1px solid ${C.purple}44` : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: 10,
                          fontSize: '0.7rem',
                          color: i === 1 ? C.purple : C.muted,
                          fontWeight: i === 1 ? 600 : 400,
                        }}
                      >
                        {item}
                      </motion.div>
                    ))}
                  </div>
                  {/* main area */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[
                        { label: 'Active Workforces', val: '3', color: C.purple },
                        { label: 'Running Now', val: '2', color: C.green },
                        { label: 'Tasks Done', val: '47', color: C.cyan },
                        { label: 'Agents Online', val: '12', color: C.amber },
                      ].map((s, i) => (
                        <motion.div
                          key={s.label}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 1.0 + i * 0.1 }}
                          style={{
                            flex: 1,
                            background: 'rgba(255,255,255,0.04)',
                            borderRadius: 8,
                            padding: '8px 10px',
                            border: `1px solid ${s.color}22`,
                          }}
                        >
                          <div style={{ fontSize: '0.6rem', color: C.muted, marginBottom: 2 }}>{s.label}</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: s.color }}>{s.val}</div>
                        </motion.div>
                      ))}
                    </div>
                    {/* event feed */}
                    <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 10, overflow: 'hidden' }}>
                      {[
                        { agent: 'Daedalus', msg: 'Planning subtasks for sprint...', color: C.purple },
                        { agent: 'Clio', msg: 'Researching competitor landscape', color: C.cyan },
                        { agent: 'Atlas', msg: '✓ Generated technical spec (3 files)', color: C.green },
                        { agent: 'Hermes', msg: 'Consulting Daedalus for context...', color: C.amber },
                      ].map((e, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: 12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 1.2 + i * 0.15 }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            marginBottom: 6,
                            fontSize: '0.65rem',
                          }}
                        >
                          <div
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              background: `${e.color}33`,
                              border: `1px solid ${e.color}66`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 9,
                              flexShrink: 0,
                            }}
                          >
                            🤖
                          </div>
                          <span style={{ color: e.color, fontWeight: 600 }}>{e.agent}</span>
                          <span style={{ color: C.muted }}>{e.msg}</span>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              {/* image placeholder overlay hint */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 8,
                  right: 12,
                  fontSize: '0.65rem',
                  color: `${C.muted}66`,
                  fontStyle: 'italic',
                }}
              >
                {/* screenshot placeholder */}
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2 }}
          style={{
            position: 'absolute',
            bottom: 32,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            color: C.muted,
            fontSize: '0.75rem',
          }}
        >
          <span>scroll to explore</span>
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            style={{ fontSize: 18 }}
          >
            ↓
          </motion.div>
        </motion.div>
      </section>

      {/* ── STATS ── */}
      <section
        style={{
          padding: '5rem 2rem',
          borderTop: `1px solid ${C.border}`,
          borderBottom: `1px solid ${C.border}`,
          position: 'relative',
          background: `linear-gradient(180deg, transparent 0%, ${C.card}44 50%, transparent 100%)`,
        }}
      >
        <div
          style={{
            maxWidth: 900,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '3rem',
          }}
        >
          <StatCounter end={10} suffix="x" label="Faster than solo LLM calls" />
          <StatCounter end={40} suffix="+" label="Tool rounds per agent" />
          <StatCounter end={100} suffix="%" label="Streaming real-time" />
          <StatCounter end={5} suffix=" models" label="Provider agnostic" />
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section
        id="features"
        style={{ padding: '8rem 2rem', position: 'relative', maxWidth: 1200, margin: '0 auto' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          style={{ textAlign: 'center', marginBottom: '4rem' }}
        >
          <span
            style={{
              color: C.purple,
              fontSize: '0.8rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              display: 'block',
              marginBottom: 12,
            }}
          >
            Platform capabilities
          </span>
          <h2
            style={{
              fontSize: 'clamp(2rem, 4vw, 3rem)',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              marginBottom: 16,
            }}
          >
            Everything a real team does.{' '}
            <span
              style={{
                background: `linear-gradient(135deg, ${C.purple}, ${C.cyan})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Automatically.
            </span>
          </h2>
          <p style={{ color: C.muted, maxWidth: 560, margin: '0 auto', fontSize: '1.05rem', lineHeight: 1.65 }}>
            AitherOS brings genuine multi-agent coordination to production workflows — not prompt
            chaining, but actual team dynamics.
          </p>
        </motion.div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.5rem',
          }}
        >
          <FeatureCard
            icon="🧠"
            title="Autonomous Planning"
            desc="A dedicated orchestrator decomposes your objective into subtasks, assigns the right agent for each, and coordinates dependencies — no manual prompting required."
            color={C.purple}
            delay={0}
          />
          <FeatureCard
            icon="💬"
            title="Peer Consultation"
            desc="Agents can pause mid-execution to consult colleagues. Daedalus asks Clio for context; Hermes checks with Atlas before proceeding. Real collaboration, not parallel silos."
            color={C.cyan}
            delay={0.1}
          />
          <FeatureCard
            icon="🔧"
            title="MCP Tool Integration"
            desc="Connect any MCP server — GitHub, Slack, Jira, databases, or custom tools. Agents pick up the right tools automatically via credential-aware discovery."
            color={C.green}
            delay={0.2}
          />
          <FeatureCard
            icon="🧬"
            title="Long-Term Memory"
            desc="Every execution result is embedded and stored in a per-workforce vector knowledge base. Agents recall relevant past work across sessions — genuine institutional memory."
            color={C.amber}
            delay={0.3}
          />
          <FeatureCard
            icon="📡"
            title="Live Streaming Events"
            desc="Watch every agent thought, tool call, and discussion in real time via WebSocket event streaming. Full observability into what's happening, why, and what's next."
            color={C.purple}
            delay={0.4}
          />
          <FeatureCard
            icon="🛑"
            title="Human-in-the-Loop"
            desc="Blocked? Uncertain? Agents escalate to a human pause state with a clear explanation. You answer, they continue — no restarts, no lost context."
            color={C.cyan}
            delay={0.5}
          />
          <FeatureCard
            icon="🔐"
            title="Secure Credential Vault"
            desc="API keys and tokens stored per-workforce, injected at runtime only when needed. Agents access secrets through a controlled get_secret() tool, never embedded in prompts."
            color={C.green}
            delay={0.6}
          />
          <FeatureCard
            icon="🌐"
            title="Provider Agnostic"
            desc="OpenAI, Anthropic, Mistral, local Ollama — switch models per-agent per-workflow via LiteLLM proxy. No vendor lock-in at any layer."
            color={C.amber}
            delay={0.7}
          />
          <FeatureCard
            icon="📚"
            title="Knowledge Base & RAG"
            desc="Manually curate workforce knowledge or let executions auto-populate it. Semantic search (cosine similarity, pgvector) surfaces relevant context for every new task."
            color={C.purple}
            delay={0.8}
          />
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section
        id="how-it-works"
        style={{
          padding: '8rem 2rem',
          background: `linear-gradient(180deg, transparent, ${C.card}33, transparent)`,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            style={{ textAlign: 'center', marginBottom: '5rem' }}
          >
            <span
              style={{
                color: C.cyan,
                fontSize: '0.8rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                display: 'block',
                marginBottom: 12,
              }}
            >
              Under the hood
            </span>
            <h2
              style={{
                fontSize: 'clamp(2rem, 4vw, 3rem)',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                marginBottom: 16,
              }}
            >
              From objective to result
            </h2>
            <p style={{ color: C.muted, maxWidth: 520, margin: '0 auto', fontSize: '1.05rem', lineHeight: 1.65 }}>
              Submit a single goal. AitherOS handles the rest — end to end.
            </p>
          </motion.div>

          {/* Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              {
                step: '01',
                title: 'Define your workforce',
                desc: 'Create a named team. Add specialized agents — each with a role, model, system prompt, and MCP tool access. Think of it as hiring: Daedalus plans, Clio researches, Atlas builds.',
                color: C.purple,
                icon: '👥',
              },
              {
                step: '02',
                title: 'Submit an objective',
                desc: 'Write a natural-language goal: "Audit our GitHub repo and generate a security report with remediation steps." Hit execute. No prompt engineering required.',
                color: C.cyan,
                icon: '🎯',
              },
              {
                step: '03',
                title: 'Agents plan & consult',
                desc: 'The orchestrator decomposes the objective into subtasks. Agents claim tasks, call tools, and consult peers mid-execution. Discussions are logged and visible.',
                color: C.green,
                icon: '🔄',
              },
              {
                step: '04',
                title: 'Watch it happen live',
                desc: 'Every agent action streams to your dashboard in real time. See tool calls, LLM responses, peer consultations, and memory retrievals as they happen.',
                color: C.amber,
                icon: '📊',
              },
              {
                step: '05',
                title: 'Review & iterate',
                desc: 'The final result is synthesized, stored in the knowledge base, and presented with a full audit trail. Run it again with more context next time — agents remember.',
                color: C.purple,
                icon: '✅',
              },
            ].map((s, i) => (
              <motion.div
                key={s.step}
                initial={{ opacity: 0, x: i % 2 === 0 ? -40 : 40 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.1 }}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '2.5rem',
                  padding: '2.5rem 0',
                  borderBottom: i < 4 ? `1px solid ${C.border}` : 'none',
                  flexDirection: i % 2 === 0 ? 'row' : 'row-reverse',
                }}
              >
                <div style={{ flexShrink: 0, textAlign: 'center', width: 80 }}>
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 16,
                      background: `${s.color}18`,
                      border: `1px solid ${s.color}44`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 28,
                      margin: '0 auto 8px',
                    }}
                  >
                    {s.icon}
                  </div>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      color: s.color,
                      letterSpacing: '0.08em',
                    }}
                  >
                    STEP {s.step}
                  </span>
                </div>
                <div style={{ flex: 1 }}>
                  <h3
                    style={{
                      fontSize: '1.4rem',
                      fontWeight: 700,
                      letterSpacing: '-0.02em',
                      marginBottom: 12,
                      color: C.text,
                    }}
                  >
                    {s.title}
                  </h3>
                  <p style={{ color: C.muted, fontSize: '1rem', lineHeight: 1.7, maxWidth: 560 }}>
                    {s.desc}
                  </p>
                </div>
                {/* image placeholder */}
                <div
                  style={{
                    flexShrink: 0,
                    width: 280,
                    height: 160,
                    borderRadius: 12,
                    background: `linear-gradient(135deg, ${C.card} 0%, #13161C 100%)`,
                    border: `1px solid ${s.color}22`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: `${s.color}44`,
                    fontSize: '0.75rem',
                    fontStyle: 'italic',
                  }}
                  className="screenshot-placeholder"
                >
                  <span style={{ textAlign: 'center', padding: '0 20px' }}>
                    📷<br />Screenshot placeholder
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AGENT NETWORK VISUALIZATION ── */}
      <section
        style={{
          padding: '8rem 2rem',
          position: 'relative',
          overflow: 'hidden',
          textAlign: 'center',
        }}
      >
        <GridMesh />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          style={{ marginBottom: '3rem', position: 'relative', zIndex: 1 }}
        >
          <span
            style={{
              color: C.green,
              fontSize: '0.8rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              display: 'block',
              marginBottom: 12,
            }}
          >
            Live collaboration
          </span>
          <h2
            style={{
              fontSize: 'clamp(2rem, 4vw, 3rem)',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              marginBottom: 16,
            }}
          >
            Agents that actually talk to each other
          </h2>
          <p style={{ color: C.muted, maxWidth: 520, margin: '0 auto', fontSize: '1.05rem', lineHeight: 1.65 }}>
            Mid-execution peer consultation means no agent operates in isolation. Your workforce
            reaches consensus, shares context, and escalates blockers — like a real team.
          </p>
        </motion.div>

        {/* SVG network diagram */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: 700,
            height: 380,
            margin: '0 auto',
          }}
        >
          <motion.svg
            width="100%"
            height="100%"
            viewBox="0 0 700 380"
            style={{ position: 'absolute', inset: 0 }}
          >
            {/* connection lines */}
            <Connector x1={350} y1={80} x2={180} y2={220} color={C.purple} delay={0.5} />
            <Connector x1={350} y1={80} x2={350} y2={240} color={C.cyan} delay={0.7} />
            <Connector x1={350} y1={80} x2={520} y2={220} color={C.green} delay={0.9} />
            <Connector x1={180} y1={220} x2={350} y2={320} color={C.amber} delay={1.2} />
            <Connector x1={520} y1={220} x2={350} y2={320} color={C.purple} delay={1.4} />
            <Connector x1={180} y1={220} x2={520} y2={220} color={C.cyan} delay={1.6} strokeDasharray="4 4" />
          </motion.svg>

          {/* Orchestrator - center top */}
          <AgentOrb label="Orchestrator" color={C.purple} style={{ top: 30, left: '50%', transform: 'translateX(-50%)' }} delay={0.2} />
          {/* Left agent */}
          <AgentOrb label="Researcher" color={C.cyan} style={{ top: 170, left: '18%' }} delay={0.6} />
          {/* Center agent */}
          <AgentOrb label="Analyst" color={C.green} style={{ top: 190, left: '50%', transform: 'translateX(-50%)' }} delay={0.8} />
          {/* Right agent */}
          <AgentOrb label="Builder" color={C.amber} style={{ top: 170, right: '18%' }} delay={1.0} />
          {/* Bottom center */}
          <AgentOrb label="Reviewer" color={C.purple} style={{ bottom: 10, left: '50%', transform: 'translateX(-50%)' }} delay={1.3} />
        </div>

        {/* consultation message bubbles */}
        <div
          style={{
            maxWidth: 700,
            margin: '3rem auto 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {[
            { from: 'Researcher', to: 'Analyst', msg: 'I found 3 relevant datasets — can you verify statistical significance?', color: C.cyan, delay: 1.8 },
            { from: 'Analyst', to: 'Builder', msg: 'Confirmed. Confidence 94%. Proceed with implementation.', color: C.green, delay: 2.1 },
            { from: 'Builder', to: 'Orchestrator', msg: 'Module complete. Requesting review from Reviewer before merge.', color: C.amber, delay: 2.4 },
          ].map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: m.delay * 0.4 }}
              style={{
                background: `${m.color}0C`,
                border: `1px solid ${m.color}22`,
                borderRadius: 10,
                padding: '0.75rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: m.color,
                  minWidth: 80,
                }}
              >
                {m.from} →
              </span>
              <span style={{ fontSize: '0.75rem', color: C.muted, flex: 1 }}>{m.msg}</span>
              <span style={{ fontSize: '0.7rem', color: `${m.color}66` }}>@{m.to}</span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── USE CASES ── */}
      <section
        id="use-cases"
        style={{
          padding: '8rem 2rem',
          background: `linear-gradient(180deg, transparent, ${C.card}44, transparent)`,
        }}
      >
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            style={{ textAlign: 'center', marginBottom: '4rem' }}
          >
            <span
              style={{
                color: C.amber,
                fontSize: '0.8rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                display: 'block',
                marginBottom: 12,
              }}
            >
              What teams use it for
            </span>
            <h2
              style={{
                fontSize: 'clamp(2rem, 4vw, 3rem)',
                fontWeight: 800,
                letterSpacing: '-0.03em',
              }}
            >
              Built for real work
            </h2>
          </motion.div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '1.25rem',
            }}
          >
            {[
              {
                title: 'Engineering',
                items: [
                  'Code review & security audit pipelines',
                  'Automated PR description + test generation',
                  'Architecture analysis and refactoring plans',
                  'Dependency vulnerability scanning',
                ],
                color: C.purple,
                icon: '⚙️',
              },
              {
                title: 'Research & Analysis',
                items: [
                  'Competitive intelligence reports',
                  'Market research synthesis from multiple sources',
                  'Literature reviews with citation extraction',
                  'Data pipeline analysis and anomaly detection',
                ],
                color: C.cyan,
                icon: '🔬',
              },
              {
                title: 'Content & Marketing',
                items: [
                  'Multi-format content campaigns (blog → social → email)',
                  'SEO audit and optimization briefs',
                  'Brand voice consistency checks at scale',
                  'Product launch documentation packages',
                ],
                color: C.green,
                icon: '✍️',
              },
              {
                title: 'Operations',
                items: [
                  'Incident triage and post-mortem drafting',
                  'Runbook generation from logs and metrics',
                  'Onboarding document creation',
                  'Vendor evaluation and comparison matrices',
                ],
                color: C.amber,
                icon: '📋',
              },
            ].map((uc, i) => (
              <motion.div
                key={uc.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 16,
                  padding: '2rem',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: `linear-gradient(90deg, ${uc.color}, transparent)`,
                  }}
                />
                <div style={{ fontSize: 32, marginBottom: 12 }}>{uc.icon}</div>
                <h3
                  style={{
                    fontSize: '1.15rem',
                    fontWeight: 700,
                    marginBottom: 16,
                    color: C.text,
                  }}
                >
                  {uc.title}
                </h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {uc.items.map((item) => (
                    <li
                      key={item}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        color: C.muted,
                        fontSize: '0.9rem',
                        lineHeight: 1.5,
                      }}
                    >
                      <span style={{ color: uc.color, marginTop: 2, flexShrink: 0 }}>→</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMING SOON / CTA ── */}
      <section
        style={{
          padding: '10rem 2rem',
          position: 'relative',
          textAlign: 'center',
          overflow: 'hidden',
        }}
      >
        {/* radial glow */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(ellipse 80% 60% at 50% 50%, ${C.purple}14 0%, transparent 70%)`,
            pointerEvents: 'none',
          }}
        />
        <GridMesh />

        {/* rotating ring */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 500,
            height: 500,
            borderRadius: '50%',
            border: `1px solid ${C.purple}18`,
            animation: 'spin-slow 30s linear infinite',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 700,
            height: 700,
            borderRadius: '50%',
            border: `1px solid ${C.cyan}0C`,
            animation: 'spin-slow 50s linear infinite reverse',
            pointerEvents: 'none',
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          style={{ position: 'relative', zIndex: 1 }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: `${C.amber}14`,
              border: `1px solid ${C.amber}44`,
              borderRadius: 100,
              padding: '0.4rem 1.2rem',
              marginBottom: '2rem',
              fontSize: '0.85rem',
              color: C.amber,
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            ⏳ &nbsp;Coming soon to the public
          </div>

          <h2
            className="glow-text"
            style={{
              fontSize: 'clamp(2.5rem, 5vw, 4.5rem)',
              fontWeight: 900,
              letterSpacing: '-0.04em',
              marginBottom: '1.25rem',
              lineHeight: 1.05,
            }}
          >
            The Operating System
            <br />
            <span
              style={{
                background: `linear-gradient(135deg, ${C.purple}, ${C.cyan})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              for Autonomous AI Teams
            </span>
          </h2>

          <p
            style={{
              color: C.muted,
              maxWidth: 560,
              margin: '0 auto 3rem',
              fontSize: '1.1rem',
              lineHeight: 1.7,
            }}
          >
            AitherOS is currently in private beta. We&apos;re working to make multi-agent AI workflows
            accessible to every team. In the meantime, if you have access — log in and explore.
          </p>

          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              href="/dashboard/overview"
              style={{
                background: `linear-gradient(135deg, ${C.purple}, #7B4FDF)`,
                color: '#fff',
                padding: '1rem 2.5rem',
                borderRadius: 10,
                fontSize: '1.05rem',
                fontWeight: 700,
                textDecoration: 'none',
                boxShadow: `0 4px 32px ${C.purple}66`,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              🚀 Open the App
            </Link>
          </div>

          {/* feature pills */}
          <div
            style={{
              marginTop: '3.5rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              justifyContent: 'center',
              maxWidth: 700,
              margin: '3.5rem auto 0',
            }}
          >
            {[
              { label: 'Self-hosted', color: C.green },
              { label: 'Open architecture', color: C.cyan },
              { label: 'Streaming events', color: C.purple },
              { label: 'Multi-model support', color: C.amber },
              { label: 'MCP native', color: C.green },
              { label: 'Long-term memory', color: C.purple },
              { label: 'Real-time collaboration', color: C.cyan },
              { label: 'Full audit trail', color: C.amber },
            ].map((p) => (
              <span
                key={p.label}
                style={{
                  background: `${p.color}12`,
                  border: `1px solid ${p.color}33`,
                  borderRadius: 100,
                  padding: '0.35rem 0.9rem',
                  fontSize: '0.8rem',
                  color: p.color,
                  fontWeight: 500,
                }}
              >
                {p.label}
              </span>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── FOOTER ── */}
      <footer
        style={{
          borderTop: `1px solid ${C.border}`,
          padding: '3rem 2.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          background: 'rgba(10,13,17,0.9)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: `linear-gradient(135deg, ${C.purple}, ${C.cyan})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 800,
              color: '#fff',
            }}
          >
            A
          </div>
          <span style={{ fontWeight: 700, color: C.text }}>AitherOS</span>
          <span style={{ color: C.muted, fontSize: '0.85rem', marginLeft: 8 }}>
            The Operating System for Autonomous AI Teams
          </span>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <Link
            href="/dashboard/overview"
            style={{ color: C.muted, fontSize: '0.88rem', textDecoration: 'none' }}
          >
            App
          </Link>
          <span style={{ color: `${C.muted}44` }}>·</span>
          <span style={{ color: C.muted, fontSize: '0.88rem' }}>Private Beta</span>
          <span style={{ color: `${C.muted}44` }}>·</span>
          <span style={{ color: `${C.muted}66`, fontSize: '0.82rem' }}>
            © {new Date().getFullYear()} AitherOS
          </span>
        </div>
      </footer>

      {/* hide screenshot placeholders on mobile */}
      <style>{`
        @media (max-width: 768px) {
          .screenshot-placeholder { display: none !important; }
          nav { padding: 0.75rem 1.25rem !important; }
          nav a:not(:last-child) { display: none; }
        }
      `}</style>
    </div>
  );
}
