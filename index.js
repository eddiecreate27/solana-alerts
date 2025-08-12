import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SOL_THRESHOLD = parseFloat(process.env.SOL_THRESHOLD || "2");
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ""; // must match Helius authHeader

// Store already-seen token mints
const seenTokens = new Set();

const toSol = (lamports) => (lamports ? Number(lamports) / 1e9 : 0);

async function sendDiscord(msg) {
  if (!DISCORD_WEBHOOK) return;
  await fetch(DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: msg })
  });
}

async function sendTelegram(msg) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg })
  });
}

app.post("/webhook", async (req, res) => {
  // verify auth header if set
  const incomingAuth = req.headers["authorization"] || req.headers["Authorization"] || "";
  if (WEBHOOK_SECRET && incomingAuth !== WEBHOOK_SECRET) {
    console.warn("Unauthorized webhook call", incomingAuth);
    return res.status(401).send("unauthorized");
  }

  const events = Array.isArray(req.body) ? req.body : [req.body];

  for (const e of events) {
    try {
      const type = e.type || e.eventType || "";
      const account = e.account || "Unknown";
      const signature = e.signature || e.txSignature || "";
      const lamports = e.amount || e.lamports || 0;
      const sol = toSol(lamports);

      // Detect real mint via parsed instructions (initializeMint) OR type TOKEN_MINT
      const isNewMint =
        (e.transaction &&
          e.transaction.message &&
          Array.isArray(e.transaction.message.instructions) &&
          e.transaction.message.instructions.some(
            (inst) => inst.parsed && inst.parsed.type === "initializeMint"
          )) ||
        type === "TOKEN_MINT";

      const isCreate = type === "CREATE" || type === "PROGRAM_DEPLOY";
      const isLargeTransfer = (type === "TRANSFER" || type === "SOL_TRANSFER") && sol >= SOL_THRESHOLD;

      // Token filtering: skip alerts if we've already seen this mint
      if (isNewMint) {
        const mintAddress = e.accountAddresses?.[0] || account;
        if (seenTokens.has(mintAddress)) {
          console.log(`Skipping existing token: ${mintAddress}`);
          continue;
        }
        seenTokens.add(mintAddress);
        console.log(`🚀 New token detected: ${mintAddress}`);
      }

      if (isNewMint || isCreate || isLargeTransfer) {
        const label = isNewMint ? "NEW TOKEN MINT" : type || "EVENT";
        const msg = `🚨 Dev Wallet Alert (${label})\nWallet: ${account}\nAmount: ${sol.toFixed(3)} SOL\nTx: https://solscan.io/tx/${signature}`;

        await sendDiscord(msg);
        await sendTelegram(msg);
        console.log("alert sent:", label, account, sol.toFixed(3));
      }
    } catch (err) {
      console.error("error processing event", err);
    }
  }

  res.status(200).send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
