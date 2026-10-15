import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import WebSocket from "ws";

dotenv.config({ path: [".env.local", ".env"] });
if (!globalThis.WebSocket) (globalThis as any).WebSocket = WebSocket;

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function main() {
  const args = process.argv.slice(2);
  const username = args[0] || process.env.ADMIN_USERNAME || "admin";
  const password = args[1] || process.env.ADMIN_PASSWORD || "";
  const fullName = args[2] || "System Admin";

  if (!supabaseUrl) {
    console.error("❌ SUPABASE_URL is missing in .env.local or environment.");
    process.exit(1);
  }

  if (!serviceRoleKey) {
    console.error("❌ SUPABASE_SERVICE_ROLE_KEY is required to create admin accounts.");
    console.error("👉 Please add SUPABASE_SERVICE_ROLE_KEY to your .env.local file from your Supabase Dashboard (Settings -> API -> service_role secret).");
    console.error("\nAlternatively, run the SQL snippet in the Supabase SQL Editor (see README or documentation).");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("❌ Provide ADMIN_PASSWORD (or the second argument) with at least 12 characters.");
    process.exit(1);
  }

  const email = username.includes("@")
    ? username.toLowerCase()
    : `${username.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@accounts.novx.invalid`;

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log(`🔍 Checking if account exists for: ${email}...`);

  // Search for existing user
  let existingUserId: string | null = null;
  for (let page = 1; !existingUserId; page++) {
    const list = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
    if (list.error) {
      console.error("❌ Failed to list users:", list.error.message);
      process.exit(1);
    }
    const found = (list.data.users as Array<{ id: string; email?: string }>).find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) existingUserId = found.id;
    if (list.data.users.length < 100) break;
  }

  if (existingUserId) {
    console.log(`⚙️ User already exists (ID: ${existingUserId}). Updating to Admin role and updating password...`);
    const updateRes = await supabaseAdmin.auth.admin.updateUserById(existingUserId, {
      password,
      app_metadata: { system_role: "admin" },
      user_metadata: { name: fullName }
    });
    if (updateRes.error) {
      console.error("❌ Failed to update user:", updateRes.error.message);
      process.exit(1);
    }
    console.log(`✅ Successfully updated ${username} as System Admin!`);
  } else {
    console.log(`➕ Creating new admin user: ${username} (${email})...`);
    const createRes = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: fullName },
      app_metadata: { system_role: "admin" }
    });
    if (createRes.error) {
      console.error("❌ Failed to create user:", createRes.error.message);
      process.exit(1);
    }
    console.log(`✅ Admin account created successfully!`);
  }

  console.log("\n📋 Login Details:");
  console.log(`   Role:      Admin (مدير النظام)`);
  console.log(`   Username:  ${username}`);
  console.log(`   Email:     ${email}`);
  console.log(`\nYou can now log in at http://localhost:3000 as Admin!`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
