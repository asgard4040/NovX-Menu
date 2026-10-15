import { MenuItem } from "../types";

export async function chatWithAI(
  message: string,
  menuItems: MenuItem[],
  restaurantName: string,
  restaurantId: string,
  history: { role: "user" | "model"; parts: { text: string }[] }[] = [],
  aiSettings?: { model?: string; prompt?: string; temperature?: number },
  language: "ar" | "en" = "ar",
): Promise<string> {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message, restaurantId, history, language,
      }),
    });
    if (!response.ok) throw new Error(`AI server response: ${response.status}`);
    const data = await response.json();
    return data.reply || (language === "en" ? "I don't have an answer right now. Can I help with something else?" : "تأمر يا عيوني، هسة ما عندي جواب، اگدر أساعدك بطلب ثاني؟");
  } catch (error) {
    console.error("Server-side AI request failed:", error);
    return language === "en" ? "Sorry, there was a connection problem. Please try again." : "عذراً يا الغالي، صارت مشكلة اتصال بسيطة هسة ويا السيرفر. فدوة جرب تكتبلي مرة ثانية تتدلل.";
  }
}
