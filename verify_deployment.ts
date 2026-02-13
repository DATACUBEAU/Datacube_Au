
import { createClient } from "@supabase/supabase-js";
import * as jose from "jose";
import dotenv from "dotenv";
import fs from "fs";

// Load .env.local manually if not automatically loaded
if (fs.existsSync(".env.local")) {
    const envConfig = dotenv.parse(fs.readFileSync(".env.local"));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const APP_SECRET = process.env.APP_SECRET || "";

if (!APP_SECRET) {
    console.error("Skipping App Token tests: APP_SECRET not provided in env.");
    console.error("Please add APP_SECRET to your .env.local file temporarily for this test.");
    process.exit(1);
}

if (!SUPABASE_URL) {
    console.error("Missing SUPABASE_URL.");
    process.exit(1);
}

async function runTests() {
    console.log("Starting Verification Suite...");
    console.log(`Target: ${SUPABASE_URL}`);

    // 1. Test firebase-auth-exchange (Expect failure without token)
    console.log("\n[1] Testing firebase-auth-exchange (Availability Check)...");
    try {
        const res1 = await fetch(`${SUPABASE_URL}/functions/v1/firebase-auth-exchange`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
            body: JSON.stringify({ firebaseToken: "invalid-token" })
        });
        
        if (res1.status === 404) {
            console.error("❌ firebase-auth-exchange not found!");
        } else if (res1.status === 401 || res1.status === 500) {
            console.log("✅ Function is reachable (returned expected error for invalid token).");
        } else {
            console.log(`⚠️ Unexpected status: ${res1.status} (Might be OK if validation logic changed)`);
        }
    } catch (e) {
        console.error("❌ Failed to reach firebase-auth-exchange", e);
    }

    // 2. Mint Test App Token
    console.log("\n[2] Minting Test App Session Token...");
    const testUserId = "00000000-0000-0000-0000-000000000000"; // Mock ID
    const secret = new TextEncoder().encode(APP_SECRET);
    
    const appToken = await new jose.SignJWT({ 
        sub: testUserId, 
        role: "app_user",
        provider: "firebase" 
      })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);
    console.log("✅ Generated Token");

    // 3. Test api-documents with App Token
    console.log("\n[3] Testing api-documents with App Token...");
    try {
        const res2 = await fetch(`${SUPABASE_URL}/functions/v1/api-documents`, {
            method: "GET",
            headers: { 
                "Authorization": `Bearer ${appToken}`,
                "Content-Type": "application/json"
            }
        });

        if (res2.status === 200) {
            console.log("✅ api-documents accepted the token (Status 200).");
            const data = await res2.json();
            console.log(`   Returned ${Array.isArray(data) ? data.length : 0} documents.`);
        } else {
            const text = await res2.text();
            console.error(`❌ api-documents failed: ${res2.status} - ${text}`);
        }
    } catch (e) {
        console.error("❌ Failed to reach api-documents", e);
    }

    // 4. Test log-event with App Token
    console.log("\n[4] Testing log-event with App Token...");
    try {
        const res3 = await fetch(`${SUPABASE_URL}/functions/v1/log-event`, {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${appToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                event_type: "test_verification",
                entity_id: "system",
                metadata: { source: "deployment_script" }
            })
        });

        if (res3.status === 200) {
            console.log("✅ log-event accepted the token (Status 200).");
        } else {
            const text = await res3.text();
            console.error(`❌ log-event failed: ${res3.status} - ${text}`);
        }
    } catch (e) {
        console.error("❌ Failed to reach log-event", e);
    }
}

runTests();
