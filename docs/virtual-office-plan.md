# AitherOS Virtual Office — Implementation Plan

> **Status:** Planned — awaiting asset generation workforce run
> **Origin:** Architecture doc "M5 — The Office" (PixiJS visual simulation, avatar states, real-time event mapping)
> **Vision:** A live Gather.town-style 2D office that users see instead of (or alongside) the current dashboard. AI agents are persistent characters with desks, animations tied to real WebSocket events, and speech bubbles showing live work.

---

## 1. Visual Direction

### Style: "Cyberpunk Lo-fi Office"
- **Reference:** Gather.town + XCOM 2 base view + va11-hall-a aesthetic
- **Projection:** Top-down 2D, slight isometric tilt (2:1 ratio), not pure flat — gives depth without full iso complexity
- **Resolution:** 64×64px base tile, 48×64px character sprites (3–4 frame walk cycle + idle + working states)
- **Palette:** Dark floors (`#0A0D11` base), neon accent lighting matching the app's existing color system:
  - Purple glow `#9A66FF` — busy/executing agents
  - Cyan glow `#14FFF7` — planning/thinking agents
  - Green glow `#56D090` — completed, idle-happy
  - Amber `#FFBF47` — awaiting approval / halted
  - Red `#EF4444` — failed
- **Mood:** Night-shift tech startup. Monitors casting colored light onto dark floors. No bright whites. Slight scanline texture overlay.
- **NOT:** Habbo Hotel (too retro/rigid), Stardew Valley (too pastoral), generic anime chibi (too cute)

### Room Layout
```
┌─────────────────────────────────────────────────────┐
│  🌿 Plants  │     BRIEFING AREA      │  📊 Board   │
│             │   (execution kicks     │             │
│  [Lounge]   │    off here, agents    │  [Kanban]   │
│  idle chars │    gather + plan)      │  wall       │
├─────────────────────────────────────────────────────┤
│  DESK ROW 1                                         │
│  [Agent A]  [Agent B]  [Agent C]  [Agent D]         │
│   desk       desk       desk       desk             │
├─────────────────────────────────────────────────────┤
│  DESK ROW 2                                         │
│  [Agent E]  [Agent F]  [Server rack]  [Whiteboard]  │
│   desk       desk                                   │
├─────────────────────────────────────────────────────┤
│  [Break area / Memory vault]   │  [Exit / Deploy]   │
└─────────────────────────────────────────────────────┘
```

### Event → Animation Mapping
| WebSocket Event | Animation |
|---|---|
| `execution.started` | Agents assigned to this run walk from lounge to their desk; desk screen lights up in workforce color |
| `execution.planning` | Agents gather at Briefing Area; Cyan glow; thought bubbles |
| `agent.thinking` | Spinning thought bubble above sprite |
| `agent.message` | Speech bubble with first 60 chars of message content |
| `tool.called` | Tool-specific micro-animation (typing for write_file, search icon spin for web_search) |
| `peer.consultation` | Two agent sprites turn to face each other; chat bubble between them |
| `approval.requested` | Agent walks to center of room, amber ring, pauses |
| `execution.completed` | Green burst; agents do a small celebration; walk to break area |
| `execution.failed` | Red flash; agents droop, walk slowly to lounge |
| `execution.halted` | Amber ring; agents freeze mid-animation |
| `knowledge.ingested` | Small book/sparkle particle floats from agent to Memory Vault corner |

---

## 2. Technical Implementation

