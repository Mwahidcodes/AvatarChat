// Visual effects only. This file never touches the app's logic.
// It draws: the rotating cube emblems, button ripples, the glass-button
// particle burst and the mouse spotlight on panels.
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The mouse position, used to tilt the cube slightly
  const pointer = { x: -9999, y: -9999 };
  window.addEventListener("pointermove", (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  }, { passive: true });
  window.addEventListener("pointerleave", () => { pointer.x = pointer.y = -9999; });

  // ---------- 1. Rotating wireframe cube emblems ----------
  const emblems = Array.from(document.querySelectorAll("canvas.emblem"));

  // A cube is 8 corner points (each coordinate is -1 or +1)
  const corners = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    corners.push([x, y, z]);
  }
  // ...and 12 edges: two corners are joined when they differ in exactly one coordinate
  const edges = [];
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      let differences = 0;
      for (let k = 0; k < 3; k++) if (corners[i][k] !== corners[j][k]) differences++;
      if (differences === 1) edges.push([i, j]);
    }
  }

  // Turn a 3D point into a 2D screen point
  function project(point, scale, angleX, angleY, size, cx, cy) {
    const x = point[0] * scale;
    const y = point[1] * scale;
    const z = point[2] * scale;

    // Rotate around the vertical axis...
    const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;

    // ...then around the horizontal axis
    const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
    const y1 = y * cosX - z1 * sinX;
    const z2 = y * sinX + z1 * cosX;

    // Perspective: points further away look smaller
    const perspective = 4 / (4 + z2);
    return { x: cx + x1 * perspective * size, y: cy + y1 * perspective * size, z: z2 };
  }

  // Draw one cube with all its edges and corner dots
  function drawCube(ctx, scale, angleX, angleY, size, center, lineColor, dotColor, strength) {
    const points = corners.map((c) => project(c, scale, angleX, angleY, size, center, center));

    edges.forEach(([a, b]) => {
      const depth = (points[a].z + points[b].z) / 2;                        // about -1.4 .. +1.4
      const alpha = (0.4 + 0.6 * (1 - (depth + 1.4) / 2.8)) * strength;     // nearer = stronger
      ctx.strokeStyle = `rgba(${lineColor}, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(points[a].x, points[a].y);
      ctx.lineTo(points[b].x, points[b].y);
      ctx.stroke();
    });

    points.forEach((p) => {
      ctx.fillStyle = `rgba(${dotColor}, ${0.95 * strength})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.4 * (ctx.canvas._dpr || 1), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawEmblems(time) {
    emblems.forEach((canvas) => {
      const cssSize = canvas.clientWidth;
      if (!cssSize) return;                                     // hidden: skip

      // Match the canvas to its on-screen size (sharp on high-density screens)
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pixels = Math.round(cssSize * dpr);
      if (canvas.width !== pixels) {
        canvas.width = pixels;
        canvas.height = pixels;
      }
      canvas._dpr = dpr;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, pixels, pixels);
      ctx.lineWidth = Math.max(1.1, cssSize / 52) * dpr;
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(124, 108, 255, 0.55)";
      ctx.shadowBlur = (cssSize / 14) * dpr;

      // Slow spin, plus a gentle tilt toward the mouse
      const rect = canvas.getBoundingClientRect();
      const mouseX = pointer.x > -9000 ? (pointer.x - (rect.left + rect.width / 2)) / window.innerWidth : 0;
      const mouseY = pointer.y > -9000 ? (pointer.y - (rect.top + rect.height / 2)) / window.innerHeight : 0;
      const angleY = time * 0.0006 + mouseX * 0.8;
      const angleX = 0.55 + Math.sin(time * 0.0004) * 0.3 + mouseY * 0.8;

      const size = pixels * 0.2;
      const center = pixels / 2;

      // Outer cube (indigo) and a smaller inner cube (blue) turning the other way
      drawCube(ctx, 1.0, angleX, angleY, size, center, "79, 70, 229", "67, 56, 202", 1);
      drawCube(ctx, 0.48, -angleX * 0.7, -angleY * 1.3, size, center, "79, 124, 255", "79, 124, 255", 0.7);
    });
  }

  // ---------- Animation loop ----------
  let frameId = 0;

  function frame(time) {
    drawEmblems(time);
    frameId = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(frame);
  }

  if (reduceMotion) {
    // No movement: just draw still images, refreshed a few times per second
    drawEmblems(0);
    setInterval(() => drawEmblems(0), 500);
  } else {
    start();
    // Save battery: stop drawing when the tab is hidden
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelAnimationFrame(frameId);
      else start();
    });
  }

  // ---------- 2. Ripple on button clicks (not on the glass AI button) ----------
  document.addEventListener("pointerdown", (event) => {
    if (reduceMotion) return;
    const button = event.target.closest("button");
    if (!button || button.disabled || button.classList.contains("glass-ai")) return;

    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);

    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;

    button.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  });

  // ---------- 3. Particle burst when the glass AI button is activated ----------
  function burst(x, y) {
    const count = 18;
    for (let i = 0; i < count; i++) {
      const spark = document.createElement("span");
      spark.className = "spark";
      spark.style.left = `${x}px`;
      spark.style.top = `${y}px`;
      document.body.appendChild(spark);

      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const distance = 45 + Math.random() * 60;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;

      const animation = spark.animate(
        [
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0)`, opacity: 0 },
        ],
        { duration: 600 + Math.random() * 400, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
      );
      animation.onfinish = () => spark.remove();
    }
  }

  document.addEventListener("click", (event) => {
    if (reduceMotion) return;
    const button = event.target.closest(".glass-ai");
    if (!button || button.disabled) return;

    const rect = button.getBoundingClientRect();
    // A keyboard press has no mouse position, so burst from the button's center
    const fromKeyboard = event.detail === 0;
    burst(
      fromKeyboard ? rect.left + rect.width / 2 : event.clientX,
      fromKeyboard ? rect.top + rect.height / 2 : event.clientY
    );
  });

  // ---------- 4. Soft light that follows the mouse on glass panels ----------
  document.addEventListener("pointermove", (event) => {
    const panel = event.target.closest(".card, .feedback");
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    panel.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    panel.style.setProperty("--my", `${event.clientY - rect.top}px`);
  }, { passive: true });
})();