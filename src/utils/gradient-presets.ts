export interface GradientPreset {
  id: string;
  label: string;
  value: string;
}

export const LIGHT_GRADIENTS: GradientPreset[] = [
  {
    id: "gradient-subtle",
    label: "Subtle Fade",
    value: "linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%)",
  },
  {
    id: "gradient-warm",
    label: "Warm Glow",
    value:
      "linear-gradient(135deg, #fff5f0 0%, #ffffff 50%, #f0f5ff 100%)",
  },
  {
    id: "gradient-paper",
    label: "Paper Texture",
    value:
      "linear-gradient(180deg, #fafafa 0%, #ffffff 50%, #f8f8f8 100%)",
  },
];

export const DARK_GRADIENTS: GradientPreset[] = [
  {
    id: "gradient-subtle",
    label: "Subtle Depth",
    value: "linear-gradient(180deg, #1a1a1a 0%, #0f0f0f 100%)",
  },
  {
    id: "gradient-midnight",
    label: "Midnight Blue",
    value:
      "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f1e 100%)",
  },
  {
    id: "gradient-canvas",
    label: "Dark Canvas",
    value:
      "linear-gradient(180deg, #181818 0%, #1a1a1a 50%, #121212 100%)",
  },
];

export function parseBackgroundValue(
  value: string
): { type: "color" | "gradient" | "custom"; value: string } {
  if (
    value.startsWith("linear-gradient") ||
    value.startsWith("radial-gradient")
  ) {
    // Check if it's a known preset
    const isLightPreset = LIGHT_GRADIENTS.some((g) => g.value === value);
    const isDarkPreset = DARK_GRADIENTS.some((g) => g.value === value);

    return {
      type: isLightPreset || isDarkPreset ? "gradient" : "custom",
      value,
    };
  }

  return { type: "color", value };
}

export function getGradientPresetId(value: string): string | null {
  const preset = [...LIGHT_GRADIENTS, ...DARK_GRADIENTS].find(
    (g) => g.value === value
  );
  return preset?.id || null;
}