### Stack
- **Renderer:** [PixiJS v8](https://pixijs.com/) — GPU-accelerated 2D WebGL canvas, React-friendly via `@pixi/react`
- **State:** Zustand slice `useOfficeStore` — maps `agent_id → OfficeState { position, animation, currentExec, message }`
- **Data source:** Existing WebSocket connection (no new backend needed for phase 1)
- **Asset format:** PNG sprite sheets (individual frames packed via TexturePacker or free alternative)
- **Route:** `/dashboard/office` — new page, opt-in alongside existing dashboard

### Frontend file structure
```
frontend/src/
  app/dashboard/office/
    page.tsx              ← PixiJS canvas wrapper
    useOfficeStore.ts     ← Zustand state, WS event → animation mapping
    constants.ts          ← tile size, room layout, agent desk positions
  components/office/
    OfficeCanvas.tsx      ← main @pixi/react component
    AgentSprite.tsx       ← sprite + animation state machine
    DeskTile.tsx          ← desk + monitor + glow
    RoomLayout.tsx        ← floor, walls, static furniture
    SpeechBubble.tsx      ← floating text above agents
    MiniExecPanel.tsx     ← HUD overlay: current execution name, status pill
```

### Animation State Machine (per agent)
```
IDLE_LOUNGE
  → (execution assigned) → WALKING_TO_DESK
  → IDLE_DESK
    → (subtask starts) → WORKING (looping typing animation)
      → (tool call) → TOOL_ANIM (1.5s tool-specific anim)
      → back to WORKING
    → (peer consult) → CONSULTING (face peer, chat bubble)
    → (subtask done) → IDLE_DESK
  → (exec completes) → CELEBRATION → WALKING_TO_LOUNGE → IDLE_LOUNGE
  → (exec fails) → FAIL_ANIM → WALKING_TO_LOUNGE_SLOW → IDLE_LOUNGE
```

### Phase 1 — Functional skeleton (no custom assets yet)
Use placeholder colored squares + Tabler icons as "sprites" to build and test the full animation system before assets arrive. This validates the WS→animation pipeline.

### Phase 2 — Real assets
Drop generated PNG sheets in `frontend/public/assets/office/` and swap `PIXI.Graphics` placeholders for `PIXI.Sprite` with loaded textures. Zero logic change needed.

---

## 3. Asset Generation Workforce

### Objective
> Generate a complete set of pixel art / lo-fi 2D game assets for the AitherOS Virtual Office: character sprites (one per agent archetype), furniture, floor tiles, UI overlays, and ambient effects. Save PNGs to `workforces/{workforce_id}/workspace/assets/office/` and create a JSON manifest + KB entries for each asset.

### Why no custom MCP tool needed
Agents already have HTTP request capabilities via Aither-Tools. An image generation API (Stability AI, fal.ai, Replicate) is just a POST request with a JSON body that returns base64-encoded PNG. The agent:
1. Constructs the prompt
2. Calls `http_request` to the image gen endpoint
3. Decodes the base64 response
4. Calls `write_file` to save the PNG
5. Updates the manifest JSON

No MCP tool wrapper required — the existing tool set is sufficient.

### On OpenRouter + Image Generation
**Important note:** OpenRouter is an LLM text-completion proxy (OpenAI-compatible `/chat/completions` endpoint). It does **not** expose image generation output through this API format, even for models that natively support it (like Gemini 2.0 Flash's experimental image output). Gemini 2.0 Flash Lite specifically is the stripped-down text-optimized variant — image generation is not available on it.

For image generation, use one of these directly (not via OpenRouter):
- **Stability AI** (`https://api.stability.ai/v2beta/stable-image/generate/sd3`) — free tier 25 credits/day, excellent for pixel art with the right prompt
- **fal.ai** (`https://fal.run/fal-ai/fast-sdxl`) — very cheap (~$0.003/image), fast API
- **Replicate** (`https://api.replicate.com/v1/predictions`) — similar pricing, huge model selection
- **Hugging Face Inference API** — free tier available, `stabilityai/sdxl-turbo` or `stabilityai/stable-diffusion-xl-base-1.0`

Gemini 2.0 Flash *does* support image understanding (vision input) on OpenRouter — useful for the Art Director agent to review generated assets and request corrections.

### Agents

#### Agent 1: Art Director (use `nvidia/llama-3.1-nemotron-70b-instruct` or `google/gemini-2.0-flash-001`)
**Role:** Creative lead. Knows the full visual spec (palette, style, dimensions). Produces detailed, model-ready image generation prompts for each asset. Reviews generated assets via vision input and iterates if needed.

**Responsibilities:**
- Define the full asset list (see below)
- Write precise image generation prompts for each asset
- Specify exact pixel dimensions and frame layout for sprite sheets
- After generation: use vision to review each PNG, flag issues, write corrected prompts
- Write KB entries describing each asset (name, purpose, animation frames, usage context)

**System prompt snippet:**
```
You are the Art Director for AitherOS Virtual Office. You design 2D game assets in a
"cyberpunk lo-fi office" style: top-down view, 64×64px tiles, dark palette
(#0A0D11 backgrounds), neon accents matching #9A66FF purple, #14FFF7 cyan,
#56D090 green, #FFBF47 amber. Think Gather.town meets XCOM 2 base view.
Characters are 48×64px, 4 directional frames + working/idle/celebrate/fail states.
No bright whites, no anime style, no flat vector. Subtle scanline texture OK.
```

#### Agent 2: Asset Generator
**Role:** Calls the image generation API for each prompt the Art Director produces. Saves files, reports results.

**Responsibilities:**
- Read prompts from the Art Director's output
- Call image generation API via `http_request`
- Save base64-decoded PNG to filesystem via `write_file`
- Report file path and generation params back to Art Director

**Tools needed:** `http_request`, `write_file`, `read_file`

#### Agent 3: Cataloguer
**Role:** Produces the final JSON manifest and KB entries.

**Responsibilities:**
- Compile all generated assets into `manifest.json`
- For each asset: path, dimensions, animation frame count, intended usage, color tags
- Create KB entries in the AitherOS knowledge base for each asset category
- Write a `ASSETS.md` summary for developers integrating into PixiJS

### Full Asset List

#### Floor & Environment (static tiles, 64×64px)
| Asset | Description |
|---|---|
| `floor_dark.png` | Base dark floor tile, subtle grid lines, slight noise texture |
| `floor_carpet.png` | Soft carpet area (lounge zone), warm dark tone |
| `wall_horizontal.png` | Wall segment, dark concrete, faint neon strip at base |
| `wall_corner.png` | Corner piece |
| `window.png` | Night cityscape window, purple/cyan city lights outside |
| `plant_small.png` | Small plant in corner, subtle green accent |
| `server_rack.png` | Server rack with blinking LEDs, cyan glow |
| `whiteboard.png` | Whiteboard with faint writing, wall-mounted |
| `kanban_board.png` | Wall-mounted board with colored sticky notes |

#### Furniture (64×96px — desk+chair combined)
| Asset | Description |
|---|---|
| `desk_idle.png` | Desk with monitor off, dark screen, minimal glow |
| `desk_active_purple.png` | Desk with monitor on, purple glow (executing) |
| `desk_active_cyan.png` | Desk with monitor on, cyan glow (planning) |
| `desk_active_green.png` | Desk with monitor on, green glow (completed) |
| `desk_active_amber.png` | Desk with monitor on, amber glow (awaiting approval) |
| `lounge_chair.png` | Cozy chair for idle lounge area |
| `coffee_table.png` | Small table with coffee/tea items |
| `briefing_table.png` | Larger table for planning/briefing area |

#### Character Sprites (48×64px each frame, sprite sheet)
One sprite sheet per archetype. Each sheet: 4 direction columns × N state rows.

| Archetype | Description | States |
|---|---|---|
| `char_analyst.png` | Slim, glasses, dark hoodie, purple accent | idle, walk(4), work, think, celebrate, fail |
| `char_engineer.png` | Sturdy build, headset, cyan accent | idle, walk(4), work, think, celebrate, fail |
| `char_strategist.png` | Tall, formal, green accent | idle, walk(4), work, think, celebrate, fail |
| `char_researcher.png` | Casual, book/tablet, amber accent | idle, walk(4), work, think, celebrate, fail |
| `char_lead.png` | Distinctive silhouette, all-color accent aura | idle, walk(4), work, think, celebrate, fail |

#### UI / Overlays (transparent PNGs)
| Asset | Description |
|---|---|
| `bubble_think.png` | Thought bubble (3-dot animation implied, static base) |
| `bubble_speech.png` | Speech bubble with tail, dark bg, white text area |
| `bubble_consult.png` | Double-sided speech bubble for peer consultation |
| `ring_purple.png` | Glowing ring overlay for executing state |
| `ring_cyan.png` | Glowing ring overlay for planning state |
| `ring_amber.png` | Glowing ring overlay for approval-wait state |
| `sparkle_kb.png` | Small sparkle/book particle for knowledge ingestion |
| `icon_tool_search.png` | Mini icon shown during web_search tool calls |
| `icon_tool_file.png` | Mini icon shown during write_file tool calls |
| `icon_tool_code.png` | Mini icon shown during code execution tool calls |

### Strategy: `react` (ReAct loop)
The Art Director leads. Asset Generator and Cataloguer are subtasks the orchestrator assigns. Since asset generation requires review-iterate loops, ReAct is the right strategy over simple linear execution.

### Estimated Execution
- ~15–20 assets total
- ~3–4 image gen API calls per asset (prompt refinement cycle)
- Total: ~60 API calls, mostly cheap ($0.003–$0.01 each)
- Expected runtime: 20–40 minutes with Art Director review cycles

### Workforce Config (when creating in UI)
```
Name: Virtual Office Asset Team
Strategy: react
Time budget: 60 minutes
Token budget: 200,000
Agents: Art Director, Asset Generator, Cataloguer
MCP Servers: Aither-Tools (for http_request, write_file, read_file)
```

---

## 4. Integration Roadmap

### Phase 1: Skeleton (2–3 days, no generated assets)
- [ ] Add `/dashboard/office` route
- [ ] Install `@pixi/react` and `pixi.js`
- [ ] Build `RoomLayout` with colored-square placeholders
- [ ] Build `AgentSprite` state machine driven by `useOfficeStore`
- [ ] Wire `useOfficeStore` to the existing WebSocket hook
- [ ] Add "Office" nav item in sidebar (after existing items)

### Phase 2: Assets drop-in (after workforce run)
- [ ] Run asset generation workforce
- [ ] Copy PNGs from workspace to `frontend/public/assets/office/`
- [ ] Load textures in PixiJS, swap Graphics → Sprite
- [ ] Add sprite sheet animation controller (frame stepping)

### Phase 3: Polish
- [ ] Speech bubble system (truncated live message text)
- [ ] Mini HUD overlay (execution name + status pill on canvas)
- [ ] "Click agent to open execution detail" interaction
- [ ] Ambient: idle breathing animation, subtle monitor flicker
- [ ] Optional: ambient background music toggle (lo-fi playlist embed)

---

## 5. Open Questions
1. **Image gen API choice**: Need API key for one of: Stability AI, fal.ai, Replicate, or HuggingFace. Add as a credential in the workforce config.
2. **Sprite sheet format**: TexturePacker JSON atlas or simple row/column convention? Recommend row/col for simplicity since PixiJS handles both.
3. **Office as default or opt-in?**: Start opt-in (separate `/dashboard/office` route). Promote to default once it feels polished.
4. **Mobile**: Canvas scales down well; consider simplified top-down flat view for small screens.
