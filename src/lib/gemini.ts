import { MenuItem } from "../types";

export async function chatWithAI(
  message: string, 
  menuItems: MenuItem[], 
  restaurantName: string,
  history: { role: 'user' | 'model', parts: { text: string }[] }[] = []
): Promise<string> {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        menuItems,
        restaurantName,
        history,
      }),
    });

    if (!response.ok) {
      throw new Error(`خطأ في استجابة الخادم: ${response.status}`);
    }

    const data = await response.json();
    return data.reply || "تأمر يا عيوني، هسة ما عندي جواب، اگدر أساعدك بطلب ثاني؟";
  } catch (error) {
    console.error("Client fetch chat error:", error);
    return "عذراً يا الغالي، صارت مشكلة اتصال بسيطة هسة ويا السيرفر. فدوة جرب تكتبلي مرة ثانية تتدلل.";
  }
}
