function hexChannels(color) {
  const value = color.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(value)) throw new TypeError(`Invalid hex color: ${color}`);
  return [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
}

export function lightenColor(color, ratio = .5) {
  if (!/^#[\da-f]{6}$/i.test(color ?? "")) return color;
  const amount = Math.max(0, Math.min(1, ratio));
  const channels = hexChannels(color).map(channel => Math.round(channel + (255 - channel) * amount));
  return `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function createColorRamp(startColor, endColor, count) {
  if (!Number.isInteger(count) || count < 1) return [];
  const start = hexChannels(startColor);
  const end = hexChannels(endColor);
  return Array.from({ length: count }, (_, index) => {
    const progress = count === 1 ? 0 : index / (count - 1);
    const channels = start.map((channel, channelIndex) => Math.round(channel + (end[channelIndex] - channel) * progress));
    return `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
  });
}
