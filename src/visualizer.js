export const PALETTE = [
  ["#ff78ae", "#ffb7d3"], ["#a47aff", "#d4bbff"], ["#4bc9f6", "#a4eaff"],
  ["#36d9a0", "#acf0d9"], ["#ffa23f", "#ffd795"], ["#f66dc6", "#ffafe5"],
  ["#6a88fa", "#b4c1ff"], ["#ff7090", "#ffbdc8"], ["#ffab4f", "#ffdcac"],
  ["#23c4ae", "#a3eee2"], ["#efcf41", "#f9eba0"], ["#fb72aa", "#ffbad2"],
  ["#64bfff", "#b9e5ff"], ["#7ed353", "#c7efa7"], ["#be83ef", "#e4c7fb"],
];

export function createLayerStyle(index = 0) {
  const [primaryColor, secondaryColor] = PALETTE[index % PALETTE.length];
  return {
    noteAnimation: "bounce",
    playedNoteHighlight: "pulse",
    particleAnimation: "burst",
    colorMode: "gradient",
    primaryColor,
    secondaryColor,
    opacity: 1,
    octaveOffset: 0,
  };
}
export function backgroundImageRect(canvasWidth, canvasHeight, imageWidth, imageHeight, fit = "cover") {
  const targetWidth = Math.max(1, Number(canvasWidth) || 1);
  const targetHeight = Math.max(1, Number(canvasHeight) || 1);
  const sourceWidth = Math.max(1, Number(imageWidth) || 1);
  const sourceHeight = Math.max(1, Number(imageHeight) || 1);
  if (fit === "stretch") return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  const scale = fit === "contain"
    ? Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
    : Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}
function lowerBound(notes, tick) {
  let low = 0, high = notes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (notes[mid].at < tick) low = mid + 1;
    else high = mid;
  }
  return low;
}

function rounded(context, x, y, width, height, radius) {
  if (width <= 0 || height <= 0) return;
  context.beginPath();
  context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
  context.fill();
}

function diamond(context, x, y, size, color, opacity, filled = false) {
  context.save();
  context.globalAlpha = opacity;
  context.beginPath();
  context.moveTo(x, y - size);
  context.lineTo(x + size, y);
  context.lineTo(x, y + size);
  context.lineTo(x - size, y);
  context.closePath();
  if (filled) { context.fillStyle = color; context.fill(); }
  else { context.strokeStyle = color; context.lineWidth = Math.max(1.5, size * .2); context.stroke(); }
  context.restore();
}

function spark(context, x, y, radius, color, opacity) {
  context.save();
  context.globalAlpha = opacity;
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, radius * .16);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x - radius, y); context.lineTo(x + radius, y);
  context.moveTo(x, y - radius); context.lineTo(x, y + radius);
  context.stroke();
  context.restore();
}

function colorWithAlpha(color, opacity) {
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, "0");
  return /^#[\da-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

