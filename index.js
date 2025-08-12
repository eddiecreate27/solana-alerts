import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SOL_THRESHOLD = parseFloat(process.env.SOL_THRESHOLD || "2");

app.post("/webhook", async (req, res) => {
  const events = req.body;

  for (const e of events) {
    try {
      const type = e.type || "";
      const account = e.account || "Unknown";
      const sig = e.signature || "";
      const solValue = e.amount ? e.amount / 1e9 : 0; // lamports to SOL

      // Detect real token mint (Solana instruction: InitializeMint)
      const isNewMint =
        e.transaction?.message?.instructions?.some(inst =>
          inst.parsed?.type === "initializeMint"
        ) || type === "TOKEN_MINT";

      const isLargeTransfer = type === "TRANSFER" && solValue >= SOL_THRESHOLD;
      const isCreate = type === "CREATE";

      if (isNewMint || isCreate || isLargeTransfer) {
        const message = `🚨 Dev Wallet Alert (${isNewMint ? "NEW TOKEN MINT" : type})\nWallet: ${account}\nAmount: ${solValue.toFixed(2)} SOL\nTx: https://solscan.io/tx/${sig}`;

        // Send to Discord
        if (DISCORD_WEBHOOK) {
          await fetch(DISCORD_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: message })
          });
        }

        // Send to Telegram
        if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
          });
        }
      }
    } catch (err) {
      console.error("Error processing event:", err);
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
