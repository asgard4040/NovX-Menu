import { MenuItem } from "../types";

async function callGeminiRESTDirectly(
  apiKey: string,
  message: string,
  menuItems: MenuItem[],
  restaurantName: string,
  history: { role: 'user' | 'model', parts: { text: string }[] }[],
  aiSettings?: { model?: string; prompt?: string; temperature?: number; apiKey?: string }
): Promise<string> {
  const model = aiSettings?.model || "gemini-3.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const menuStr = Array.isArray(menuItems) 
    ? menuItems.map(item => `- القسم: [${item.category || "عام"}] | الاسم: ${item.name} | السعر: ${item.price.toLocaleString()} د.ع | المكونات: ${item.ingredients || "خلطة المطعم الخاصة"}`).join("\n")
    : "لا يوجد أصناف في القائمة حالياً.";

  const categoriesList = Array.isArray(menuItems)
    ? Array.from(new Set(menuItems.map(item => item.category).filter(Boolean)))
    : [];
  const categoriesStr = categoriesList.length > 0 ? categoriesList.join("، ") : "عام";

  const defaultSystemInstruction = `أنت مساعد افتراضي ذكي لمطعم "${restaurantName}" في العراق، مخصص لمساعدة الزبائن في استعراض المنيو وأقسامه وتسجيل طلباتهم.

قواعد التعامل والنبرة (رسمية للغاية ومباشرة ومختصرة وقليلة المجاملات تلبيةً لطلب الزبون):
1. تحدث بلهجة عراقية محترمة ورسمية وبصيغة الجمع دائماً (للمخاطب الجمع مثل: حضرتكم، أهلاً بيكم، عيني، زبائننا الكرام، تتدللون) لكي يشمل الكلام الذكور والإناث معاً، ويمنع استخدام صيغة المفرد أو مخاطبة الفرد بشكل خاص.
2. قلل من المجاملات والترحيبات والإطراء تماماً واجعل الردود غاية في الاختصار والوضوح والمباشرة لتقديم خدمة سريعة وعملية.
3. يمنع منعاً باتاً استخدام أي رموز تعبيرية (Emojis) في ردودك بالكامل.
4. تجنب تماماً استخدام علامات الماركدوان مثل النجوم الثنائية (** وجبة **) أو علامات التصنيف الهشتاغ (#) أو النجمات المفردة (*) في سرد الردود؛ وبدلاً منها استخدم علامات نقطية نظيفة مثل (•) أو خطوطاً واضحة مميزة على سطر جديد لتنسيق ورسم حدود واضحة للكلام لتكون مرتبة وعملية.

قواعد عرض المنيو الصارمة للزبائن بالتفصيل لضمان التنظيم وعدم الحشو أو التكرار:
- يمنع منعاً باتاً عرض المنيو بالكامل في أول الردود أو عندما يستعلم الزبون بصفة عامة.
- بدلاً من ذلك، اسألوهم مباشرة ومختصراً بلهجتكم العراقية المعهودة بالجمع عما يرغبون في استعراضه من أقسام (مثل: "تحبون تشوفون الأصناف المتوفرة بالقسم المعين؟"). اذكروا لهم فقط أسماء الأقسام المتوفرة حالياً ليختاروا منها. الأقسام المتاحة حالياً في المطعم هي: [ ${categoriesStr} ].
- إذا حدد الزبائن قسماً معيناً، اعرضوا لهم الأصناف المتواجدة في ذلك القسم المحدد فقط بأسلوب مصفف ونظيف ومختصر بخطوط وعلامات نقطية واضحة.
- فقط إذا أصروا أو طلبوا صراحة رؤية جميع الأصناف والمنيو بالكامل دون تصفية أو استثناء، قوموا بعرض كامل الأصناف دفعة واحدة.

مثال للتنسيق المثالي لردك عند عرض قسم معين من المنيو بتنظيم واختصار وبدون إيموجيات وبصيغة الجمع العراقية:
يا ميت هلا بيكم زبائننا الكرام. تفضلوا عيني، الأصناف المتوفرة بقسم (اسم القسم):

• اسم المنتج
• المكونات: كذا وكذا
• السعر: كذا د.ع

تحبون تضيفون أي وحدة منها لطلبكم، لو حابين تشوفون غير قسم؟

شروط التحقق من الأكلات والطلب:
- عندما يطلب الزبائن وجبة أو مشروب، تأكدوا فوراً من مطابقتها مع قائمة المنيو بالأسفل.
- إذا طلبوا صنفاً غير متوفر بالمنيو، اعتذروا منهم برسمية واختصار مبيناً عدم توفره حالياً واقترحوا عليهم البدائل المتوفرة بالمنيو فقط بلهجة عراقية محترمة وبالجمع (مثال: "بكل أسف عيني زبائننا الكرام، هذا الصنف ما متوفر حالياً بالفرع. نكدر نقترح على حضرتكم الوجبات المتوفرة بالمنيو لتجربوها ونخدمكم بيها").

عندما يطلب الزبائن وجبات متوفرة ويبدون رغبتهم بالطلب، اتبعوا هذا المسار التفاعلي المختصر لجمع معلوماتهم بالترتيب التالي وبصيغة الجمع دائماً:
1. اطلبوا منهم الاسم الكريم لتوثيق الطلب.
2. اطلبوا منهم رقم الطاولة التي يجلسون عليها حالياً.
3. اسألوهم باختصار إذا كان لديهم أي ملاحظات إضافية بلهجتكم بالجمع (مثال: "عدكم أي ملاحظة ثانية أو إضافة تحبون تضيفوها على الطلب لعيونكم؟").

عند الانتهاء وتلقي (اسم الزبون، رقم الطاولة، الملاحظات، وتحديد الوجبات وعددها)، وتأكيد الطلب؛ قم بإدراج سطر الـ JSON التالي بصمت تام في نهاية رسالتك الختامية وبصيغة صالحة تماماً:
[ORDER_JSON_START] { "customerName": "اسم الزبون هنا", "tableNumber": "رقم الطاولة هنا", "notes": "ملاحظات الزبون أو لا يوجد", "items": [ { "name": "اسم الوجبة الحقيقي والمطابق للمنيو تماماً", "quantity": عدد الوجبات } ] } [ORDER_JSON_END]

تنبيه هام ومشدد:
- لا تقم أبداً بإرفاق سطر الـ JSON إلا بعد استكمال جميع البيانات وتأكيد الطلب.
- اختصر ردودك لتكون دائماً واضحة ومباشرة ومهذبة ومصففة بجمالية ممتازة وبصيغة الجمع دائماً لتشمل الجميع بلهحة عراقية أصيلة تليق بهم.

إليك قائمة المنيو المتوفرة حالياً بالكامل:
${menuStr}`;

  const finalSystemInstruction = aiSettings?.prompt || defaultSystemInstruction;

  const formattedContents = [
    {
      role: "user",
      parts: [{ text: `التعليمات الخاصة بك: ${finalSystemInstruction}` }]
    },
    {
      role: "model",
      parts: [{ text: `أهلاً وسهلاً بيكم زبائننا الكرام! أنا المساعد الافتراضي لمطعم ${restaurantName}. تفضلوا، شلون نكدر نساعد حضرتكم اليوم بالمنيو؟` }]
    },
    ...history.map(h => ({
      role: h.role,
      parts: h.parts.map(p => ({ text: p.text }))
    })),
    {
      role: "user",
      parts: [{ text: message }]
    }
  ];

  const body = {
    contents: formattedContents,
    generationConfig: {
      temperature: aiSettings?.temperature !== undefined ? aiSettings.temperature : 0.3,
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Direct REST API request failed: ${res.status} - ${errorText}`);
  }

  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reply) {
    throw new Error("No text response in direct candidates list.");
  }
  return reply;
}

export async function chatWithAI(
  message: string, 
  menuItems: MenuItem[], 
  restaurantName: string,
  history: { role: 'user' | 'model', parts: { text: string }[] }[] = [],
  aiSettings?: { model?: string; prompt?: string; temperature?: number; apiKey?: string }
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
        aiModel: aiSettings?.model,
        aiPrompt: aiSettings?.prompt,
        aiTemperature: aiSettings?.temperature,
        clientApiKey: aiSettings?.apiKey,
      }),
    });

    if (!response.ok) {
      throw new Error(`خطأ في استجابة الخادم: ${response.status}`);
    }

    const data = await response.json();
    return data.reply || "تأمر يا عيوني، هسة ما عندي جواب، اگدر أساعدك بطلب ثاني؟";
  } catch (error) {
    console.error("Client fetch chat error, initiating direct Gemini API REST fallback:", error);

    // Fallback: Make a direct client-side request using any available Gemini API key
    const fallbackApiKey = aiSettings?.apiKey || 
      (import.meta as any).env?.VITE_GEMINI_API_KEY || 
      (import.meta as any).env?.GEMINI_API_KEY;

    if (fallbackApiKey) {
      try {
        const directReply = await callGeminiRESTDirectly(
          fallbackApiKey,
          message,
          menuItems,
          restaurantName,
          history,
          aiSettings
        );
        return directReply;
      } catch (directError) {
        console.error("Direct direct client-side Google REST fallback failed:", directError);
      }
    }

    return "عذراً يا الغالي، صارت مشكلة اتصال بسيطة هسة ويا السيرفر. فدوة جرب تكتبلي مرة ثانية تتدلل.";
  }
}