function mixHexColors(first, second, ratio = .5) {
  if (!/^#[\da-f]{6}$/i.test(first) || !/^#[\da-f]{6}$/i.test(second)) return first;
  const amount = Math.max(0, Math.min(1, ratio));
  const channels = [0, 2, 4].map(offset => {
    const left = Number.parseInt(first.slice(1 + offset, 3 + offset), 16);
    const right = Number.parseInt(second.slice(1 + offset, 3 + offset), 16);
    return Math.round(left + (right - left) * amount).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentageSetting(value, fallback, minimum, maximum) {
  const raw = Number(value);
  return clamp(Number.isFinite(raw) ? raw : fallback, minimum, maximum) / 100;
}

export class Visualizer {
  constructor(canvas, project, settings) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.project = project;
    this.settings = settings;
    this.patternColors = new Map(project.patterns.map((pattern, index) => [pattern.id, PALETTE[index % PALETTE.length]]));
    this.defaultLayerStyles = new Map(project.patterns.map((pattern, index) => [pattern.id, createLayerStyle(index)]));
    this.stepLanes = new Map();
  }

  isStep(note) {
    if (!this.settings.percussion) return false;
    const mode = this.settings.trackModes?.get(note.patternId);
    if (mode) return mode === "step";
    return note.channel >= 8 && note.channel !== 9;
  }

  pixelsPerTick(width = this.canvas.width) {
    const barsVisible = Math.max(1, Math.min(8, Number(this.settings.barsVisible) || 3));
    return width / (this.project.ppq * 4 * barsVisible);
  }

  refreshStepLanes() {
    this.stepLanes.clear();
    if (!this.settings.trackModes) return;
    for (const pattern of this.project.patterns) {
      if (this.settings.trackModes.get(pattern.id) === "step") this.stepLanes.set(pattern.id, this.stepLanes.size);
    }
  }

  noteY(note, height) {
    if (this.isStep(note)) {
      const lane = this.stepLanes.get(note.patternId) ?? Math.max(0, note.channel - 8);
      const laneCount = Math.max(1, this.stepLanes.size);
      const baseSpacing = Math.min(height * .0255, height * .17 / laneCount);
      const laneSpacing = baseSpacing * percentageSetting(this.settings.percussionVerticalZoom, 100, 50, 220);
      const baseCenter = height * .755 + (laneCount - 1) * baseSpacing / 2;
      const offset = percentageSetting(this.settings.percussionVerticalOffset, 0, -100, 100) * height * .4;
      const centeredLane = lane - (laneCount - 1) / 2;
      return clamp(baseCenter + centeredLane * laneSpacing - offset, height * .04, height * .96);
    }
    const style = this.layerStyle(note.patternId);
    const rawOctaveOffset = Number(style.octaveOffset ?? 0);
    const octaveOffset = Number.isFinite(rawOctaveOffset) ? Math.max(-4, Math.min(4, rawOctaveOffset)) : 0;
    const key = note.key + octaveOffset * 12;
    const top = height * .106;
    const bottom = height * .688;
    const mapped = bottom - (key - 37) / 59 * (bottom - top);
    const baseY = clamp(mapped + ((note.channel % 4) - 1.5) * height * .0029, height * .08, height * .731);
    const center = (top + bottom) / 2;
    const zoom = percentageSetting(this.settings.melodyVerticalZoom, 100, 50, 220);
    const offset = percentageSetting(this.settings.melodyVerticalOffset, 0, -100, 100) * height * .4;
    return clamp(center + (baseY - center) * zoom - offset, height * .04, height * .96);
  }

  layerStyle(patternId) {
    const fallback = this.defaultLayerStyles.get(patternId) || createLayerStyle(0);
    const configured = this.settings.layerStyles?.get(patternId);
    if (!configured) return fallback;
    return {
      ...fallback,
      ...configured,
      opacity: Math.max(0, Math.min(1, Number(configured.opacity ?? fallback.opacity))),
    };
  }

  shadowStyle() {
    const rawDepth = Number(this.settings.shadowDepth ?? 100);
    const rawOpacity = Number(this.settings.shadowOpacity ?? 28);
    return {
      color: /^#[\da-f]{6}$/i.test(this.settings.shadowColor) ? this.settings.shadowColor : "#142027",
      depth: Number.isFinite(rawDepth) ? clamp(rawDepth / 100, 0, 2) : 1,
      opacity: Number.isFinite(rawOpacity) ? clamp(rawOpacity / 100, 0, 1) : .28,
    };
  }

  layerDepthForIndex(index, count) {
    if (count <= 1) return .78;
    return 1 - clamp(index, 0, count - 1) / (count - 1);
  }

  layerSpeedForIndex(index, count) {
    if (this.settings.layerParallax === false) return 1;
    if (count <= 1) return 1;
    const rawStrength = Number(this.settings.parallaxStrength ?? 100);
    const strength = Number.isFinite(rawStrength) ? clamp(rawStrength / 100, 0, 1) : 1;
    const baseSpeed = .78 + this.layerDepthForIndex(index, count) * .44;
    return 1 + (baseSpeed - 1) * strength;
  }

  layerDepth(patternId, layerOrder = this.settings.layerOrder) {
    const order = layerOrder?.length ? layerOrder : this.project.patterns.map(pattern => pattern.id);
    const index = order.indexOf(patternId);
    return this.layerDepthForIndex(index < 0 ? order.length - 1 : index, Math.max(1, order.length));
  }

  layerSpeed(patternId, layerOrder = this.settings.layerOrder) {
    const order = layerOrder?.length ? layerOrder : this.project.patterns.map(pattern => pattern.id);
    const index = order.indexOf(patternId);
    return this.layerSpeedForIndex(index < 0 ? order.length - 1 : index, Math.max(1, order.length));
  }

  color(note) {
    const style = this.layerStyle(note.patternId);
    return style.colorMode === "solid" ? [style.primaryColor, style.primaryColor] : [style.primaryColor, style.secondaryColor];
  }

  noteMotion(note, tick, scale, style = this.layerStyle(note.patternId)) {
    if (!this.settings.effects || style.noteAnimation === "none") return { size: 0, offset: 0 };
    const hitAge = tick - note.at;
    if (hitAge < 0) return { size: 0, offset: 0 };
    const impact = Math.exp(-hitAge / (this.project.ppq * .19));
    if (style.noteAnimation === "pulse") return { size: impact * .72, offset: 0 };
    if (style.noteAnimation === "drop") {
      const noteDuration = Math.max(1, Number(note.length) || 1);
      const settleDuration = Math.min(noteDuration, this.project.ppq * .16);
      const distance = 22 * scale;
      if (hitAge <= noteDuration) {
        const progress = Math.min(1, hitAge / settleDuration);
        return { size: 0, offset: distance * (1 - Math.pow(1 - progress, 3)) };
      }
      const releaseDuration = this.project.ppq * .18;
      const releaseProgress = Math.min(1, (hitAge - noteDuration) / releaseDuration);
      return { size: 0, offset: distance * (1 - releaseProgress) };
    }
    if (style.noteAnimation === "wave") {
      return { size: impact * .2, offset: Math.sin(hitAge / this.project.ppq * Math.PI * 7.4) * impact * 18 * scale };
    }
    return { size: impact * (.66 + Math.abs(Math.sin(hitAge / this.project.ppq * Math.PI * 5.2)) * .34), offset: 0 };
  }

  noteHighlightOpacity(note, tick, style = this.layerStyle(note.patternId)) {
    if (tick < note.at || tick >= note.at + note.length || style.playedNoteHighlight === "none") return 0;
    if (style.playedNoteHighlight === "pulse") {
      const pulseDuration = this.project.ppq * .5;
      const progress = Math.min(1, (tick - note.at) / pulseDuration);
      if (progress >= 1) return 0;
      return Math.sin(progress * Math.PI) * .44;
    }
    return .28;
  }

  playheadStyle(width) {
    const thickness = Math.max(1, Math.min(12, Number(this.settings.playheadThickness) || 3));
    const color = /^#[\da-f]{6}$/i.test(this.settings.playheadColor) ? this.settings.playheadColor : "#ff9d45";
    const gradientStart = /^#[\da-f]{6}$/i.test(this.settings.playheadGradientStart) ? this.settings.playheadGradientStart : color;
    const gradientEnd = /^#[\da-f]{6}$/i.test(this.settings.playheadGradientEnd) ? this.settings.playheadGradientEnd : color;
    return {
      color,
      colorMode: this.settings.playheadColorMode === "gradient" ? "gradient" : "solid",
      gradientStart,
      gradientEnd,
      thickness: thickness * width / 1080,
      glow: Math.max(0, Math.min(1, Number(this.settings.playheadGlow ?? 55) / 100)),
      opacity: Math.max(.1, Math.min(1, Number(this.settings.playheadOpacity ?? 100) / 100)),
    };
  }

  playheadPosition(width, landscape = this.settings.framePreset === "landscape") {
    const rawOffset = Number(this.settings.playheadOffset ?? 0);
    const offset = Number.isFinite(rawOffset) ? Math.max(-100, Math.min(100, rawOffset)) : 0;
    const position = .5 + offset / 200;
    return width * Math.max(0, Math.min(1, position));
  }

  drawBackground() {
    const { canvas, context, settings } = this;
    const solid = /^#[\da-f]{6}$/i.test(settings.background) ? settings.background : "#ffffff";
    const mode = settings.backgroundMode ?? "solid";
    if (mode === "gradient") {
      const start = /^#[\da-f]{6}$/i.test(settings.backgroundGradientStart) ? settings.backgroundGradientStart : solid;
      const end = /^#[\da-f]{6}$/i.test(settings.backgroundGradientEnd) ? settings.backgroundGradientEnd : solid;
      const angle = ((Number(settings.backgroundGradientAngle) || 0) % 360) * Math.PI / 180;
      const length = Math.hypot(canvas.width, canvas.height) / 2;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const gradient = context.createLinearGradient(
        centerX - Math.cos(angle) * length,
        centerY - Math.sin(angle) * length,
        centerX + Math.cos(angle) * length,
        centerY + Math.sin(angle) * length,
      );
      gradient.addColorStop(0, start);
      gradient.addColorStop(1, end);
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }

    context.fillStyle = solid;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const image = mode === "image" ? settings.backgroundImage : null;
    if (!image || typeof context.drawImage !== "function") return;
    const rect = backgroundImageRect(canvas.width, canvas.height, image.width, image.height, settings.backgroundImageFit);
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  }

  drawPlayhead(width, height, hitX) {
    const context = this.context;
    const style = this.playheadStyle(width);
    const top = height * .06;
    const bottom = height * .94;
    const gradient = context.createLinearGradient(hitX, top, hitX, bottom);
    if (style.colorMode === "gradient") {
      const middle = mixHexColors(style.gradientStart, style.gradientEnd);
      gradient.addColorStop(0, colorWithAlpha(style.gradientStart, 0));
      gradient.addColorStop(.08, colorWithAlpha(style.gradientStart, .78));
      gradient.addColorStop(.5, colorWithAlpha(middle, 1));
      gradient.addColorStop(.92, colorWithAlpha(style.gradientEnd, .78));
      gradient.addColorStop(1, colorWithAlpha(style.gradientEnd, 0));
    } else {
      gradient.addColorStop(0, colorWithAlpha(style.color, 0));
      gradient.addColorStop(.08, colorWithAlpha(style.color, .78));
      gradient.addColorStop(.5, style.color);
      gradient.addColorStop(.92, colorWithAlpha(style.color, .78));
      gradient.addColorStop(1, colorWithAlpha(style.color, 0));
    }
    context.strokeStyle = gradient;
    context.lineCap = "round";
    if (style.glow > 0) {
      context.globalAlpha = style.opacity * style.glow * .34;
      context.lineWidth = style.thickness * (1 + style.glow * 5.2);
      context.beginPath(); context.moveTo(hitX, top); context.lineTo(hitX, bottom); context.stroke();
    }
    context.globalAlpha = style.opacity;
    context.lineWidth = style.thickness;
    context.beginPath(); context.moveTo(hitX, top); context.lineTo(hitX, bottom); context.stroke();
    context.globalAlpha = 1;
  }

  drawNote(note, tick, width, height, hitX, pixelsPerTick, depth = this.layerDepth(note.patternId), speed = this.layerSpeed(note.patternId)) {
    const context = this.context;
    const style = this.layerStyle(note.patternId);
    const [main, light] = this.color(note);
    const rawX = hitX + (note.at - tick) * pixelsPerTick * speed;
    const baseScale = width / 1080;
    const motion = this.noteMotion(note, tick, baseScale, style);
    const rawY = this.noteY(note, height) + motion.offset;
    const noteScale = Number(this.settings.noteSize ?? 100) / 100;
    const step = this.isStep(note);
    const noteWidth = Math.max((step ? 13 : 20) * baseScale * Math.sqrt(noteScale), note.length * pixelsPerTick);
    const x = rawX;
    const y = rawY;
    const scale = baseScale;
    const bounce = motion.size;
    const sounding = note.at <= tick && note.at + note.length > tick;
    const highlightOpacity = this.noteHighlightOpacity(note, tick, style);
    const fade = Math.min(1, Math.max(.18, 1 - Math.max(0, x - width * .78) / (width * .43)));
    const velocity = .72 + Math.min(note.velocity / 128, 1) * .24;

    if (step) {
      const baseSize = (note.channel === 8 ? 10 : note.channel === 10 ? 7 : 8.2) * scale * noteScale;
      const stepSize = baseSize * (1 + bounce * 1.05 + (sounding ? .13 : 0));
      let stepColor = main;
      if (style.colorMode === "gradient") {
        stepColor = context.createLinearGradient(x - stepSize, y, x + stepSize, y);
        stepColor.addColorStop(0, main);
        stepColor.addColorStop(1, light);
      }
      if (x + stepSize < -25 || x - stepSize > width + 30) return;
      if (this.settings.layerShadows !== false) {
        const shadow = this.shadowStyle();
        const extrusion = (3 + depth * 11) * baseScale * shadow.depth;
        if (extrusion > 0 && shadow.opacity > 0) {
          diamond(context, x + extrusion, y + extrusion * .72, stepSize, shadow.color, fade * velocity * style.opacity * shadow.opacity, true);
        }
      }
      diamond(context, x, y, stepSize, stepColor, fade * velocity * style.opacity, true);
      if (highlightOpacity > 0) diamond(context, x, y, stepSize * .58, "#ffffff", highlightOpacity * fade * style.opacity, true);
      return;
    }

    if (x + noteWidth < -25 || x > width + 30) return;
    const bass = note.channel === 7 || note.channel === 9;
    const baseHeight = (note.channel === 6 ? 15 : 19) * scale * noteScale;
    const noteHeight = baseHeight * (1 + bounce * (bass ? .35 : .56));
    const gradient = context.createLinearGradient(x, y, x + noteWidth, y);
    gradient.addColorStop(0, main); gradient.addColorStop(1, light);
    const alpha = fade * velocity * style.opacity;
    if (this.settings.layerShadows !== false) {
      const shadow = this.shadowStyle();
      const extrusion = (3 + depth * 11) * baseScale * shadow.depth;
      if (extrusion > 0 && shadow.opacity > 0) {
        context.globalAlpha = alpha * shadow.opacity;
        context.fillStyle = shadow.color;
        rounded(context, x + extrusion, y + extrusion * .72 - noteHeight / 2, noteWidth, noteHeight, 8 * scale);
      }
    }
    context.globalAlpha = alpha;
    context.fillStyle = gradient;
    rounded(context, x, y - noteHeight / 2, noteWidth, noteHeight, 8 * scale);
    if (highlightOpacity > 0) {
      context.globalAlpha = highlightOpacity * fade * style.opacity;
      context.fillStyle = "#ffffff";
      rounded(context, x, y - noteHeight / 2, noteWidth, noteHeight, 8 * scale);
      context.globalAlpha = Math.min(.72, highlightOpacity * 1.55) * fade * style.opacity;
      rounded(context, x + 2 * scale, y - noteHeight / 2 + 2 * scale, Math.max(1, noteWidth - 4 * scale), 2.1 * scale, scale);
    }
    context.globalAlpha = 1;
  }

  drawParticles(note, y, eased, fade, main, light, count, reach, hitX, scale, animation = "burst", opacity = 1) {
    if (animation === "none") return;
    const context = this.context;
    for (let particle = 0; particle < count; particle++) {
      let angle = note.key * 1.73 + note.channel * 2.19 + particle * 2.71;
      let distance = (11 + eased * (reach + particle % 3 * 11)) * scale;
      let x = hitX + Math.cos(angle) * distance;
      let py = y + Math.sin(angle) * distance - eased * (9 + particle % 3 * 5) * scale;
      if (animation === "float") {
        distance = (8 + particle % 3 * 7 + eased * 8) * scale;
        x = hitX + Math.cos(angle) * distance;
        py = y + Math.sin(angle) * 7 * scale - eased * (reach + particle % 3 * 12) * scale;
      } else if (animation === "orbit") {
        angle += eased * Math.PI * 2.3;
        distance = (13 + eased * reach * .58 + particle % 2 * 8) * scale;
        x = hitX + Math.cos(angle) * distance;
        py = y + Math.sin(angle) * distance;
      }
      const color = particle % 2 ? light : main;
      if (particle % 3 === 0) spark(context, x, py, (3.2 + particle % 2 * 2) * scale, color, fade * .8 * opacity);
      else {
        context.globalAlpha = fade * .8 * opacity;
        context.fillStyle = color;
        context.beginPath(); context.arc(x, py, (2.3 + particle % 3 * .95) * scale * (.48 + fade * .62), 0, Math.PI * 2); context.fill();
        context.globalAlpha = 1;
      }
    }
  }

  drawHit(note, tick, width, height, hitX) {
    const pulseLife = this.project.ppq * 1.04;
    const elapsed = tick - note.at;
    if (elapsed < 0 || elapsed > pulseLife) return;
    const context = this.context;
    const baseScale = width / 1080;
    const life = elapsed / pulseLife;
    const fade = Math.pow(1 - life, 1.35);
    const eased = 1 - Math.pow(1 - life, 3);
    const style = this.layerStyle(note.patternId);
    const [main, light] = this.color(note);
    const scale = baseScale;
    const y = this.noteY(note, height);

    context.globalAlpha = fade * fade * .24 * style.opacity;
    context.fillStyle = light;
    context.beginPath(); context.arc(hitX, y, (10 + eased * 17) * scale, 0, Math.PI * 2); context.fill();
    context.globalAlpha = 1;

    if (this.isStep(note)) {
      diamond(context, hitX, y, (12 + eased * 38) * scale, main, fade * .77 * style.opacity);
      diamond(context, hitX, y, (8 + eased * 24) * scale, light, fade * .66 * style.opacity);
      this.drawParticles(note, y, eased, fade, main, light, 4, 32, hitX, scale, style.particleAnimation, style.opacity);
    } else {
      context.globalAlpha = fade * .71 * style.opacity;
      context.strokeStyle = main;
      context.lineWidth = 2.7 * scale;
      context.beginPath(); context.arc(hitX, y, (10 + eased * 34) * scale, 0, Math.PI * 2); context.stroke();
      context.globalAlpha = fade * .51 * style.opacity;
      context.strokeStyle = light;
      context.lineWidth = 2 * scale;
      context.beginPath(); context.arc(hitX, y, (6 + eased * 21) * scale, 0, Math.PI * 2); context.stroke();
      context.globalAlpha = 1;
      this.drawParticles(note, y, eased, fade, main, light, 4, 37, hitX, scale, style.particleAnimation, style.opacity);
    }
  }

  draw(seconds) {
    const { canvas, context, project, settings } = this;
    const landscape = settings.framePreset === "landscape";
    const width = landscape ? canvas.height : canvas.width;
    const height = landscape ? canvas.width : canvas.height;
    const tick = seconds * project.ppq * project.tempo / 60;
    const hitX = this.playheadPosition(width, landscape);
    this.refreshStepLanes();
    const pixelsPerTick = this.pixelsPerTick(width);
    const shownBefore = Math.ceil((hitX + width * .11) / pixelsPerTick);
    const shownAfter = Math.ceil((width - hitX + width * .2) / pixelsPerTick);
    context.globalAlpha = 1;
    context.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBackground();
    context.save();
    if (landscape) context.setTransform(0, -1, 1, 0, 0, canvas.height);
    if (settings.playhead) this.drawPlayhead(width, height, hitX);

    const start = Math.max(0, lowerBound(project.notes, tick - shownBefore) - 160);
    const visible = [];
    for (let index = start; index < project.notes.length; index++) {
      const note = project.notes[index];
      if (note.at > tick + shownAfter) break;
      if (note.at + note.length < tick - shownBefore || !settings.enabledPatterns.has(note.patternId)) continue;
      visible.push(note);
    }
    const layerOrder = settings.layerOrder?.length ? settings.layerOrder : project.patterns.map(pattern => pattern.id);
    for (let index = layerOrder.length - 1; index >= 0; index--) {
      const depth = this.layerDepthForIndex(index, layerOrder.length);
      const speed = this.layerSpeedForIndex(index, layerOrder.length);
      for (const note of visible) if (note.patternId === layerOrder[index]) this.drawNote(note, tick, width, height, hitX, pixelsPerTick, depth, speed);
    }

    if (settings.effects) {
      const startHit = Math.max(0, lowerBound(project.notes, tick - project.ppq * 1.04) - 16);
      const activeHits = [];
      for (let index = startHit; index < project.notes.length; index++) {
        const note = project.notes[index];
        if (note.at > tick) break;
        if (settings.enabledPatterns.has(note.patternId)) activeHits.push(note);
      }
      for (let index = layerOrder.length - 1; index >= 0; index--) {
        for (const note of activeHits) if (note.patternId === layerOrder[index]) this.drawHit(note, tick, width, height, hitX);
      }
    }
    context.restore();
  }
}
