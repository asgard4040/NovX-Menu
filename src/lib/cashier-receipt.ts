import type { OrderItem } from "../types";

export type ReceiptOrder = {
  order_number: number;
  created_at: string;
  table_number: string;
  total_amount: number;
  items: OrderItem[];
};

export function printCashierReceipt(order: ReceiptOrder, restaurant: string, language: string) {
  const ar = language === "ar";
  const locale = ar ? "ar-IQ" : "en-GB";
  const text = (arabic: string, english: string) => ar ? arabic : english;
  const format = new Intl.NumberFormat(locale);
  const money = (amount: number) => format.format(amount) + text(" د.ع", " IQD");
  const frame = document.createElement("iframe");
  frame.title = text("وصل الطلب", "Order receipt");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:1px;height:1px;inset:auto 0 0 auto;opacity:0;pointer-events:none;border:0";
  document.body.append(frame);

  try {
    const doc = frame.contentDocument;
    const target = frame.contentWindow;
    if (!doc || !target) throw new Error("print_unavailable");
    doc.documentElement.lang = language;
    doc.documentElement.dir = ar ? "rtl" : "ltr";
    doc.title = text("وصل الطلب", "Order receipt") + " #" + order.order_number;
    const style = doc.createElement("style");
    style.textContent = `
      @page { size: auto; margin: 3mm }
      * { box-sizing: border-box }
      body { max-width: 72mm; margin: 0 auto; color: #000; font: 12px/1.5 Arial,sans-serif }
      h1 { font-size: 17px; margin: 0 }
      h1, header p { text-align: center; overflow-wrap: anywhere }
      p { margin: 2px 0 }
      ul { list-style: none; padding: 5px 0; margin: 7px 0; border-block: 1px dashed #000 }
      li { break-inside: avoid; padding: 3px 0 }
      .line { display: flex; justify-content: space-between; gap: 6px }
      .line span:first-child { min-width: 0; overflow-wrap: anywhere }
      .line span:last-child { white-space: nowrap }
      .options { font-size: 11px }
      .total { font-size: 14px; font-weight: bold }
    `;
    doc.head.append(style);
    const add = (parent: HTMLElement, tag: string, value = "", className = "") => {
      const element = doc.createElement(tag);
      element.className = className;
      element.textContent = value;
      parent.append(element);
      return element;
    };
    const header = add(doc.body, "header");
    if (restaurant) add(header, "h1", restaurant);
    add(header, "p", doc.title);
    add(header, "p", new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baghdad" }).format(new Date(order.created_at)));
    add(header, "p", order.table_number === "counter" ? text("كاونتر", "Counter") : text("طاولة ", "Table ") + order.table_number);
    const items = add(doc.body, "ul");
    for (const item of order.items) {
      const row = add(items, "li");
      const line = add(row, "div", "", "line");
      add(line, "span", format.format(item.quantity) + " × " + item.name);
      add(line, "span", money(item.price * item.quantity)).dir = "auto";
      const options = [item.cheeseSelected && text("جبن", "Cheese"), item.spicySelected && text("حار", "Spicy"), item.customizationText].filter(Boolean);
      if (options.length) add(row, "p", options.join(" · "), "options");
    }
    const total = add(doc.body, "div", "", "line total");
    add(total, "span", text("المجموع", "Total"));
    add(total, "span", money(order.total_amount)).dir = "auto";
    target.addEventListener("afterprint", () => frame.remove(), { once: true });
    target.focus();
    target.print();
    window.setTimeout(() => frame.remove(), 120_000);
  } catch (error) {
    frame.remove();
    throw error;
  }
}
