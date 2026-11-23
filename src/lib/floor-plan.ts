import { supabase } from "./supabase";

export const floorColumns = 8;
export const floorSlotLimit = 528;
export type TableShape = "round" | "square" | "rect";
export type TablePlacement = { table: number; slot: number; shape: TableShape };

export function buildFloor(tableCount: number, saved: TablePlacement[]): TablePlacement[] {
  const count = Math.max(0, Math.min(500, Math.floor(tableCount) || 0));
  const placements = new Map<number, TablePlacement>();
  const occupied = new Set<number>();
  for (const placement of saved) {
    if (!placement || !Number.isInteger(placement.table) || placement.table < 1 || placement.table > count
      || !Number.isInteger(placement.slot) || placement.slot < 0 || placement.slot >= floorSlotLimit
      || !["round", "square", "rect"].includes(placement.shape)
      || placements.has(placement.table) || occupied.has(placement.slot)) continue;
    placements.set(placement.table, placement);
    occupied.add(placement.slot);
  }
  let free = 0;
  for (let table = 1; table <= count; table++) {
    if (placements.has(table)) continue;
    while (occupied.has(free)) free++;
    placements.set(table, { table, slot: free, shape: "round" });
    occupied.add(free);
  }
  return Array.from(placements.values()).sort((a, b) => a.table - b.table);
}

export function moveTable(floor: TablePlacement[], table: number, slot: number): TablePlacement[] {
  const oldSlot = floor.find(placement => placement.table === table)?.slot;
  if (oldSlot === undefined || !Number.isInteger(slot) || slot < 0 || slot >= floorSlotLimit || oldSlot === slot) return floor;
  return floor.map(placement => placement.table === table ? { ...placement, slot }
    : placement.slot === slot ? { ...placement, slot: oldSlot } : placement);
}

export async function loadFloor(restaurantId: string) {
  const [restaurant, layout] = await Promise.all([
    supabase.from("restaurants").select("table_count").eq("id", restaurantId).single(),
    supabase.from("restaurant_table_layouts").select("placements").eq("restaurant_id", restaurantId).maybeSingle(),
  ]);
  if (restaurant.error) throw restaurant.error;
  if (layout.error) throw layout.error;
  return buildFloor(restaurant.data.table_count, Array.isArray(layout.data?.placements) ? layout.data.placements : []);
}
