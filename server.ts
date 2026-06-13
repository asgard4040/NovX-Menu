import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Standard initialization of GoogleGenAI using standard variables
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey 
  ? new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for AI Chat Assistant
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, menuItems, restaurantName, history } = req.body;

      if (!message) {
        return res.status(400).json({ error: "الرجاء إرسال نص رسالة صالح." });
      }

      const activeApiKey = process.env.GEMINI_API_KEY;
      if (!activeApiKey) {
        console.error("Gemini API key is not configured.");
        return res.json({
          reply: "عذراً! يبدو أن بوابة المساعد الذكي غير مكونة بمفتاح خادم (GEMINI_API_KEY) حالياً. يرجى تفقد لوحة التحكم لتفعيل خدمات الذكاء الاصطناعي.",
        });
      }

      // Initialize client if not done yet
      const activeAiClient = ai || new GoogleGenAI({ 
        apiKey: activeApiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const menuStr = Array.isArray(menuItems) 
        ? menuItems.map(item => `- القسم: [${item.category || "عام"}] | الاسم: ${item.name} | السعر: ${item.price.toLocaleString()} د.ع | المكونات: ${item.ingredients || "خلطة المطعم الخاصة"}`).join("\n")
        : "لا يوجد أصناف في القائمة حالياً.";

      const categoriesList = Array.isArray(menuItems)
        ? Array.from(new Set(menuItems.map(item => item.category).filter(Boolean)))
        : [];
      const categoriesStr = categoriesList.length > 0 ? categoriesList.join("، ") : "عام";
      const systemInstruction = `أنت مساعد افتراضي ذكي لمطعم "${restaurantName}" في العراق، مخصص لمساعدة الزبائن في استعراض المنيو وأقسامه وتسجيل طلباتهم.

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

      const formattedHistory = (history || [])
        .filter((h: any) => (h.role === "user" || h.role === "model") && h.parts && h.parts.length > 0)
        .map((h: any) => ({
          role: h.role as "user" | "model",
          parts: h.parts.map((p: any) => ({ text: p.text })),
        }));

      // Use the standard high-performance gemini-3.5-flash as designated by guidelines
      const response = await activeAiClient.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          { role: "user", parts: [{ text: `التعليمات الخاصة بك: ${systemInstruction}` }] },
          { role: "model", parts: [{ text: `أهلاً وسهلاً بيكم زبائننا الكرام! أنا المساعد الافتراضي لمطعم ${restaurantName}. تفضلوا، شلون نكدر نساعد حضرتكم اليوم بالمنيو؟` }] },
          ...formattedHistory,
          { role: "user", parts: [{ text: message }] }
        ],
        config: {
          temperature: 0.3,
        },
      });

      const reply = response.text || "تأمرون عيني، لا تتوفر إجابة حالياً. هل تحتاجون شيئاً آخر من المنيو؟";
      return res.json({ reply });
    } catch (error: any) {
      console.error("Gemini API server-side execution error:", error);
      const errorMsg = error?.message || "";
      if (errorMsg.includes("API key not valid") || errorMsg.includes("400") || errorMsg.includes("key")) {
        return res.json({
          reply: "عذراً من حضرتكم، يبدو أن مفتاح بوابة المساعد الذكي غير صالح حالياً. يرجى مراجعة إدارة المعمل والمطعم.",
        });
      }
      return res.json({
        reply: "تأمرون عيني، حدثت مشكلة اتصال بسيطة بالشبكة حالياً. يرجى إعادة إرسال رسالتكم لتنبيهنا، تتدللون.",
      });
    }
  });


  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware setup for full-stack SPA serving
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running beautifully on http://localhost:${PORT}`);
  });
}

startServer();
