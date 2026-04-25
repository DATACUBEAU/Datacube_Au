
import { importPKCS8, SignJWT } from "npm:jose@5.2.3";

export async function getGoogleAccessToken(
  clientEmail: string,
  privateKey: string,
  scopes: string[]
): Promise<string> {
  try {
    // 1. Prepare Private Key
    // Ensure PEM format
    const pem = privateKey.replace(/\\n/g, "\n");
    const ecPrivateKey = await importPKCS8(pem, "RS256");

    // 2. Create JWT
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({
      scope: scopes.join(" "),
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(clientEmail)
      .setSubject(clientEmail)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt(now)
      .setExpirationTime(now + 3600) // 1 hour
      .sign(ecPrivateKey);

    // 3. Exchange for Access Token
    const params = new URLSearchParams();
    params.append("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    params.append("assertion", jwt);

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google OAuth failed: ${err}`);
    }

    const data = await res.json();
    return data.access_token;
  } catch (error) {
    console.error("Error getting Google Access Token:", error);
    throw error;
  }
}
