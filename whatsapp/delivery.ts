import { randomUUID } from "node:crypto";
import { agentText, confirmationCode, publicText, type CartItem, type Locale, type Price, type Reply, type Settings } from "./agent";
import { normalizeMessage } from "./policy";
import { phoneCandidates } from "./delivery-data";
import { result, type Conversation, type Db, type Job } from "./worker";

const say = (locale: Locale, ar: string, en: string) => locale === "ar" ? ar : en;
const amount = (n: number, l: Locale) => Number(n).toLocaleString("en-IQ", {maximumFractionDigits:2})+say(l," د.ع"," IQD");
const normalized = (text: string) => normalizeMessage(text).replace(/[،,.!؟?]/g," ").replace(/\s+/g," ").trim();

export function deliveryPhonePatch(text: string, awaiting?: string): { mode: string | null; raw: string | null } {
  const t=normalized(text),numbers=phoneCandidates(text);
  if (/(?:^|\s)(?:لا|مو|ما اريد|مااريد|do not|don't|not)\s.{0,30}(?:رقم|نفس|phone|number|same|\d{4})/i.test(t)) return {mode:null,raw:null};
  const explicit=/(?:رقم|phone|number|contact|اتصل)/i.test(t) || ["phone_choice","alternative_phone"].includes(awaiting || "") ||
    text.split(/\r?\n/).some(line => !!phoneCandidates(line).find(n => n.phone && n.raw === line.trim()));
  if (explicit && numbers.length) return { mode:"provided",raw:numbers.length===1?numbers[0].raw:text };
  if (/نفس (?:رقم|الرقم)|على رقمي|same (?:number|phone)|whatsapp number/i.test(t)) return {mode:"whatsapp",raw:null};
  if (/رقم (?:ثاني|اخر|غير)|another (?:number|phone)|different (?:number|phone)/i.test(t)) return {mode:"alternative",raw:null};
  if (awaiting==="alternative_phone" && /^[+0-9٠-٩۰-۹ ()-]{3,80}$/.test(text.trim())) return {mode:"provided",raw:text.trim()};
  return {mode:null,raw:null};
}
export function isDeliveryConfirmation(job: Job,c: Conversation) {
  if (!c.quote_id || !c.delivery_state?.awaitingConfirmation) return false;
  if (job.kind==="button") return job.payload.button==="confirm:"+c.quote_id;
  const t=normalized(job.payload.text || "");
  return ["اي","اي ثبت","ثبت","ثبت الطلب","نعم","yes","yes confirm","confirm","confirm my order",
    "confirm "+confirmationCode(c.quote_id),"ثبت "+confirmationCode(c.quote_id)].includes(t);
}
export function deliveryQuote(price: Price & {delivery_fee:number;address:{details:string;city:string;area:string};contact_phone:string;phone_source:string},locale:Locale) {
  const id=randomUUID();
  const lines=price.items.map(item=>item.quantity+" × "+publicText(item.name).slice(0,200).replace(/[\uD800-\uDBFF]$/,"")+
    (item.cheeseSelected?say(locale," + جبن"," + cheese"):"")+(item.spicySelected?say(locale," + حار"," + spicy"):"")+": "+amount(item.price*item.quantity,locale));
  const reply:Reply={text:[say(locale,"ملخص طلب التوصيل:","Delivery order summary:"),...lines,
    say(locale,"التوصيل: ","Delivery: ")+amount(price.delivery_fee,locale),say(locale,"المجموع: ","Total: ")+amount(price.total,locale),
    say(locale,"العنوان: ","Address: ")+price.address.details,
    say(locale,"رقم التوصيل: ","Delivery contact: ")+(price.phone_source==="whatsapp"?say(locale,"نفس رقم الواتساب","same WhatsApp number"):price.contact_phone),
    say(locale,"أثبت الطلب؟ اضغط الزر أو اكتب ثبت ","Confirm the order? Tap the button or type confirm ")+confirmationCode(id)].join("\n"),
    button:"confirm:"+id,title:say(locale,"تأكيد الطلب","Confirm order")};
  return {id,reply};
}
async function complete(db:Db,job:Job,locale:Locale,action:string,reply?:Reply,quoteId?:string,price?:object) {
  return result(await db.rpc("whatsapp_complete",{p_job:job.id,p_lease:job.lease,p_locale:locale,p_action:action,
    p_draft:null,p_quote_id:quoteId??null,p_quote:price??null,p_reply:reply??null}));
}
export async function progressDelivery(db:Db,job:Job,c:Conversation,settings:Settings,locale:Locale,items?:CartItem[],address?:string,prefix="") {
  const phone=deliveryPhonePatch(job.payload.text || "",c.delivery_state?.awaitingField);
  const step=result(await db.rpc("whatsapp_delivery_update",{p_job:job.id,p_lease:job.lease,p_items:items??null,
    p_address:address??null,p_phone_mode:phone.mode,p_phone_text:phone.raw}));
  let text:string;
  switch(step.next) {
    case "confirmation": {
      const quote=deliveryQuote(step.price,locale);
      quote.reply.text=prefix+quote.reply.text;
      const state=await complete(db,job,locale,"delivery_quote",quote.reply,quote.id,step.price);
      if (state==="ordering_closed") await complete(db,job,locale,"reply",{text:agentText.closed(locale)});
      else if(state==="quote_changed") await complete(db,job,locale,"reply",{text:agentText.changed(locale)});
      return;
    }
    case "items": text=say(locale,"شنو تحب تطلب للتوصيل؟","What would you like to order for delivery?");break;
    case "address": text=say(locale,"تمام، وين عنوان التوصيل؟ المنطقة وأقرب نقطة دالة إذا ممكن.","What is the delivery address? Please include the area and a nearby landmark.");break;
    case "address_details": text=say(locale,"شنو الشارع أو أقرب نقطة دالة للعنوان؟","What street or nearby landmark should we use?");break;
    case "phone_choice": text=step.sender_available
      ? say(locale,"نثبت الطلب على نفس رقم الواتساب اللي تراسلنا منه، لو تريد رقم ثاني؟","Use the WhatsApp number you are messaging from, or a different delivery number?")
      : say(locale,"واتساب ما شارك رقمك ويانه. دزلي رقم الهاتف اللي تريد نعتمده للتوصيل.","WhatsApp has not shared your phone number. Please send the delivery contact number.");break;
    case "alternative_phone": text=!step.sender_available && phone.mode==="whatsapp"
      ? say(locale,"واتساب ما شارك رقمك ويانه. دزلي رقم الهاتف اللي تريد نعتمده للتوصيل.","WhatsApp has not shared your number. Please type the delivery contact number.")
      : step.state?.phoneError
      ? say(locale,"ما قدرت أعتمد الرقم. دز رقم موبايل صحيح، مثل 07XXXXXXXXX، أو رقم دولي مع رمز البلد.","Please send a valid mobile number, such as 07XXXXXXXXX, or an international number with country code.")
      : say(locale,"تمام، دزلي رقم الهاتف اللي تريد نعتمده للتوصيل.","Please send the phone number to use for delivery.");break;
    case "items_changed": text=agentText.changed(locale);break;
    case "coverage": text=say(locale,"ما قدرت أأكد تغطية التوصيل ورسومه لهالعنوان. اكتب المدينة والمنطقة بوضوح أو تواصل ويا موظف المطعم.","I could not verify delivery coverage and fees for that address. Please specify the city and area or contact restaurant staff.");break;
    case "disabled": text=say(locale,"طلب التوصيل مو مفعّل هنا حالياً. تواصل ويا المطعم حتى يساعدوك.","Delivery ordering is not enabled here. Please contact the restaurant.");break;
    case "lease_lost": return;
    default: text=say(locale,"ما قدرت أعتمد هالتفصيل. ممكن تكتبه بشكل أوضح؟","I could not verify that detail. Could you clarify it?");
  }
  await complete(db,job,locale,"reply",{text});
}
export async function deliveryControl(db:Db,job:Job,c:Conversation,settings:Settings,locale:Locale):Promise<boolean> {
  const active=c.delivery_state?.fulfillment==="delivery";
  const text=job.payload.text || "",t=normalized(text);
  const reply=(body:string,action="reply",draft?:CartItem[]) => resultPromise(body,action,draft);
  async function resultPromise(body:string,action:string,draft?:CartItem[]) {
    return result(await db.rpc("whatsapp_complete",{p_job:job.id,p_lease:job.lease,p_locale:locale,p_action:action,
      p_draft:draft??null,p_quote_id:null,p_quote:null,p_reply:{text:body}}));
  }
  if (settings.delivery_enabled && /توصيل|توصلون|deliver/i.test(t) && /اكو|عندكم|متوفر|تاكد|توصلون|do you|available|\?/.test(t)) {
    const zones=(settings.delivery_zones||[]).filter(zone=>{
      const area=normalized(zone.area);
      return [area,"ل"+area,area.replace(/^ال/,"لل")].some(name=>(" "+t+" ").includes(" "+name+" "));
    });
    const selected=zones.length>1?zones.filter(zone=>t.includes(normalized(zone.city))):zones;
    if(selected.length===1) {
      const zone=selected[0];
      await reply(say(locale,"إي، ","Yes, ")+publicText(zone.area)+say(locale," ضمن تغطية التوصيل. الرسوم: "," is covered for delivery. Fee: ")+amount(zone.fee,locale));return true;
    }
  }
  if (settings.delivery_enabled && /^(?:اريد اطلب(?: توصيل)?|اريد طلب توصيل|اطلب توصيل|i want to order(?: delivery)?|delivery please)$/.test(t)) {
    const stale=!c.processed_at || Date.parse(job.occurred_at)-Date.parse(c.processed_at)>30*60_000 || !!c.delivery_state?.confirmedOrderId;
    if (!c.draft.length || stale) {
      await reply(say(locale,"شنو تحب تطلب للتوصيل؟","What would you like to order for delivery?"),"reset_quote",[]);return true;
    }
    const price=result(await db.rpc("whatsapp_price",{p_restaurant:job.restaurant_id,p_items:c.draft}));
    await reply(price?.items?.length ? say(locale,"عندك مسودة: ","Your draft: ")+price.items.map((item:Price["items"][number])=>item.quantity+" × "+publicText(item.name)).join("، ")+say(locale,". شنو تحب تغيّر أو تضيف؟",". What would you like to change or add?") : say(locale,"شنو تحب تطلب؟","What would you like to order?"));return true;
  }
  if (settings.delivery_enabled && /^(?:تعرف شنو طلبي|شنو طلبي|شنو طلبت|what(?: is|'s) my (?:order|cart))$/.test(t)) {
    const price=result(await db.rpc("whatsapp_price",{p_restaurant:job.restaurant_id,p_items:c.draft}));
    await reply(price?.items?.length ? say(locale,"طلبك الحالي: ","Your current draft: ")+price.items.map((item:Price["items"][number])=>item.quantity+" × "+publicText(item.name)).join("، ") : say(locale,"بعد ما اخترت أصناف. شنو تحب تطلب؟","You have not selected any items yet. What would you like?"));return true;
  }
  if (!active) return false;
  if (/^(?:ثبتت الطلب|انثبت الطلب|تم تثبيت الطلب|did you (?:place|confirm) (?:the |my )?order|is my order confirmed)$/.test(t)) {
    if(c.quote_id && c.delivery_state?.awaitingConfirmation) {
      await reply(say(locale,"بعد ما انرسل للمطعم. للتأكيد اضغط زر الملخص أو اكتب ثبت ","It has not been submitted. Tap the summary button or type confirm ")+confirmationCode(c.quote_id));return true;
    }
    // The regular status action looks up the actual linked order.
    return false;
  }
  if (isDeliveryConfirmation(job,c)) {
    const state=await complete(db,job,locale,"delivery_confirm",undefined,c.quote_id!);
    if(state==="quote_changed") await progressDelivery(db,job,c,settings,locale,undefined,undefined,say(locale,"التفاصيل أو السعر تغيّر. هذا الملخص الجديد:\n","The details or price changed. Here is the updated summary:\n"));
    else if(state==="confirmation_expired") await complete(db,job,locale,"reply",{text:agentText.expired(locale)});
    else if(state==="ordering_closed") await complete(db,job,locale,"reply",{text:agentText.closed(locale)});
    return true;
  }
  if (/^(?:الغي (?:الطلب|السله)|الغاء الطلب|كنسل|cancel(?: (?:my )?(?:order|cart))?)$/.test(t)) {
    await complete(db,job,locale,"delivery_cancel",{text:say(locale,"لغيت مسودة الطلب. ما انرسل طلب للمطعم.","Your draft was cancelled. No order was submitted.")});return true;
  }
  if (job.kind==="location") { await progressDelivery(db,job,c,settings,locale);return true; }
  const phone=deliveryPhonePatch(text,c.delivery_state?.awaitingField);
  const addressMention=(settings.delivery_zones||[]).some(zone=>t.includes(normalizeMessage(zone.area))) || /قرب|شارع|منطقه|محله|بنايه|street|near|address/i.test(t);
  if (phone.mode && !addressMention && !/(?:اريد|أريد|خلي|ضيف|اضيف|بدل|زود|want|add|change).{0,30}(?:\d|واحد|اثنين|برغر|برگر)/i.test(text)) {
    await progressDelivery(db,job,c,settings,locale);return true;
  }
  if (!phone.mode && ["address","address_details","coverage"].includes(c.delivery_state?.awaitingField || "") &&
    !/(?:اريد|خلي|ضيف|اضيف|بدل|زود|سعر|شكد|منيو|عندكم|want|add|change|price|menu)/i.test(t) &&
    ((settings.delivery_zones||[]).some(zone=>t.includes(normalizeMessage(zone.area))) || /قرب|شارع|منطقه|محله|بنايه|street|near|address/i.test(t))) {
    const hasArea=(settings.delivery_zones||[]).some(zone=>t.includes(normalizeMessage(zone.area)));
    const address=c.delivery_state?.awaitingField==="address_details" && !hasArea && c.delivery_state.address?.details
      ? c.delivery_state.address.details+"، "+text : text;
    await progressDelivery(db,job,c,settings,locale,undefined,address);return true;
  }
  if (/^(?:ملخص(?: الطلب)?|عرض الملخص|order summary|ثبت(?: الطلب)?|confirm(?: my order)?)$/.test(t)) { await progressDelivery(db,job,c,settings,locale);return true; }
  return false;
}
