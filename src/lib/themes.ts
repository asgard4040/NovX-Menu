import type { CSSProperties } from "react";

export type ThemeId = "ordova" | "italian-luxury" | "urban-modern" | "pure-minimal" | "fast-bite" | "heritage" | "cafe" | "botanical" | "midnight" | "coastal";
export type ThemeColors = { primary: string; secondary: string; accent: string; background: string; text: string };
export type MenuTheme = { id: ThemeId; name: string; nameEn: string; description: string; descriptionEn: string; colors: ThemeColors };

export const MENU_THEMES: MenuTheme[] = [
  { id: "ordova", name: "أوردوفا", nameEn: "Ordova", description: "هوية حديثة بكحلي عميق وبرتقالي دافئ", descriptionEn: "Deep navy, warm orange, and clean modern typography", colors: { primary: "#081220", secondary: "#183246", accent: "#C84C29", background: "#F8F8F6", text: "#0B1822" } },
  { id: "italian-luxury", name: "الفخامة الإيطالية", nameEn: "Italian Luxury", description: "تحريرية دافئة، حواف دقيقة وعناوين كلاسيكية", descriptionEn: "Warm editorial styling with refined classical details", colors: { primary: "#2D3A27", secondary: "#4A5D43", accent: "#B19470", background: "#FCFBF7", text: "#1C1C1C" } },
  { id: "urban-modern", name: "مودرن حضري", nameEn: "Urban Modern", description: "شبكة جريئة، زوايا حادة وطباعة هندسية", descriptionEn: "Bold grid, sharp edges, and geometric typography", colors: { primary: "#172554", secondary: "#2563EB", accent: "#22D3EE", background: "#F8FAFC", text: "#0F172A" } },
  { id: "pure-minimal", name: "مينيمال نقي", nameEn: "Pure Minimal", description: "مساحات بيضاء واسعة وبطاقات هادئة", descriptionEn: "Open space and calm, clean cards", colors: { primary: "#18181B", secondary: "#52525B", accent: "#A1A1AA", background: "#FFFFFF", text: "#18181B" } },
  { id: "fast-bite", name: "فاست فود", nameEn: "Fast Bite", description: "حيوية، أزرار ممتلئة وبطاقات مرحة", descriptionEn: "Energetic controls and playful cards", colors: { primary: "#B91C1C", secondary: "#EA580C", accent: "#FACC15", background: "#FFF7ED", text: "#431407" } },
  { id: "heritage", name: "تراثي", nameEn: "Heritage", description: "نقوش دافئة وإيقاع مستوحى من الضيافة", descriptionEn: "Warm patterns inspired by traditional hospitality", colors: { primary: "#713F12", secondary: "#92400E", accent: "#D6A85F", background: "#FFFBEB", text: "#3F2A14" } },
  { id: "cafe", name: "مقهى", nameEn: "Café", description: "دفء الورق، حواف لينة وطابع حميم", descriptionEn: "Warm paper tones and soft, intimate details", colors: { primary: "#4E342E", secondary: "#795548", accent: "#C08B5C", background: "#FAF3E8", text: "#33241F" } },
  { id: "botanical", name: "طبيعي", nameEn: "Botanical", description: "عضوي، مستدير ومناسب للمطاعم الصحية", descriptionEn: "Organic shapes for fresh and healthy restaurants", colors: { primary: "#166534", secondary: "#4D7C0F", accent: "#84CC16", background: "#F7FEE7", text: "#14321D" } },
  { id: "midnight", name: "ليلي داكن", nameEn: "Midnight", description: "تباين عالٍ ولمسات مضيئة راقية", descriptionEn: "High contrast with refined luminous accents", colors: { primary: "#334155", secondary: "#475569", accent: "#F59E0B", background: "#0F172A", text: "#F8FAFC" } },
  { id: "coastal", name: "ساحلي", nameEn: "Coastal", description: "هواء خفيف، موجات ناعمة وألوان بحرية", descriptionEn: "Light, airy forms with coastal colors", colors: { primary: "#155E75", secondary: "#0891B2", accent: "#F97316", background: "#ECFEFF", text: "#164E63" } },
];

export const DEFAULT_THEME = MENU_THEMES[0];

export function resolveTheme(id?: string, overrides?: Partial<ThemeColors>) {
  const base = MENU_THEMES.find((theme) => theme.id === id) || DEFAULT_THEME;
  return { ...base, colors: { ...base.colors, ...overrides } };
}

export function themeStyle(theme: MenuTheme): CSSProperties {
  return {
    "--color-brand-primary": theme.colors.primary,
    "--color-brand-secondary": theme.colors.secondary,
    "--color-brand-gold": theme.colors.accent,
    "--color-bg-paper": theme.colors.background,
    "--color-bg-card": `color-mix(in srgb, ${theme.colors.background}, ${theme.colors.text} 5%)`,
    "--color-text-main": theme.colors.text,
    "--color-text-muted": `color-mix(in srgb, ${theme.colors.text}, transparent 32%)`,
    "--color-border-delicate": `color-mix(in srgb, ${theme.colors.text}, transparent 82%)`,
  } as CSSProperties;
}

export function contrastRatio(first: string, second: string) {
  const luminance = (hex: string) => {
    const normalized = hex.replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return 0;
    const channels = [0, 2, 4].map((index) => parseInt(normalized.slice(index, index + 2), 16) / 255)
      .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
